import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inventoryCiReports, runCiLighthouse as runLighthouse } from '../tools/run-ci-lighthouse.mjs';
import diagnosticConfig from '../tools/lighthouse-diagnostic.config.mjs';
import { assertCapturePair, lighthouseRuntime, reproduction } from '../tools/lighthouse-diagnostic-support.mjs';
import { exportLanternCriticalPath, flattenEstimate, timerEdges } from '../tools/export-lantern-critical-path.mjs';

// Assertion-runner fixtures do not contain original browser metric inputs.
const runCiLighthouse = options => runLighthouse({ exportDiagnostics() {}, ...options });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, '.lighthouserc.ci.json'), 'utf8'));
const cli = join(root, 'node_modules/@lhci/cli/src/cli.js');

test('normal hosted collection retains raw trace evidence without changing budgets', () => {
  assert.equal(config.ci.collect.settings.saveAssets, true);
  assert.equal(config.ci.assert.assertions['largest-contentful-paint'][1].maxNumericValue, 2500);
  assert.equal(config.ci.assert.assertions['cumulative-layout-shift'][1].maxNumericValue, 0.1);
});

// Synthetic audit fixtures exercise the real assertion CLI; these are not
// collected product measurements or upstream source evidence.
function reportFixture(requestedUrl, { lcp = 1800, performance = 0.99 } = {}) {
  return {
    requestedUrl, finalUrl: config.ci.collect.url[0],
    categories: Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo']
      .map(id => [id, { score: id === 'performance' ? performance : 1 }])),
    audits: {
      'first-contentful-paint': { numericValue: 1000 },
      interactive: { numericValue: 1000 },
      'largest-contentful-paint': { numericValue: lcp, score: 1 },
      'total-blocking-time': { numericValue: 0, score: 1 },
      'cumulative-layout-shift': { numericValue: 0, score: 1 },
      'total-byte-weight': { numericValue: 100000, score: 1 },
      'resource-summary': { score: 1, details: { items: [{ resourceType: 'script', transferSize: 100000 }] } },
    },
  };
}

const reportsFor = (options = {}) => config.ci.collect.url.map((url, index) => ({
  filename: `lhr-${index + 1}.json`, report: reportFixture(url, index === 1 ? options : {}),
}));

function fixture(t) {
  const fixtureRoot = join(root, '.local/ci-lighthouse-tests');
  mkdirSync(fixtureRoot, { recursive: true });
  const cwd = mkdtempSync(join(fixtureRoot, 'case-'));
  t.after(() => {
    assert.ok(cwd.startsWith(`${fixtureRoot}${sep}`));
    rmSync(cwd, { recursive: true, force: true });
  });
  writeFileSync(join(cwd, '.lighthouserc.ci.json'), JSON.stringify(config));
  mkdirSync(join(cwd, 'dist/site'), { recursive: true });
  writeFileSync(join(cwd, 'dist/site/record-delivery-chunks.json'), JSON.stringify({
    home: 'synthetic-main.js', runtimeLoader: 'synthetic-loader.js',
    homeEntryClosures: [], runtimeLoaderClosure: [],
  }));
  return cwd;
}

function writeReports(cwd, reports) {
  const directory = join(cwd, '.lighthouseci');
  mkdirSync(directory, { recursive: true });
  for (const { filename, report } of reports) writeFileSync(join(directory, filename), JSON.stringify(report));
}

function assertWithCli(cwd, args = []) {
  return spawnSync(process.execPath, [cli, 'assert', `--config=${join(cwd, '.lighthouserc.ci.json')}`,
    '--includePassedAssertions', ...args], { cwd, encoding: 'utf8' });
}

