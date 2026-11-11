import path from 'node:path';
import { createHash } from 'node:crypto';

const identityKeys = ['repository', 'code_sha', 'checkout_sha', 'run_id', 'run_attempt', 'job_key', 'command', 'node_version'];
const countKeys = ['tests', 'suites', 'passed', 'failed', 'cancelled', 'skipped', 'todo', 'topLevel'];
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const present = value => typeof value === 'string' && value.length > 0;
export const nativeReportDigest = report => createHash('sha256').update(JSON.stringify(report)).digest('hex');

export function boundedNativeSource(root, file, pathApi = path) {
  if (!present(root) || !present(file)) return null;
  const relativePath = pathApi.relative(pathApi.resolve(root), pathApi.resolve(root, file));
  if (!relativePath || pathApi.isAbsolute(relativePath) || relativePath === '..' ||
      relativePath.startsWith('..' + pathApi.sep)) return null;
  return relativePath.split(pathApi.sep).join('/');
}

export function validateNativeIdentity(identity) {
  return identity?.repository === 'RAMBULLS/control-atlas' &&
    sha(identity.code_sha) && sha(identity.checkout_sha) &&
    /^[1-9][0-9]*$/.test(identity.run_id ?? '') &&
    Number.isSafeInteger(identity.run_attempt) && identity.run_attempt > 0 &&
    /^[a-zA-Z0-9_-]+$/.test(identity.job_key ?? '') &&
    present(identity.command) && /^v22\./.test(identity.node_version ?? '');
}

/** Consume documented Node 22 declaration-ordered terminal events.
 * Native evidence is diagnostic until its artifact/job/checkout is independently
 * verified. Environment metadata alone never establishes provider provenance.
 */
export function createNodeResultCollector({ root, identity, startedAt = new Date().toISOString() }) {
  const results = [], summaries = [], errors = [], parents = new Map(), pending = new Map();
  if (!validateNativeIdentity(identity)) errors.push('invalid execution metadata');
  if (!Number.isFinite(Date.parse(startedAt))) errors.push('invalid start time');
  return {
    accept({ type, data = {} }) {
      if (type === 'test:interrupted' || type === 'test:watch:restarted') errors.push('interrupted or repeated execution');
      if (type === 'test:summary') {
        if (data.file === undefined) summaries.push({
          counts: data.counts, duration_ms: data.duration_ms, success: data.success,
        });
        return;
      }
      if (!['test:start', 'test:pass', 'test:fail'].includes(type)) return;
      if (summaries.length) { errors.push('native test event after final summary'); return; }
      const file = boundedNativeSource(root, data.file);
      if (!file || !present(data.name) || !integer(data.nesting)) {
        errors.push('terminal event lacks bounded source identity');
        return;
      }
      const lineage = parents.get(file) ?? [];
      const eventKey = JSON.stringify([file, data.name, data.nesting, data.line, data.column]);
      if (type === 'test:start') {
        if (pending.has(eventKey) || [...pending.values()].some(row => row.file === file && row.nesting >= data.nesting)) errors.push('duplicate or unclosed native start');
        pending.set(eventKey, { file, nesting: data.nesting });
        lineage.length = data.nesting;
        lineage[data.nesting] = data.name;
        parents.set(file, lineage);
        return;
      }
      const ancestorNames = lineage.slice(0, data.nesting);
      if (ancestorNames.length !== data.nesting || ancestorNames.some(name => !present(name))) errors.push('missing test ancestry');
      const failureType = data.details?.error?.failureType;
      // Node 22 emits a root after-hook failure directly, without a start.
      const rootHookFailure = type === 'test:fail' && failureType === 'hookFailed' && data.nesting === 0;
      if (!pending.has(eventKey) && !rootHookFailure) errors.push('terminal without matching native start');
      if ([...pending.values()].some(row => row.file === file && row.nesting > data.nesting)) errors.push('parent terminal before native children');
      pending.delete(eventKey);
      const status = data.skip !== undefined ? 'skipped' : data.todo !== undefined ? 'todo' :
        ['cancelledByParent', 'testAborted', 'testTimeoutFailure'].includes(failureType) ? 'cancelled' :
          type === 'test:pass' ? 'passed' : 'failed';
      const row = {
        file, title: [...ancestorNames, data.name].join(' > '),
        line: data.line, column: data.column, nesting: data.nesting,
        ordinal: data.testNumber, type: data.details?.type === 'suite' ? 'suite' : 'test',
        status, duration_ms: data.details?.duration_ms,
        ...(typeof failureType === 'string' ? { failure_type: failureType } : {}),
        ...(rootHookFailure ? { synthetic_hook_failure: true } : {}),
      };
      if (!integer(row.ordinal) || row.ordinal < 1 || !Number.isFinite(row.duration_ms) || row.duration_ms < 0) errors.push('invalid terminal metrics');
      results.push(row);
      lineage.length = data.nesting;
      parents.set(file, lineage);
    },
    finish(finishedAt = new Date().toISOString()) {
      if (pending.size) errors.push('unclosed native starts');
      const summary = summaries.length === 1 ? summaries[0] : null;
      if (!summary || countKeys.some(key => !integer(summary.counts?.[key])) ||
          !Number.isFinite(summary.duration_ms) || summary.duration_ms < 0 || typeof summary.success !== 'boolean') errors.push('missing or ambiguous final native summary');
      const tests = results.filter(row => row.type === 'test');
      const suites = results.filter(row => row.type === 'suite');
      if (!tests.length) errors.push('empty native test inventory');
      const keys = results.map(row => JSON.stringify([row.file, row.title]));
      if (new Set(keys).size !== keys.length) errors.push('duplicate native assertion identity');
      if (summary) {
        if (tests.length !== summary.counts?.tests || suites.length !== summary.counts?.suites) errors.push('native inventory count mismatch');
        for (const status of ['passed', 'failed', 'cancelled', 'skipped', 'todo']) {
          if (tests.filter(row => row.status === status).length !== summary.counts?.[status]) errors.push('native status count mismatch: ' + status);
        }
      }
      if (!Number.isFinite(Date.parse(finishedAt)) || Date.parse(finishedAt) < Date.parse(startedAt)) errors.push('invalid finish time');
      return {
        schema_version: '1.0', runner: 'node:test', identity: { ...identity },
        started_at: startedAt, finished_at: finishedAt, summary, results,
        complete: errors.length === 0, errors: [...new Set(errors)],
        limitation: 'Native runner facts only; not independent provider verification or nine-promise acceptance.',
      };
    },
  };
}

