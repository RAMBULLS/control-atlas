import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readdirSync, realpathSync, rmSync, utimesSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { backoffDelayMs, classifyFailure, realSleep } from './retry-policy.mjs';

const protectedSegment = /^(?:\.git|\.env(?:\..*)?|polic(?:y|ies)|baselines?)$/i;
const protectedFiles = [
  'data/source-baselines.json', 'data/source-refresh-contract.json',
  'data/source-url-policy.json', 'data/source-refresh-policy.json',
];

function inside(root, path) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Transaction path must stay strictly inside root: ${path}`);
  }
}

function inspectPath(root, path, recursive = false) {
  inside(root, path);
  let cursor = root;
  for (const part of relative(root, path).split(sep)) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) {
      // existsSync follows links, including dangling links; lstat does not.
      try {
        if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink transaction path: ${cursor}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      continue;
    }
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink transaction path: ${cursor}`);
  }
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported transaction file type: ${path}`);
  if (recursive && stat.isDirectory()) {
    for (const name of readdirSync(path)) inspectPath(root, join(path, name), true);
  }
}

function copyTree(source, destination) {
  const stat = lstatSync(source);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(destination, name));
  } else {
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(source, destination);
  }
  // Capture before reading/copying: reading may alter source atime and creating
  // descendants alters directory mtime. Apply times before final read-only modes.
  // A metadata failure is an incomplete copy, never a successful restoration.
  try {
    utimesSync(destination, stat.atime, stat.mtime);
  } catch (error) {
    error.transactionCopyPath = destination;
    error.transactionCopyAction = 'restore timestamps';
    throw error;
  }
  try {
    chmodSync(destination, stat.mode & 0o777);
  } catch (error) {
    error.transactionCopyPath = destination;
    error.transactionCopyAction = 'restore permissions';
    throw error;
  }
}

function declaredPaths(root, paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('Source transaction requires declared paths');
  const result = paths.map((path) => {
    if (typeof path !== 'string' || !path || isAbsolute(path) || win32.isAbsolute(path)
      || path.includes(':') || path.includes('\0')) throw new Error(`Invalid transaction path: ${path}`);
    const segments = path.split(/[\\/]/);
    if (segments.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || protectedSegment.test(part))) {
      throw new Error(`Protected or traversing transaction path: ${path}`);
    }
    const target = resolve(root, ...segments);
    inside(root, target);
    if (protectedFiles.some((file) => {
      const protectedPath = resolve(root, file).toLowerCase();
      return protectedPath === target.toLowerCase() || protectedPath.startsWith(`${target.toLowerCase()}${sep}`);
    })) throw new Error(`Transaction path overlaps protected policy: ${path}`);
    // A transaction cannot replace its own snapshots or their ancestors.
    const snapshotRoot = join(root, '.local', 'source-transactions');
    const key = target.toLowerCase();
    const snapshotKey = snapshotRoot.toLowerCase();
    if (key === snapshotKey || snapshotKey.startsWith(`${key}${sep}`) || key.startsWith(`${snapshotKey}${sep}`)) {
      throw new Error(`Transaction path overlaps snapshot storage: ${path}`);
    }
    inspectPath(root, target, true);
    return target;
  });
  const sorted = result.map((path) => path.toLowerCase()).sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted.slice(0, index).some((prior) => sorted[index] === prior || sorted[index].startsWith(`${prior}${sep}`))) {
      throw new Error('Overlapping transaction paths');
    }
  }
  return result;
}

/** Run one source against its immediate last-good filesystem state. */
export async function runSourceTransaction({
  root, sourceId, paths, attempts = 1, operation, validate, onQuarantine,
  classify = classifyFailure, sleep = realSleep, backoff = { baseMs: 0, maxMs: 0 },
}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || typeof operation !== 'function'
    || !sourceId || (validate !== undefined && typeof validate !== 'function')
    || (onQuarantine !== undefined && typeof onQuarantine !== 'function')) {
    throw new Error('Invalid source transaction arguments');
  }
  const requestedRoot = resolve(root);
  for (let cursor = requestedRoot; ; cursor = dirname(cursor)) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Symlink transaction root');
    if (dirname(cursor) === cursor) break;
  }
  root = realpathSync(requestedRoot);
  const targets = declaredPaths(root, paths);
  const storage = join(root, '.local', 'source-transactions');
  inspectPath(root, storage);
  mkdirSync(storage, { recursive: true });
  const snapshot = mkdtempSync(join(storage, 'source-'));
  let preserveSnapshot = false;
  try {
    const originals = targets.map((path, index) => {
      const present = existsSync(path);
      const backup = join(snapshot, String(index));
      if (present) copyTree(path, backup);
      return { path, backup, present };
    });
    // Persist the source-to-backup mapping before any source operation. If a
    // restore or diagnostic write later fails, recovery does not depend on the
    // process surviving or on guessing the numeric backup directory names.
    const recoveryManifest = join(snapshot, 'manifest.json');
    const recoveryMap = {
      schema_version: '1.0', source_id: sourceId, root,
      originals: originals.map(({ path, backup, present }) => ({ path, backup, present })),
    };
    writeFileSync(recoveryManifest, `${JSON.stringify(recoveryMap, null, 2)}\n`);
    const describeFailure = (path, action, error) => ({
      path: error.transactionCopyPath || path, action: error.transactionCopyAction || action,
      code: String(error.code || 'UNKNOWN'), message: String(error.message || error),
    });
    function incompleteRestore(sourceError, failures, restoredPaths = []) {
      // Set before attempting more filesystem work. Neither a diagnostic-write
      // failure nor a cleanup/finally path may discard the only good copies.
      preserveSnapshot = true;
      const recovery = {
        ...recoveryMap, status: 'rollback_incomplete', snapshot_path: snapshot,
        manifest_path: recoveryManifest, failures, restored_paths: restoredPaths,
        unrestored_paths: targets.filter((path) => !restoredPaths.includes(path)),
      };
      const diagnosticPath = join(snapshot, 'recovery.json');
      let diagnosticError = null;
      try {
        inspectPath(root, snapshot, true);
        inspectPath(root, diagnosticPath);
        writeFileSync(diagnosticPath, `${JSON.stringify(recovery, null, 2)}\n`);
        recovery.diagnostic_path = diagnosticPath;
      } catch (error) {
        diagnosticError = describeFailure(diagnosticPath, 'write recovery diagnostic', error);
        recovery.diagnostic_error = diagnosticError;
      }
      const details = failures.map((entry) => `${entry.action} at ${entry.path}: ${entry.code} ${entry.message}`).join('; ');
      const error = new Error(`Source transaction rollback incomplete for ${sourceId}. ` +
        `Retained snapshot: ${snapshot}. Recovery map: ${recoveryManifest}. ` +
        `Failed actions: ${details}. Unrestored paths: ${recovery.unrestored_paths.join(', ')}. ` +
        `Do not retry or report quarantine success; recover the retained originals first.` +
        (diagnosticError ? ` Recovery diagnostic write failed: ${diagnosticError.code} ${diagnosticError.message}.` : ''),
      { cause: sourceError });
      error.code = 'SOURCE_TRANSACTION_ROLLBACK_INCOMPLETE';
      error.recovery = recovery;
      throw error;
    }
    function restore(sourceError) {
      // Verify the COMPLETE boundary before removing anything. If a source
      // leaves a symlink/unsafe target, retain every backup and stop untouched.
      try { inspectPath(root, snapshot, true); }
      catch (error) { incompleteRestore(sourceError, [describeFailure(snapshot, 'validate snapshot boundary', error)]); }
      for (const { path } of originals) {
        try { inspectPath(root, path, true); }
        catch (error) { incompleteRestore(sourceError, [describeFailure(path, 'validate restore boundary', error)]); }
      }
      const failures = []; const restoredPaths = [];
      for (const { path, backup, present } of originals) {
        try {
          rmSync(path, { recursive: true, force: true });
          if (present) copyTree(backup, path);
          restoredPaths.push(path);
        } catch (error) {
          failures.push(describeFailure(path, 'restore source output', error));
        }
      }
      // Continue restoring other already-validated owned paths, then fail as
      // infrastructure. No retry/classification/callback is allowed after even
      // one incomplete restore, including a bytes-copied metadata failure.
      if (failures.length) incompleteRestore(sourceError, failures, restoredPaths);
    }
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const context = { root, sourceId, attempt };
      let value;
      try {
        value = await operation(context);
        if (validate && await validate({ ...context, value }) === false) {
          throw new Error('Source transaction validation rejected output');
        }
      } catch (error) {
        lastError = error;
        restore(error);
        // Ask again only when a new retrieval could plausibly differ. A
        // validation rejection is the publisher's current answer.
        const failureClass = classify(error);
        if (attempt < attempts && failureClass === 'transient') {
          const waitMs = backoffDelayMs(attempt, { baseMs: backoff.baseMs, maxMs: backoff.maxMs });
          if (waitMs > 0) await sleep(waitMs);
          continue;
        }
        const result = {
          status: 'quarantined', sourceId, attempts: attempt, failure_class: failureClass,
          error: String(lastError?.message || lastError),
        };
        if (onQuarantine) await onQuarantine(result);
        return result;
      }
      // An unsafe post-operation boundary also needs retained recovery copies;
      // it cannot be an accepted result or an automatic unsafe restoration.
      for (const path of targets) {
        try { inspectPath(root, path, true); }
        catch (error) { incompleteRestore(error, [describeFailure(path, 'validate acceptance boundary', error)]); }
      }
      return { status: 'accepted', sourceId, attempts: attempt, value };
    }
  } finally {
    if (!preserveSnapshot) {
      inspectPath(root, snapshot, true);
      rmSync(snapshot, { recursive: true, force: true });
    }
  }
}
