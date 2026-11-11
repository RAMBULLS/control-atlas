import assert from 'node:assert/strict';
import fs, {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, rmdirSync, rmSync, symlinkSync, writeFileSync, utimesSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { runSourceTransaction } from '../scripts/lib/source-transaction.mjs';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '.local', 'source-transaction-tests');
mkdirSync(fixtureRoot, { recursive: true });
after(() => rmdirSync(fixtureRoot));

function fixture(t) {
  const root = mkdtempSync(join(fixtureRoot, 'case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  const get = (path) => readFileSync(join(root, path));
  const run = (options) => runSourceTransaction({ root, sourceId: 'test-source', ...options });
  const clean = () => assert.deepEqual(readdirSync(join(root, '.local', 'source-transactions')), []);
  return { root, put, get, run, clean };
}

test('quarantine restores bytes, deleted files and modes, and removes new directory contents and ignored raw input', async (t) => {
  const { root, put, get, run, clean } = fixture(t);
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  put('maps/source/kept.json', bytes);
  put('maps/source/deleted.json', 'last-good');
  chmodSync(join(root, 'maps/source/kept.json'), 0o444);
  const mode = lstatSync(join(root, 'maps/source/kept.json')).mode & 0o777;
  let notified = false;
  const result = await run({
    paths: ['maps/source', 'data/raw.xlsx'],
    operation: () => {
      chmodSync(join(root, 'maps/source/kept.json'), 0o666);
      put('maps/source/kept.json', 'bad');
      rmSync(join(root, 'maps/source/deleted.json'));
      put('maps/source/new.json', 'bad');
      put('data/raw.xlsx', bytes);
      throw new Error('publisher unavailable');
    },
    onQuarantine: () => { assert.deepEqual(get('maps/source/kept.json'), bytes); notified = true; },
  });
  assert.equal(result.status, 'quarantined');
  assert.equal(notified, true);
  assert.deepEqual(get('maps/source/kept.json'), bytes);
  assert.equal(get('maps/source/deleted.json').toString(), 'last-good');
  assert.equal(lstatSync(join(root, 'maps/source/kept.json')).mode & 0o777, mode);
  assert.equal(existsSync(join(root, 'maps/source/new.json')), false);
  assert.equal(existsSync(join(root, 'data/raw.xlsx')), false);
  clean();
});

test('rollback of a later source retains earlier accepted shared registry and existing ignored bytes', async (t) => {
  const { put, get, run, clean } = fixture(t);
  put('data/source-registry.json', 'original');
  put('data/raw.xlsx', Buffer.from([4, 5, 6]));
  assert.equal((await run({ paths: ['data/source-registry.json'], operation: () => put('data/source-registry.json', 'source A accepted') })).status, 'accepted');
  await run({ paths: ['data/source-registry.json', 'data/raw.xlsx'], operation: () => {
    put('data/source-registry.json', 'source B failed');
    put('data/raw.xlsx', 'bad');
    throw new Error('bad B');
  } });
  assert.equal(get('data/source-registry.json').toString(), 'source A accepted');
  assert.deepEqual(get('data/raw.xlsx'), Buffer.from([4, 5, 6]));
  clean();
});

test('retry starts clean and validation runs before acceptance', async (t) => {
  const { put, get, run, clean } = fixture(t);
  put('data/catalog.json', 'good');
  const result = await run({ paths: ['data/catalog.json'], attempts: 2, operation: ({ attempt }) => {
    assert.equal(get('data/catalog.json').toString(), 'good');
    put('data/catalog.json', attempt === 1 ? 'invalid' : 'accepted');
  }, validate: () => {
    // A truncated delivery is the kind of invalid content a second retrieval can fix.
    if (get('data/catalog.json').toString() !== 'accepted') throw Object.assign(new Error('truncated download'), { transient: true });
  } });
  assert.equal(result.status, 'accepted');
  assert.equal(result.attempts, 2);
  assert.equal(get('data/catalog.json').toString(), 'accepted');
  clean();
});

test('final validation failure restores last-good and cleans snapshot', async (t) => {
  const { put, get, run, clean } = fixture(t);
  put('data/catalog.json', 'good');
  const result = await run({ paths: ['data/catalog.json'], operation: () => put('data/catalog.json', 'invalid'), validate: () => false });
  assert.equal(result.status, 'quarantined');
  assert.equal(get('data/catalog.json').toString(), 'good');
  clean();
});

test('a deleted declared directory is restored with its original mode', async (t) => {
  const { root, put, get, run, clean } = fixture(t);
  put('maps/source/file.json', 'good');
  chmodSync(join(root, 'maps/source'), 0o755);
  const mode = lstatSync(join(root, 'maps/source')).mode & 0o777;
  await run({ paths: ['maps/source'], operation: () => {
    rmSync(join(root, 'maps/source'), { recursive: true });
    throw new Error('deleted');
  } });
  assert.equal(get('maps/source/file.json').toString(), 'good');
  assert.equal(lstatSync(join(root, 'maps/source')).mode & 0o777, mode);
  clean();
});

test('invalid, protected and overlapping paths fail before source execution', async (t) => {
  const { root, run } = fixture(t);
  for (const paths of [
    ['../escape'], [join(root, 'absolute')], ['C:\\outside'], ['data/../escape'],
    ['.git/config'], ['.env'], ['data/source-baselines.json'],
    ['data/source-refresh-contract.json'], ['data/source-url-policy.json'],
    ['data/source-refresh-policy.json'], ['data'], ['.local'],
    ['maps/a', 'maps/a/file'], ['maps/a', 'maps/a'],
    ['maps/a', 'maps/a-other', 'maps/a/file'], ['.git./config'],
  ]) {
    await assert.rejects(run({ paths, operation: () => assert.fail('operation must not run') }));
  }
});

test('symlink ancestors and descendants are rejected without touching their target', async (t) => {
  const { root, put, get, run } = fixture(t);
  put('real/file.json', 'protected bytes');
  symlinkSync(join(root, 'real'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(run({ paths: ['linked/file.json'], operation: () => assert.fail() }), /Symlink/);
  mkdirSync(join(root, 'maps'));
  symlinkSync(join(root, 'real'), join(root, 'maps', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(run({ paths: ['maps'], operation: () => assert.fail() }), /Symlink/);
  assert.equal(get('real/file.json').toString(), 'protected bytes');
});

test('unsafe restore preserves its snapshot and recovery map without quarantine callback or retry', async (t) => {
  const { root, put, get, run } = fixture(t);
  put('maps/source/file.json', 'good');
  put('real/file.json', 'untouched');
  let calls = 0;
  await assert.rejects(run({ paths: ['maps/source'], attempts: 3, operation: () => {
    calls += 1;
    rmSync(join(root, 'maps/source'), { recursive: true });
    symlinkSync(join(root, 'real'), join(root, 'maps/source'), process.platform === 'win32' ? 'junction' : 'dir');
    throw Object.assign(new Error('source failure'), { transient: true });
  }, onQuarantine: () => assert.fail('unsafe restore cannot quarantine'),
  classify: () => assert.fail('incomplete restore must not classify or retry'),
  }), (error) => {
    assert.equal(error.code, 'SOURCE_TRANSACTION_ROLLBACK_INCOMPLETE');
    assert.match(error.message, /validate restore boundary.*Symlink/);
    assert.match(error.message, /Do not retry/);
    const recovery = error.recovery;
    assert.equal(existsSync(recovery.snapshot_path), true);
    assert.equal(readFileSync(join(recovery.snapshot_path, '0/file.json'), 'utf8'), 'good');
    const map = JSON.parse(readFileSync(recovery.manifest_path));
    assert.equal(map.originals[0].path, join(root, 'maps/source'));
    assert.equal(map.originals[0].backup, join(recovery.snapshot_path, '0'));
    assert.deepEqual(recovery.restored_paths, []);
    assert.deepEqual(recovery.unrestored_paths, [join(root, 'maps/source')]);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(get('real/file.json').toString(), 'untouched');
  assert.equal(readdirSync(join(root, '.local/source-transactions')).length, 1);
});


test('rollback preserves original file/directory mtimes and atimes, bytes and source retrieval timestamps', async (t) => {
  const { root, put, get, run } = fixture(t);
  put('tmp/disa-cache/compilation.zip', 'retained archive');
  put('data/disa-artifact-manifest.json', '{"retrieval_timestamp":"2026-10-28T15:41:39.615Z"}');
  const paths = ['tmp/disa-cache', 'data/disa-artifact-manifest.json'];
  const targets = [...paths, 'tmp/disa-cache/compilation.zip'];
  const old = new Date('2026-10-28T15:41:39.000Z');
  for (const path of targets) utimesSync(join(root, path), old, old);
  const result = await run({ paths, operation: () => {
    put('tmp/disa-cache/compilation.zip', 'same-size changed');
    put('tmp/disa-cache/inventory/new.json', 'unaccepted response');
    put('data/disa-artifact-manifest.json', '{"retrieval_timestamp":"2026-11-11"}');
    throw new Error('native reconciliation rejected candidate');
  } });
  assert.equal(result.status, 'quarantined');
  // Inspect times before reading again and changing atime ourselves.
  for (const path of targets) {
    const stat = lstatSync(join(root, path));
    assert.equal(stat.mtimeMs, old.getTime());
    // Recursive guard inspection legitimately reads directories before snapshot.
    if (stat.isFile()) assert.equal(stat.atimeMs, old.getTime());
  }
  assert.equal(get('tmp/disa-cache/compilation.zip').toString(), 'retained archive');
  assert.equal(JSON.parse(get('data/disa-artifact-manifest.json')).retrieval_timestamp, '2026-10-28T15:41:39.615Z');
  assert.equal(existsSync(join(root, 'tmp/disa-cache/inventory/new.json')), false);
});


test('metadata-copy failures retain all backups and restore other owned paths without retry or success', async (t) => {
  const { root, put, get, run } = fixture(t);
  const paths = ['data/first.json', 'data/second.json', 'data/third.json'];
  const date = new Date('2026-10-28T15:41:39Z');
  for (const [index, path] of paths.entries()) {
    put(path, `original-${index}`); utimesSync(join(root, path), date, date);
  }
  // Include a read-only original on both Linux and the existing Windows job.
  chmodSync(join(root, paths[0]), 0o444);
  const realUtimes = fs.utimesSync;
  let restorePhase = false; let operations = 0; let metadataFailures = 0;
  t.mock.method(fs, 'utimesSync', (destination, atime, mtime) => {
    if (restorePhase && [join(root, paths[0]), join(root, paths[2])].includes(destination)) {
      metadataFailures += 1;
      throw Object.assign(new Error(`injected timestamp-copy failure: ${destination}`), { code: 'EACCES' });
    }
    return realUtimes(destination, atime, mtime);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(run({ paths, attempts: 3, operation: () => {
      operations += 1;
      chmodSync(join(root, paths[0]), 0o666);
      for (const path of paths) put(path, 'unaccepted');
      restorePhase = true;
      throw Object.assign(new Error('transient source failure'), { transient: true });
    }, classify: () => assert.fail('incomplete restore cannot enter retry classification'),
    sleep: () => assert.fail('incomplete restore cannot schedule a retry'),
    onQuarantine: () => assert.fail('incomplete restore cannot report quarantine success'),
    }), (error) => {
      assert.equal(error.code, 'SOURCE_TRANSACTION_ROLLBACK_INCOMPLETE');
      assert.equal(error.cause.message, 'transient source failure');
      const recovery = error.recovery;
      assert.deepEqual(recovery.restored_paths, [join(root, paths[1])]);
      assert.deepEqual(recovery.unrestored_paths, [join(root, paths[0]), join(root, paths[2])]);
      assert.deepEqual(recovery.failures.map((failure) => [failure.path, failure.action, failure.code]),
        [paths[0], paths[2]].map((path) => [join(root, path), 'restore timestamps', 'EACCES']));
      assert.ok(error.message.includes(recovery.snapshot_path));
      assert.ok(error.message.includes(recovery.manifest_path));
      for (const [index, path] of paths.entries()) {
        const backup = join(recovery.snapshot_path, String(index));
        assert.equal(lstatSync(backup).mtimeMs, date.getTime());
        assert.equal(readFileSync(backup, 'utf8'), `original-${index}`, path);
      }
      const stored = JSON.parse(readFileSync(recovery.diagnostic_path));
      assert.deepEqual(stored.failures, recovery.failures);
      assert.deepEqual(stored.unrestored_paths, recovery.unrestored_paths);
      assert.equal(get(paths[1]).toString(), 'original-1');
      assert.equal(lstatSync(join(root, paths[1])).mtimeMs, date.getTime());
      return true;
    });
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(operations, 1); assert.equal(metadataFailures, 2);
  assert.equal(readdirSync(join(root, '.local/source-transactions')).length, 1);
});

test('a metadata snapshot failure before source execution leaves originals intact and does not need recovery', async (t) => {
  const { root, put, get, run, clean } = fixture(t); put('data/source.json', 'last-good');
  const realUtimes = fs.utimesSync;
  t.mock.method(fs, 'utimesSync', (destination, atime, mtime) => {
    if (destination.includes('source-transactions')) throw Object.assign(new Error('injected snapshot timestamp failure'), { code: 'EIO' });
    return realUtimes(destination, atime, mtime);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(run({ paths: ['data/source.json'], operation: () => assert.fail('snapshot must finish first') }), /snapshot timestamp failure/);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(get('data/source.json').toString(), 'last-good'); clean();
  assert.equal(existsSync(join(root, 'data/source.json')), true);
});

test('successful rollback of a read-only original preserves its bytes, mode and modification time', async (t) => {
  const { root, put, get, run, clean } = fixture(t); const path = 'data/readonly.json';
  put(path, 'last-good'); const date = new Date('2026-10-28T15:41:39Z');
  utimesSync(join(root, path), date, date); chmodSync(join(root, path), 0o444);
  const mode = lstatSync(join(root, path)).mode & 0o777;
  const result = await run({ paths: [path], operation: () => {
    chmodSync(join(root, path), 0o666); put(path, 'unaccepted'); throw new Error('reject source');
  } });
  assert.equal(result.status, 'quarantined');
  assert.equal(lstatSync(join(root, path)).mode & 0o777, mode);
  assert.equal(lstatSync(join(root, path)).mtimeMs, date.getTime());
  assert.equal(get(path).toString(), 'last-good'); clean();
});

test('unsafe output after a successful operation still preserves recovery copies and cannot be accepted', async (t) => {
  const { root, put, get, run } = fixture(t); put('maps/source/file.json', 'last-good'); put('real/file.json', 'untouched');
  await assert.rejects(run({ paths: ['maps/source'], operation: () => {
    rmSync(join(root, 'maps/source'), { recursive: true });
    symlinkSync(join(root, 'real'), join(root, 'maps/source'), process.platform === 'win32' ? 'junction' : 'dir');
  } }), (error) => {
    assert.equal(error.code, 'SOURCE_TRANSACTION_ROLLBACK_INCOMPLETE');
    assert.equal(error.recovery.failures[0].action, 'validate acceptance boundary');
    assert.equal(readFileSync(join(error.recovery.snapshot_path, '0/file.json'), 'utf8'), 'last-good');
    return true;
  });
  assert.equal(get('real/file.json').toString(), 'untouched');
});

test('a failed recovery diagnostic write cannot delete snapshots or mask the incomplete-restore diagnostic', async (t) => {
  const { root, put, run } = fixture(t); const path = 'data/source.json'; put(path, 'last-good');
  const realUtimes = fs.utimesSync; const realWrite = fs.writeFileSync; let restorePhase = false;
  t.mock.method(fs, 'utimesSync', (destination, atime, mtime) => {
    if (restorePhase && destination === join(root, path)) throw Object.assign(new Error('injected timestamp failure'), { code: 'EIO' });
    return realUtimes(destination, atime, mtime);
  });
  t.mock.method(fs, 'writeFileSync', (destination, ...args) => {
    if (String(destination).endsWith('recovery.json')) throw Object.assign(new Error('injected diagnostic write failure'), { code: 'ENOSPC' });
    return realWrite(destination, ...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(run({ paths: [path], operation: () => {
      put(path, 'unaccepted'); restorePhase = true; throw new Error('source failure');
    } }), (error) => {
      assert.equal(error.code, 'SOURCE_TRANSACTION_ROLLBACK_INCOMPLETE');
      assert.equal(error.recovery.failures[0].code, 'EIO');
      assert.equal(error.recovery.diagnostic_error.code, 'ENOSPC');
      assert.match(error.message, /Recovery diagnostic write failed: ENOSPC/);
      assert.equal(readFileSync(join(error.recovery.snapshot_path, '0'), 'utf8'), 'last-good');
      assert.equal(JSON.parse(readFileSync(error.recovery.manifest_path)).originals[0].path, join(root, path));
      return true;
    });
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(readdirSync(join(root, '.local/source-transactions')).length, 1);
});

test('required scripts explicitly select DISA integrity specs, their lint paths and Windows rollback coverage', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  for (const path of ['tests/disa-public-inventory.test.mjs', 'tests/disa-public-inventory-receipts.test.mjs']) {
    assert.ok(scripts['test:refresh-safety'].split(/\s+/).includes(path), path);
    assert.ok(scripts.lint.split(/\s+/).includes(path), path);
  }
  for (const path of ['scripts/lib/disa-public-inventory.mjs', 'scripts/lib/disa-source-acceptance.mjs']) {
    assert.ok(scripts.lint.split(/\s+/).includes(path), path);
  }
  assert.ok(scripts.test.includes('npm run test:refresh-safety'));
  assert.ok(scripts['lint:ci'].includes('npm run lint'));
  assert.ok(scripts['test:process-launch'].split(/\s+/).includes('tests/source-transaction.test.mjs'));
  for (const hook of ['pretest:process-launch', 'pretest:refresh-safety', 'prelint']) {
    assert.equal(scripts[hook], 'node ./tools/validation-location.mjs', hook);
  }
});