export async function consumeNodeResults(events, options) {
  const collector = createNodeResultCollector(options);
  for await (const event of events) collector.accept(event);
  return collector.finish();
}

/** This deliberately cannot mint accepted invariant evidence. The caller must
 * first verify the immutable archive, actual job and checkout via the provider.
 * Required assertions are exact file/title pairs from a separately reviewed set.
 */
export function assessNativeAssertions(report, { identity, requiredAssertions, verifiedArchiveDigest, verifiedReportDigest } = {}) {
  const errors = [];
  if (!/^[a-f0-9]{64}$/.test(verifiedArchiveDigest ?? '')) errors.push('missing independently verified archive digest');
  if (!validateNativeIdentity(identity) || !validateNativeIdentity(report.identity) || identityKeys.some(key => report.identity[key] !== identity[key])) errors.push('native execution identity mismatch');
  if (report.schema_version !== '1.0' || report.runner !== 'node:test' || !report.complete || report.errors?.length ||
      report.summary?.success !== true) errors.push('incomplete or failed native execution');
  if (nativeReportDigest(report) !== verifiedReportDigest) errors.push('native report digest mismatch');
  const rowsForCounts = (report.results ?? []).filter(row => row.type === 'test');
  if (rowsForCounts.length !== report.summary?.counts?.tests) errors.push('native result count mismatch');
  for (const status of ['passed', 'failed', 'cancelled', 'skipped', 'todo']) {
    if (rowsForCounts.filter(row => row.status === status).length !== report.summary?.counts?.[status]) errors.push('native result status mismatch');
  }
  const required = requiredAssertions ?? [];
  const key = row => JSON.stringify([row.file, row.title]);
  if (!required.length || required.some(row => !present(row.file) || !present(row.title)) ||
      new Set(required.map(key)).size !== required.length) errors.push('invalid required assertion inventory');
  const rows = report.results ?? [];
  for (const expected of required) {
    const matched = rows.filter(row => key(row) === key(expected));
    if (matched.length !== 1 || matched[0].type !== 'test' || matched[0].status !== 'passed') errors.push('missing, repeated or nonpassing native assertion: ' + key(expected));
  }
  return { status: errors.length ? 'unknown_or_failed' : 'pass', errors };
}
