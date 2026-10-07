import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inventoryCiReports, runCiLighthouse } from '../tools/run-ci-lighthouse.mjs';

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
  assert.deepEqual(readdirSync(outputDirectory), ['route-assertions.json']);
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