test('requested-route inventory rejects missing, duplicate, unexpected and failed reports', () => {
  const reports = reportsFor();
  assert.deepEqual(inventoryCiReports(config, reports), { urls: config.ci.collect.url, runs: 1 });
  assert.throws(() => inventoryCiReports(config, reports.slice(1)), /expected 1 reports, found 0/);
  assert.throws(() => inventoryCiReports(config, [...reports, reports[0]]), /expected 1 reports, found 2/);
  assert.throws(() => inventoryCiReports(config, [...reports, { filename: 'lhr-4.json', report: reportFixture('https://example.test/') }]), /unexpected requested URL/);
  assert.throws(() => inventoryCiReports(config, [{ filename: 'lhr-1.json', report: {} }]), /Missing/);
  assert.throws(() => inventoryCiReports(config, [{ ...reports[0], report: { ...reports[0].report, runtimeError: { code: 'SYNTHETIC_FAILURE' } } }]), /runtime failure/);
  assert.throws(() => inventoryCiReports({ ci: { collect: { url: [], numberOfRuns: 1 } } }, []), /distinct configured URLs/);
});

for (const scenario of [
  { name: 'one requested route fails despite a shared final URL', options: { lcp: 3000 }, fails: true },
  { name: 'performance warnings retain their configured severity', options: { performance: 0.4 }, fails: false },
]) {
  test(scenario.name, t => {
    const cwd = fixture(t);
    const reports = reportsFor(scenario.options);
    writeReports(cwd, reports);
    // Demonstrate the upstream pooling defect against the same configured audits.
    assert.equal(assertWithCli(cwd).status, 0);
    const calls = [];
    const evidence = runCiLighthouse({ cwd, runCommand(command, args) {
      calls.push(command);
      if (command === 'collect') writeReports(cwd, reports);
      if (command === 'assert') {
        assert.ok(args.includes('--includePassedAssertions'));
        const result = assertWithCli(cwd, args);
        if (result.status !== 0) throw new Error(`assert exit ${result.status}`);
      }
      if (command === 'upload') {
        const saved = JSON.parse(readFileSync(join(cwd, '.lighthouseci/assertion-results.json'), 'utf8'));
        assert.equal(saved.length, 3 * Object.keys(config.ci.assert.assertions).length);
        assert.deepEqual([...new Set(saved.map(row => row.requestedUrl))], config.ci.collect.url);
      }
    } });
    assert.deepEqual(calls, ['healthcheck', 'collect', 'assert', 'assert', 'assert', 'upload']);
    assert.equal(evidence.failures.length > 0, scenario.fails);
    assert.equal(evidence.routes.length, 3);
    assert.ok(evidence.routes.every(route => route.assertions.length === Object.keys(config.ci.assert.assertions).length));
    const resource = evidence.routes.find(route => route.requestedUrl.endsWith('/resources'));
    assert.equal(resource.passed, !scenario.fails);
    if (!scenario.fails) assert.ok(resource.assertions.some(row => row.level === 'warn' && !row.passed));
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, config.ci.upload.outputDir, 'route-assertions.json'), 'utf8')), evidence);
  });
}

test('raw assets belong to this collection and enter its existing artifact export', t => {
  const cwd = fixture(t);
  const staleName = 'localhost_2026-01-01_01-01-01-0.trace.json';
  const rawNames = ['localhost_2026-01-02_01-01-01-0.trace.json', 'localhost_2026-01-02_01-01-01-0.devtoolslog.json'];
  const simulatedName = 'localhost_2026-01-02_01-01-01-lcp-optimistic.trace.json';
  writeFileSync(join(cwd, staleName), 'synthetic stale trace fixture');
  const evidence = runCiLighthouse({ cwd, runCommand(command, args) {
    if (command === 'collect') {
      writeReports(cwd, reportsFor());
      for (const name of [...rawNames, simulatedName]) writeFileSync(join(cwd, name), 'synthetic collection asset fixture');
    }
    if (command === 'assert') {
      const result = assertWithCli(cwd, args);
      if (result.status !== 0) throw new Error(`assert exit ${result.status}`);
    }
  } });
  assert.deepEqual(evidence.rawAssets.sort(), rawNames.sort());
  const graphBytes = readFileSync(join(cwd, 'dist/site/record-delivery-chunks.json'));
  assert.deepEqual(readFileSync(join(cwd, config.ci.upload.outputDir, 'record-delivery-chunks.json')), graphBytes);
  assert.deepEqual(evidence.deliveryGraph, { file: 'record-delivery-chunks.json', sha256: createHash('sha256').update(graphBytes).digest('hex') });
  for (const name of rawNames) {
    assert.equal(existsSync(join(cwd, name)), false);
    assert.equal(existsSync(join(cwd, config.ci.upload.outputDir, 'raw-assets', name)), true);
  }
  assert.equal(existsSync(join(cwd, staleName)), true);
  assert.equal(existsSync(join(cwd, simulatedName)), true);
});

