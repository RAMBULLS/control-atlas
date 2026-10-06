import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { bracketHostSample, clockAnchors, ownedDescendants, retainPartialCollection, runCollection, siteIdentity, summarizeCollection, validateDiagnosticInput } from '../tools/run-performance-diagnostic.mjs';

// Offline synthetic fixtures test admission and retention, not product performance.
const sha = 'a'.repeat(40);
const input = () => ({ run: { id: 42, run_attempt: 1, head_sha: sha, status: 'completed', path: '.github/workflows/ci.yml' },
  build: { name: 'Build immutable site artifact', run_id: 42, run_attempt: 1, conclusion: 'success', started_at: '2026-01-01T01:00:00Z', completed_at: '2026-01-01T01:05:00Z' },
  artifact: { id: 7, name: 'site-build', expired: false, size_in_bytes: 100, digest: `sha256:${'b'.repeat(64)}`, created_at: '2026-01-01T01:04:00Z', workflow_run: { id: 42, head_sha: sha } } });

test('diagnostic admits only a complete exact-head successful build and its immutable artifact', () => {
  validateDiagnosticInput(input(), sha);
  for (const alter of [
    value => value.run.head_sha = 'c'.repeat(40), value => value.run.status = 'in_progress',
    value => value.build.conclusion = 'failure', value => value.build.run_id++, value => value.build.run_attempt++,
    value => value.artifact.workflow_run.id++, value => value.artifact.workflow_run.head_sha = 'c'.repeat(40),
    value => value.artifact.expired = true, value => value.artifact.digest = 'sha256:short', value => value.artifact.size_in_bytes = 0,
    value => value.artifact.created_at = '2026-01-01T00:04:00Z', value => value.artifact.created_at = '2026-01-01T02:00:00Z',
    value => value.build.started_at = null,
  ]) { const value = input(); alter(value); assert.throws(() => validateDiagnosticInput(value, sha), /exact-head/); }
});

test('host sample brackets include collection reads and preserve unavailable observations', () => {
  let time = 1;
  const sample = bracketHostSample(() => { time = 20; return { cpu: { value: null, unavailable: 'ENOENT' } }; },
    { monotonic: () => String(time), wall: () => 100 });
  assert.equal(sample.monotonicBeginNs, '1'); assert.equal(sample.monotonicEndNs, '20');
  assert.equal(sample.cpu.value, null); assert.equal(sample.cpu.unavailable, 'ENOENT');
});

test('timeout cleanup ownership follows descendants and retained orphans but excludes reused and unrelated PIDs', () => {
  const snapshot = [{ pid: 10, ppid: 1, startTicks: '10' }, { pid: 11, ppid: 10, startTicks: '11' },
    { pid: 12, ppid: 11, startTicks: '12' }, { pid: 13, ppid: 1, startTicks: '13' }, { pid: 14, ppid: 1, startTicks: '99' }, { pid: 15, ppid: 1, startTicks: '15' }];
  assert.deepEqual(ownedDescendants(snapshot, { pid: 10, startTicks: '10' }, [{ pid: 13, ppid: 12, startTicks: '13' }, { pid: 14, ppid: 12, startTicks: '14' }])
    .map(item => item.pid).sort((a, b) => a - b), [11, 12, 13]);
  assert.deepEqual(ownedDescendants(snapshot, { pid: 10, startTicks: 'old' }, [{ pid: 13, ppid: 12, startTicks: '13' }]).map(item => item.pid), [13]);
  const beforeShutdown = ownedDescendants(snapshot, { pid: 10, startTicks: '10' });
  const duringShutdown = [...snapshot.filter(item => item.pid !== 10), { pid: 16, ppid: 12, startTicks: '16' }];
  assert.deepEqual(ownedDescendants(duringShutdown, { pid: 10, startTicks: '10' }, beforeShutdown).map(item => item.pid).sort((a, b) => a - b), [11, 12, 16]);
});

test('browser clock pairing uses actual event timestamps and missing anchors remain unknown', () => {
  assert.equal(clockAnchors({ traceEvents: [] }, []).status, 'unknown');
  const paired = clockAnchors({ traceEvents: [{ name: 'ResourceSendRequest', ts: 2000100, args: { data: { requestId: 'fixture' } } }] },
    [{ method: 'Network.requestWillBeSent', params: { requestId: 'fixture', timestamp: 2, wallTime: 100 } }]);
  assert.equal(paired.first.traceToDevtoolsUs, 100);
  assert.equal(paired.first.wallTimeMs, 100000);
  assert.match(paired.limitation, /not precise task attribution/);
});

function fixture(t) {
  const root = resolve('.local/performance-diagnostic-tests'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'case-'));
  t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}

