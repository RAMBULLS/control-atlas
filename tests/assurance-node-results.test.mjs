import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createNodeResultCollector, assessNativeAssertions, validateNativeIdentity, nativeReportDigest } from '../tools/lib/assurance-node-results.mjs';

const root = process.cwd();
const identity = {
  repository: 'RAMBULLS/control-atlas', code_sha: 'a'.repeat(40), checkout_sha: 'b'.repeat(40),
  run_id: '123', run_attempt: 2, job_key: 'unit', command: 'synthetic-validator-fixture', node_version: 'v22.0.0',
};
const metrics = (name, nesting = 0, type = 'test') => ({
  file: resolve(root, 'tests/fixture.test.mjs'), name, nesting, line: 1, column: 1, testNumber: 1,
  details: { duration_ms: 1, type },
});
function report(change = events => events) {
  const data = metrics('one');
  const events = [
    { type: 'test:start', data }, { type: 'test:pass', data },
    { type: 'test:summary', data: { counts: { tests: 1, suites: 0, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 1 }, duration_ms: 2, success: true } },
  ];
  const c = createNodeResultCollector({ root, identity, startedAt: '2026-11-11T12:00:00Z' });
  for (const event of change(events)) c.accept(event);
  return c.finish('2026-11-11T12:00:01Z');
}
const options = { identity, requiredAssertions: [{ file: 'tests/fixture.test.mjs', title: 'one' }], verifiedArchiveDigest: 'c'.repeat(64), verifiedReportDigest: nativeReportDigest(report()) };

test('native evidence preserves distinct requested head and actual checkout identities', () => {
  assert.equal(validateNativeIdentity(identity), true);
  const r = report();
  assert.equal(r.complete, true);
  assert.equal(assessNativeAssertions(r, options).status, 'pass');
  assert.notEqual(r.identity.code_sha, r.identity.checkout_sha);
});
for (const [name, change] of [
  ['missing summary', e => e.slice(0, 2)],
  ['duplicate summary', e => [...e, e[2]]],
  ['duplicate assertion', e => [e[0], e[1], e[0], e[1], e[2]]],
  ['truncated result stream', e => [e[0], e[2]]],
  ['source outside root', e => { e[1].data = { ...e[1].data, file: resolve(root, '..', 'outside.mjs') }; return e; }],
  ['wrong summary counts', e => { e[2].data.counts.tests = 2; return e; }],
  ['interrupted run', e => [...e, { type: 'test:interrupted' }]],
]) test('native collector rejects ' + name, () => assert.equal(report(change).complete, false));

for (const status of ['skipped', 'todo', 'failed', 'cancelled']) test('required native assertion cannot promote ' + status, () => {
  const r = report();
  r.results[0].status = status;
  assert.equal(assessNativeAssertions(r, { ...options, verifiedReportDigest: nativeReportDigest(r) }).status, 'unknown_or_failed');
});
test('caller-only native metadata cannot replace independent archive verification', () => {
  assert.equal(assessNativeAssertions(report(), { ...options, verifiedArchiveDigest: undefined }).status, 'unknown_or_failed');
  assert.equal(assessNativeAssertions(report(), { ...options, identity: { ...identity, checkout_sha: 'd'.repeat(40) } }).status, 'unknown_or_failed');
});
test('unknown and duplicate required native assertions fail closed', () => {
  assert.equal(assessNativeAssertions(report(), { ...options, requiredAssertions: [{ file: 'tests/fixture.test.mjs', title: 'invented' }] }).status, 'unknown_or_failed');
  assert.equal(assessNativeAssertions(report(), { ...options, requiredAssertions: [...options.requiredAssertions, ...options.requiredAssertions] }).status, 'unknown_or_failed');
});
test('the actual Node reporter stream preserves suite ancestry and final counts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-native-reporter-'));
  try {
    const moduleUrl = pathToFileURL(resolve('tools/lib/assurance-node-results.mjs')).href;
    const reporter = join(directory, 'reporter.mjs');
    writeFileSync(reporter, `import { consumeNodeResults } from ${JSON.stringify(moduleUrl)}; export default async function* (events) { yield JSON.stringify(await consumeNodeResults(events, { root: ${JSON.stringify(directory)}, identity: ${JSON.stringify(identity)} })); }`);
    const source = join(directory, 'fixture.test.mjs');
    writeFileSync(source, "import { describe, it } from 'node:test'; describe('group', () => { it('one', () => {}); it('two', () => {}); });");
    // Synthetic tests run only in this isolated child and emit JSON to stdout.
    // They never create artifacts/assurance-node reports or count as product assertions.
    const child = spawnSync(process.execPath, ['--test', '--test-reporter=' + reporter, source], { encoding: 'utf8', timeout: 20000 });
    assert.equal(child.status, 0, child.stderr);
    const r = JSON.parse(child.stdout);
    assert.equal(r.complete, true, JSON.stringify(r.errors));
    assert.deepEqual(r.results.filter(row => row.type === 'test').map(row => row.title), ['group > one', 'group > two']);
    assert.equal(r.summary.counts.tests, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