test('failed collection cannot admit or upload stale assertion evidence', t => {
  const cwd = fixture(t);
  writeReports(cwd, reportsFor());
  writeFileSync(join(cwd, '.lighthouseci/assertion-results.json'), '[{"passed":true}]');
  const outputDirectory = join(cwd, config.ci.upload.outputDir);
  mkdirSync(outputDirectory, { recursive: true });
  const staleExport = join(outputDirectory, 'old-synthetic.report.html');
  writeFileSync(staleExport, 'Synthetic stale export');
  const calls = [];
  const evidence = runCiLighthouse({ cwd, runCommand(command) {
    calls.push(command);
    if (command === 'collect') throw new Error('Synthetic collection failure');
    if (command === 'upload') {
      assert.equal(readdirSync(join(cwd, '.lighthouseci')).filter(name => name.startsWith('lhr-')).length, 0);
      assert.equal(existsSync(staleExport), false);
    }
  } });
  assert.deepEqual(calls, ['healthcheck', 'collect', 'upload']);
  assert.equal(evidence.routes.length, 0);
  assert.ok(evidence.failures.some(message => message.includes('collection failure')));
  assert.ok(evidence.failures.some(message => message.includes('expected 1 reports, found 0')));
  assert.deepEqual(readdirSync(outputDirectory), ['record-delivery-chunks.json', 'route-assertions.json']);
});

test('a missing build graph is recorded as a failure rather than borrowed from an older export', t => {
  const cwd = fixture(t);
  rmSync(join(cwd, 'dist/site/record-delivery-chunks.json'));
  const evidence = runCiLighthouse({ cwd, runCommand() {} });
  assert.equal(evidence.deliveryGraph, null);
  assert.ok(evidence.failures.some(message => message.startsWith('build graph export:')));
  assert.equal(existsSync(join(cwd, config.ci.upload.outputDir, 'record-delivery-chunks.json')), false);
});

test('export cleanup rejects a directory outside the dedicated report output', t => {
  const cwd = fixture(t);
  const sentinel = join(cwd, 'keep.txt');
  writeFileSync(sentinel, 'Retained fixture');
  writeFileSync(join(cwd, '.lighthouserc.ci.json'), JSON.stringify({
    ...config, ci: { ...config.ci, upload: { ...config.ci.upload, outputDir: '.' } },
  }));
  assert.throws(() => runCiLighthouse({ cwd, runCommand() {} }), /dedicated.*filesystem export/);
  assert.equal(readFileSync(sentinel, 'utf8'), 'Retained fixture');
});

test('a successful CLI exit without assertion evidence cannot mark a route passed', t => {
  const cwd = fixture(t);
  const evidence = runCiLighthouse({ cwd, runCommand(command) {
    if (command === 'collect') writeReports(cwd, reportsFor());
  } });
  assert.equal(evidence.routes.length, 3);
  assert.ok(evidence.routes.every(route => !route.passed && route.assertions.length === 0));
  assert.equal(evidence.failures.length, 3);
});

test('malformed fresh reports fail and still invoke report export', t => {
  const cwd = fixture(t);
  const calls = [];
  const evidence = runCiLighthouse({ cwd, runCommand(command) {
    calls.push(command);
    if (command === 'collect') writeFileSync(join(cwd, '.lighthouseci/lhr-1.json'), '{invalid');
  } });
  assert.deepEqual(calls, ['healthcheck', 'collect', 'upload']);
  assert.ok(evidence.failures.some(message => message.startsWith('report inventory:')));
});