for (const cancelled of [false, true]) test(`Linux owned collection ${cancelled ? 'cancellation' : 'timeout'} stops its child tree`, { skip: process.platform !== 'linux' }, async t => {
  const directory = fixture(t); const pidFile = join(directory, 'fixture-pids.json');
  const code = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});
    writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid])); setInterval(()=>{},1000);`;
  const controller = new AbortController();
  const timer = cancelled ? setTimeout(() => controller.abort(), 1800) : null;
  try { await assert.rejects(runCollection(directory, controller.signal, { args: ['-e', code], timeoutMs: cancelled ? 10000 : 1800 }), cancelled ? /cancellation/ : /timeout/); }
  finally { if (timer) clearTimeout(timer); }
  const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
  for (const pid of pids) {
    const stat = `/proc/${pid}/stat`;
    if (existsSync(stat)) assert.equal(readFileSync(stat, 'utf8').split(') ')[1].split(' ')[0], 'Z', 'owned child must be stopped');
  }
});

test('interrupted collection retains partial reports and raw assets without admitting or removing unrelated files', t => {
  const directory = fixture(t); const cwd = join(directory, 'cwd'); const destination = join(directory, 'collection');
  mkdirSync(join(cwd, '.lighthouseci'), { recursive: true }); mkdirSync(destination);
  writeFileSync(join(cwd, '.lighthouseci/lhr-1.json'), '{}'); writeFileSync(join(cwd, 'fixture-0.trace.json'), '{}');
  writeFileSync(join(cwd, 'unrelated.json'), 'preserve'); retainPartialCollection(destination, cwd);
  assert.equal(JSON.parse(readFileSync(join(destination, 'partial/incomplete.json'))).complete, false);
  assert.equal(readFileSync(join(destination, 'partial/.lighthouseci/lhr-1.json'), 'utf8'), '{}');
  assert.equal(readFileSync(join(destination, 'partial/fixture-0.trace.json'), 'utf8'), '{}');
  assert.equal(readFileSync(join(cwd, 'unrelated.json'), 'utf8'), 'preserve');
});

test('artifact identity detects added, changed and removed bytes independently of release metadata', t => {
  const directory = fixture(t); writeFileSync(join(directory, 'release.json'), JSON.stringify({ commit_sha: sha }));
  const original = siteIdentity(directory);
  writeFileSync(join(directory, 'asset.js'), 'one'); const added = siteIdentity(directory);
  writeFileSync(join(directory, 'asset.js'), 'two'); const changed = siteIdentity(directory);
  assert.notEqual(original.sha256, added.sha256); assert.notEqual(added.sha256, changed.sha256);
  rmSync(join(directory, 'asset.js')); assert.deepEqual(siteIdentity(directory), original);
});

test('collections retain failing budgets and all raw assets; incomplete or tampered evidence is rejected', t => {
  const directory = fixture(t); const urls = ['http://localhost:4317/', 'http://localhost:4317/#/resources', 'http://localhost:4317/#/record/nist-800-53/AC-2'];
  const evidence = { numberOfRuns: 1, failures: ['assert: Lighthouse assert failed with exit 1'],
    routes: urls.map(requestedUrl => ({ requestedUrl, assertions: Array.from({ length: 9 }, () => ({ passed: false })) })), diagnostics: [] };
  for (const [index, requestedUrl] of urls.entries()) {
    const fetchTime = `2026-01-01T00:00:0${index}.000Z`;
    const report = { requestedUrl, fetchTime, lighthouseVersion: 'fixture', environment: { hostUserAgent: 'fixture', benchmarkIndex: 1 }, configSettings: {},
      audits: Object.fromEntries(['largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift'].map(key => [key, { numericValue: 3000 }])) };
    report.audits.metrics = { details: { items: [{ observedLargestContentfulPaint: 100 }] } };
    writeFileSync(join(directory, `${index}.report.json`), JSON.stringify(report));
    const files = ['-0.trace.json', '-0.devtoolslog.json', '-optimisticLargestContentfulPaint.trace.json', '-pessimisticLargestContentfulPaint.trace.json'].map(suffix => {
      const path = `${index}${suffix}`; const bytes = Buffer.from(JSON.stringify(suffix.includes('devtoolslog') ? [] : { traceEvents: [] }));
      writeFileSync(join(directory, path), bytes); return { path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    evidence.diagnostics.push({ requestedUrl, fetchTime, files });
  }
  const save = () => writeFileSync(join(directory, 'route-assertions.json'), JSON.stringify(evidence)); save();
  const routes = summarizeCollection(directory, urls); assert.equal(routes.length, 3); assert.equal(routes[0].lcp, 3000);
  assert.equal(routes[0].assertions[0].passed, false);
  evidence.failures.push('collect: runtime failure'); save(); assert.throws(() => summarizeCollection(directory, urls), /Incomplete/);
  evidence.failures.pop(); evidence.routes.pop(); save(); assert.throws(() => summarizeCollection(directory, urls), /Incomplete/);
  evidence.routes.push({ requestedUrl: urls[2], assertions: Array(9).fill({ passed: false }) }); save();
  writeFileSync(join(directory, evidence.diagnostics[0].files[0].path), '{}'); assert.throws(() => summarizeCollection(directory, urls), /integrity/);
});

test('diagnostic stays separate from required acceptance and downloads one build without rebuilding', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8')); const job = ci.jobs['performance-diagnostic'];
  assert.equal(job['timeout-minutes'], 20);
  assert.match(job.if, /workflow_dispatch.*performance-diagnostic/);
  const steps = JSON.stringify(job.steps); assert.match(steps, /artifact-ids/); assert.match(steps, /diagnostic_run_id/);
  assert.doesNotMatch(steps, /build:site|lighthouse-ab|BEFORE_REF|AFTER_REF/);
  assert.ok(!ci.jobs.required.needs.includes('performance-diagnostic'));
  const runner = readFileSync('tools/run-performance-diagnostic.mjs', 'utf8');
  assert.match(runner, /ordinal <= 3/); assert.doesNotMatch(runner, /Worker\(|worker_threads/);
  const config = JSON.parse(readFileSync('.lighthouserc.ci.json', 'utf8'));
  assert.equal(config.ci.collect.numberOfRuns, 1);
  assert.equal(config.ci.assert.assertions['largest-contentful-paint'][1].maxNumericValue, 2500);
  assert.equal(config.ci.assert.assertions['total-blocking-time'][1].maxNumericValue, 800);
});
