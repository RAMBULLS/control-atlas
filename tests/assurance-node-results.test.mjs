import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createNodeResultCollector, assessNativeAssertions, validateNativeIdentity, nativeReportDigest, boundedNativeSource } from '../tools/lib/assurance-node-results.mjs';

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
  ['missing start', e => e.slice(1)],
  ['duplicate start', e => [e[0], e[0], e[1], e[2]]],
  ['unclosed start', e => [e[0], e[1], { type: 'test:start', data: metrics('ghost') }, e[2]]],
  ['start after final summary', e => [...e, { type: 'test:start', data: metrics('ghost') }]],
  ['terminal after final summary', e => [...e, e[1]]],
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
    const child = spawnSync(process.execPath, ['--test', '--test-reporter=' + pathToFileURL(reporter).href, source], { encoding: 'utf8', timeout: 20000, env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {} });
    assert.equal(child.status, 0, child.stderr);
    assert.ok(child.stdout.trim(), 'Missing native child report: ' + child.stderr);
    const r = JSON.parse(child.stdout);
    assert.equal(r.complete, true, JSON.stringify(r.errors));
    assert.deepEqual(r.results.filter(row => row.type === 'test').map(row => row.title), ['group > one', 'group > two']);
    assert.equal(r.summary.counts.tests, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('Windows source bounds reject other volumes, UNC roots and same-volume traversal', () => {
  assert.equal(boundedNativeSource('C:\\repo', 'D:\\outside.mjs', win32), null);
  assert.equal(boundedNativeSource('C:\\repo', 'C:\\outside.mjs', win32), null);
  assert.equal(boundedNativeSource('C:\\repo', '\\\\server\\share\\outside.mjs', win32), null);
  assert.equal(boundedNativeSource('C:\\repo', 'C:\\repo\\tests\\one.mjs', win32), 'tests/one.mjs');
});

test('the production reporter retains native success, cancellation, empty reasons and hook failure facts', () => {
  const reporter = resolve('tools/assurance-node-reporter.mjs');
  const scenarios = [
    { name: 'multiple-files', exit: 0, complete: true,
      source: "import { describe, it } from 'node:test'; describe('group', () => { it('one', () => {}); it('two', () => {}); });",
      second: "import test from 'node:test'; test('parent', async t => { await Promise.all([t.test('a', async () => {}), t.test('b', async () => {})]); });" },
    { name: 'timeout', exit: 1, complete: true, cancelled: true,
      source: "import test from 'node:test'; import { setTimeout as delay } from 'node:timers/promises'; test('times out', { timeout: 20 }, async () => { await delay(200); });" },
    { name: 'abort', exit: 1, complete: true, cancelled: true,
      source: "import test from 'node:test'; import { setTimeout as delay } from 'node:timers/promises'; const ac = new AbortController(); test('aborted', { signal: ac.signal }, async () => { await delay(200); }); setTimeout(() => ac.abort(), 10);" },
    { name: 'parent-cancellation', exit: 1, complete: true, cancelled: true,
      source: "import test from 'node:test'; import { setTimeout as delay } from 'node:timers/promises'; test('parent', t => { t.test('unawaited', async () => { await delay(200); }); });" },
    { name: 'empty-reasons', exit: 0, complete: true,
      source: "import test from 'node:test'; test('skip empty', t => t.skip('')); test('todo empty', t => t.todo(''));" },
    { name: 'root-after-hook', exit: 1, complete: true,
      source: "import test, { after } from 'node:test'; test('one', () => {}); after(() => { throw new Error('synthetic root hook failure'); });" },
  ];
  for (const scenario of scenarios) {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-native-production-'));
    try {
      const source = join(directory, 'fixture.test.mjs');
      writeFileSync(source, scenario.source);
      const inputs = [source];
      if (scenario.second) {
        const second = join(directory, 'second.test.mjs');
        writeFileSync(second, scenario.second);
        inputs.push(second);
      }
      // These are synthetic parser fixtures. No inherited API token or candidate
      // result directory reaches the child; files remain under its private temp root.
      const env = {
        GITHUB_REPOSITORY: identity.repository, ATLAS_RUNNER_HEAD_SHA: identity.code_sha,
        GITHUB_SHA: identity.checkout_sha, GITHUB_RUN_ID: identity.run_id,
        GITHUB_RUN_ATTEMPT: String(identity.run_attempt), GITHUB_JOB: identity.job_key,
        npm_lifecycle_event: identity.command,
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
      };
      const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-reporter=' + pathToFileURL(reporter).href,
        '--test-reporter-destination=stdout', '--test-reporter-destination=stdout', ...inputs],
      { cwd: directory, env, encoding: 'utf8', timeout: 10000 });
      assert.equal(child.status, scenario.exit, scenario.name + ': ' + child.stderr);
      const output = join(directory, 'artifacts', 'assurance-node');
      const names = readdirSync(output).filter(name => name.endsWith('.json'));
      assert.equal(names.length, 1, scenario.name);
      const result = JSON.parse(readFileSync(join(output, names[0]), 'utf8'));
      assert.equal(result.complete, scenario.complete, scenario.name + ': ' + JSON.stringify(result.errors));
      assert.equal(result.identity.command, 'synthetic-validator-fixture');
      assert.match(child.stdout, /Native assurance diagnostic saved:/);
      if (scenario.cancelled) assert.ok(result.results.some(row => row.status === 'cancelled'), scenario.name);
      if (scenario.name === 'empty-reasons') assert.deepEqual(result.results.map(row => row.status), ['skipped', 'todo']);
      if (scenario.name === 'root-after-hook') assert.ok(result.results.some(row => row.synthetic_hook_failure));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