test('diagnostic extension preserves default audits, artifacts, settings and scoring', async () => {
  const runtime = lighthouseRuntime(root);
  assert.equal(runtime.version, '13.4.1');
  const { initializeConfig } = await runtime.load('core/config/config.js');
  const { configPath, ...settings } = config.ci.collect.settings;
  const baseline = (await initializeConfig('navigation', undefined, settings)).resolvedConfig;
  const diagnostic = (await initializeConfig('navigation', diagnosticConfig, {
    ...settings, configPath: resolve(root, configPath),
  })).resolvedConfig;
  const diagnosticRefs = diagnostic.categories.performance.auditRefs;
  assert.deepEqual(diagnosticRefs.filter(ref => ref.id !== 'atlas-metric-inputs'), baseline.categories.performance.auditRefs);
  assert.equal(diagnosticRefs.find(ref => ref.id === 'atlas-metric-inputs').weight, 0);
  for (const id of ['accessibility', 'best-practices', 'seo']) assert.deepEqual(diagnostic.categories[id], baseline.categories[id]);
  assert.deepEqual(diagnostic.artifacts.map(artifact => artifact.id), baseline.artifacts.map(artifact => artifact.id));
  assert.deepEqual(diagnostic.audits.filter(audit => audit.implementation.meta.id !== 'atlas-metric-inputs')
    .map(audit => audit.implementation.meta.id), baseline.audits.map(audit => audit.implementation.meta.id));
  assert.deepEqual(diagnostic.settings, baseline.settings);
  // Lighthouse narrows the audit argument to declared artifacts, including
  // base metadata. Every source artifact we capture must cross that boundary.
  const captureAudit = diagnostic.audits.find(audit => audit.implementation.meta.id === 'atlas-metric-inputs');
  const captureSource = readFileSync(join(root, 'tools/lighthouse-metric-inputs.audit.mjs'), 'utf8');
  for (const [, name] of captureSource.matchAll(/\bartifacts\.([A-Za-z_][A-Za-z_0-9]*)/g)) {
    assert.ok(captureAudit.implementation.meta.requiredArtifacts.includes(name), `Captured artifact ${name} must be declared.`);
  }
});

test('record pairing rejects pooled final URLs, different navigation and fetch time', () => {
  const identity = { frameId: 'synthetic-frame', navigationId: 'synthetic-navigation', timeOriginUs: 1000000 };
  const report = { requestedUrl: config.ci.collect.url[2], fetchTime: '2026-01-01T00:00:00.000Z',
    finalUrl: config.ci.collect.url[0], finalDisplayedUrl: config.ci.collect.url[2] };
  const capture = { fetchTime: report.fetchTime, identity,
    URL: { requestedUrl: report.requestedUrl, mainDocumentUrl: report.finalUrl, finalDisplayedUrl: report.finalDisplayedUrl } };
  assert.doesNotThrow(() => assertCapturePair(report, capture, { identity }, identity));
  assert.throws(() => assertCapturePair({ ...report, requestedUrl: config.ci.collect.url[1] }, capture, { identity }, identity), /URL\/fetchTime/);
  assert.throws(() => assertCapturePair(report, { ...capture, fetchTime: 'other' }, { identity }, identity), /URL\/fetchTime/);
  assert.throws(() => assertCapturePair(report, capture, { identity }, { ...identity, navigationId: 'different' }), /navigation identity/);
  assert.equal(reproduction(4323.0362, 4323.5).accepted, true);
  assert.equal(reproduction(4323.0362, 4168.8635).accepted, false);
  assert.equal(reproduction(undefined, 0).accepted, false);
});

test('graph export distinguishes observed and modeled waits and excludes offscreen image maxima', () => {
  // Synthetic timing data tests units and accounting, not product performance.
  const request = { requestId: 'request', url: 'https://example.test/script.js', resourceType: 'Script', priority: 'High',
    transferSize: 100, resourceSize: 200, networkRequestTime: 10, responseHeadersEndTime: 20, networkEndTime: 30 };
  const network = { id: 'request', type: 'network', startTime: 1000000, endTime: 1030000, request, getDependencies: () => [] };
  const cpu = { id: 'render', type: 'cpu', startTime: 1030000, endTime: 1040000, getDependencies: () => [network],
    event: { name: 'RunTask', ts: 1030000, dur: 10000 }, childEvents: [],
    didPerformLayout: () => true, getEvaluateScriptURLs: () => new Set() };
  const image = { ...network, id: 'offscreen', request: { ...request, resourceType: 'Image', priority: 'Low' } };
  const graph = { traverse: visit => [network, cpu, image].forEach(visit) };
  const estimate = { timeInMs: 450, nodeTimings: new Map([
    [network, { startTime: 0, endTime: 300, duration: 300 }],
    [cpu, { startTime: 400, endTime: 450, duration: 50 }],
    [image, { startTime: 0, endTime: 999, duration: 999 }],
  ]) };
  const complete = new Map([[network, { queuedTime: 0, connectionTiming: { timeToFirstByte: 200 } }], [cpu, { queuedTime: 300 }]]);
  const exported = flattenEstimate(graph, estimate, complete, 1000000);
  const cpuRow = exported.nodes.find(node => node.id === 'render');
  const networkRow = exported.nodes.find(node => node.id === 'request');
  assert.deepEqual(cpuRow.observed, { startMs: 30, endMs: 40, durationMs: 10 });
  assert.equal(cpuRow.modeled.queueWaitMs, 100);
  assert.equal(networkRow.network.observedWaitMs, 10);
  assert.equal(networkRow.network.observedTransferMs, 10);
  assert.equal(networkRow.network.modeledTransferMs, 100);
  assert.equal(exported.nodes.find(node => node.id === 'offscreen').excludedFromLcpMaximum, true);
  assert.deepEqual(exported.predecessorChains, [{ terminalId: 'render', ids: ['request', 'render'] }]);
});

test('missing originals are exported as a gap and diagnostic errors retain failed assertions', async t => {
  const cwd = fixture(t);
  const evidence = runCiLighthouse({ cwd, runCommand(command, args) {
    if (command === 'collect') writeReports(cwd, reportsFor({ lcp: 3000 }));
    if (command === 'assert') {
      const asserted = assertWithCli(cwd, args);
      if (asserted.status !== 0) throw new Error(`assert exit ${asserted.status}`);
    }
  }, exportDiagnostics() { throw new Error('Synthetic diagnostic export failure'); } });
  assert.ok(evidence.failures.some(message => message.startsWith('assert:')));
  assert.ok(evidence.failures.some(message => message.startsWith('diagnostic export:')));
  assert.equal(evidence.routes.find(route => route.requestedUrl.endsWith('/resources')).passed, false);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, config.ci.upload.outputDir, 'route-assertions.json'), 'utf8')), evidence);
  const gap = await exportLanternCriticalPath({ cwd });
  assert.equal(gap.status, 'unavailable');
  assert.deepEqual(gap.gaps, ['Original URL/GatherContext/settings/simulator/SourceMaps/HostDPR capture is missing.']);
  assert.equal(gap.reproduction, undefined);
});

test('timer mapping reports observed elapsed time and actual graph membership without inferring cause', () => {
  const install = { name: 'TimerInstall', ts: 1000000, pid: 1, tid: 2, args: { data: { timerId: 7, timeout: 10 } } };
  const fire = { name: 'TimerFire', ts: 1015000, pid: 1, tid: 2, args: { data: { timerId: 7 } } };
  const child = { name: 'TimerFire', tsUs: fire.ts, pid: fire.pid, tid: fire.tid, args: fire.args };
  const estimates = { optimistic: { nodes: [
    { id: 'fire-task', cpu: { childEvents: [child] } },
    { id: 'another-timer', cpu: { childEvents: [{ ...child, args: { data: { timerId: 8 } } }] } },
    { id: 'another-thread', cpu: { childEvents: [{ ...child, tid: 3 }] } },
  ] } };
  const [edge] = timerEdges([fire, install], estimates);
  assert.equal(edge.observedElapsedMs, 15);
  assert.equal(edge.declaredTimeoutMs, 10);
  assert.deepEqual(edge.installGraphNodes, { optimistic: [] });
  assert.deepEqual(edge.fireGraphNodes, { optimistic: ['fire-task'] });
  assert.match(edge.relation, /does not prove/);
});
