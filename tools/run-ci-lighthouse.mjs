import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNodeSync } from './lib/process-runner.mjs';
import { assertHttp2Report, prepareLighthouseHttp2 } from './lighthouse-http2.mjs';

const REPORT_FILE = /^lhr-\d+\.json$/;
const RAW_ASSET_FILE = /_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d+\.(trace|devtoolslog)\.json$/;

export function inventoryCiReports(config, reports) {
  const urls = config.ci?.collect?.url;
  const runs = config.ci?.collect?.numberOfRuns;
  if (!Array.isArray(urls) || !urls.length || new Set(urls).size !== urls.length ||
      !urls.every(url => typeof url === 'string' && url.length > 0) ||
      !Number.isInteger(runs) || runs < 1) {
    throw new Error('CI Lighthouse requires distinct configured URLs and a positive run count.');
  }
  const counts = new Map(urls.map(url => [url, 0]));
  for (const { filename, report } of reports) {
    if (!report || !counts.has(report.requestedUrl)) {
      throw new Error(`Missing or unexpected requested URL in ${filename}.`);
    }
    if (report.runtimeError) throw new Error(`Lighthouse runtime failure in ${filename}.`);
    counts.set(report.requestedUrl, counts.get(report.requestedUrl) + 1);
  }
  for (const [url, count] of counts) {
    if (count !== runs) throw new Error(`${url}: expected ${runs} reports, found ${count}.`);
  }
  return { urls, runs };
}

export function runCiLighthouse({ cwd = process.cwd(), runCommand, exportDiagnostics, warmupRuns = 2,
  configPath = resolve(cwd, '.lighthouserc.ci.json'), requireHttp2 = false } = {}) {
  if (![0, 2].includes(warmupRuns)) throw new Error('Use the fixed two-run host warmup.');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const reportDirectory = join(cwd, '.lighthouseci');
  const assertionPath = join(reportDirectory, 'assertion-results.json');
  const outputDirectory = resolve(cwd, 'artifacts/lighthouse-ci');
  const existingAssets = new Set(readdirSync(cwd).filter(filename => RAW_ASSET_FILE.test(filename)));
  if (config.ci?.upload?.target !== 'filesystem' ||
      resolve(cwd, config.ci.upload.outputDir ?? '') !== outputDirectory) {
    throw new Error('CI Lighthouse requires its dedicated artifacts/lighthouse-ci filesystem export.');
  }
  const cli = resolve(cwd, 'node_modules/@lhci/cli/src/cli.js');
  const run = runCommand ?? ((command, args) => runNodeSync(
    [cli, command, `--config=${configPath}`, ...args],
    { cwd, stdio: 'inherit', label: `Lighthouse ${command}` },
  ));
  const failures = [];
  const routes = [];
  const attempt = (command, args = []) => {
    try {
      run(command, args);
      return true;
    } catch (error) {
      failures.push(`${command}: ${error.message}`);
      return false;
    }
  };

  // Only this validated, dedicated report export may be replaced. Removing it
  // before collection prevents a failed invocation from retaining older reports.
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(reportDirectory, { recursive: true });
  rmSync(join(reportDirectory, 'metric-inputs'), { recursive: true, force: true });
  // A failed collection must never upload evidence from an earlier invocation.
  for (const filename of readdirSync(reportDirectory)) {
    if (/^lhr-\d+\.(json|html)$/.test(filename) || filename === 'assertion-results.json') {
      rmSync(join(reportDirectory, filename));
    }
  }
  const warmups = { runsPerRoute: warmupRuns, reports: [], directory: 'warmups' };
  if (attempt('healthcheck', ['--fatal'])) {
    let warmed = !warmupRuns;
    if (warmupRuns) {
      const collected = attempt('collect', [`--numberOfRuns=${warmupRuns}`]);
      const warmupDirectory = join(outputDirectory, 'warmups');
      mkdirSync(warmupDirectory, { recursive: true });
      try {
        const reports = readdirSync(reportDirectory).filter(filename => REPORT_FILE.test(filename))
          .map(filename => ({ filename, report: JSON.parse(readFileSync(join(reportDirectory, filename), 'utf8')) }));
        inventoryCiReports({ ci: { collect: { ...config.ci.collect, numberOfRuns: warmupRuns } } }, reports);
        warmups.reports = reports.map(({ filename, report }) => ({ filename, requestedUrl: report.requestedUrl }));
        warmed = collected;
      } catch (error) {
        failures.push(`host warmup: ${error.message}`);
      }
      // Fixed before any scores exist. Retain all warmups separately, then
      // collect new cold-browser measurements with every original assertion.
      for (const filename of readdirSync(reportDirectory)) {
        if (/^lhr-\d+\.(json|html)$/.test(filename) || filename === 'metric-inputs') {
          renameSync(join(reportDirectory, filename), join(warmupDirectory, filename));
        }
      }
      for (const filename of readdirSync(cwd).filter(filename => RAW_ASSET_FILE.test(filename) && !existingAssets.has(filename))) {
        renameSync(join(cwd, filename), join(warmupDirectory, filename));
      }
    }
    if (warmed) attempt('collect');
  }

  try {
    const reports = readdirSync(reportDirectory).filter(filename => REPORT_FILE.test(filename))
      .sort().map(filename => ({ filename, report: JSON.parse(readFileSync(join(reportDirectory, filename), 'utf8')) }));
    inventoryCiReports(config, reports);
    for (const { filename, report } of reports) {
      const transport = requireHttp2 ? assertHttp2Report(report) : undefined;
      rmSync(assertionPath, { force: true });
      console.log(`Checking Lighthouse route ${report.requestedUrl} (${filename})`);
      // LHCI groups by finalUrl, which drops SPA hashes. A single-file assertion
      // retains every configured audit and severity without pooling other routes.
      const passed = attempt('assert', [`--lhr=${join(reportDirectory, filename)}`, '--includePassedAssertions']);
      let assertions = [];
      try {
        assertions = JSON.parse(readFileSync(assertionPath, 'utf8'));
        if (!Array.isArray(assertions) || !assertions.length) throw new Error('No assertion results.');
      } catch (error) {
        failures.push(`${report.requestedUrl}: ${error.message}`);
        assertions = [];
      }
      routes.push({ requestedUrl: report.requestedUrl, ...(typeof report.fetchTime === 'string' ? { fetchTime: report.fetchTime } : {}), ...(transport ? { transport } : {}), filename, passed: passed && assertions.length > 0, assertions });
    }
  } catch (error) {
    failures.push(`report inventory: ${error.message}`);
  }

  // LHCI overwrites its assertion file. Preserve all route results for upload.
  writeFileSync(assertionPath, JSON.stringify(routes.flatMap(route => route.assertions.map(assertion => ({
    ...assertion, requestedUrl: route.requestedUrl, reportFile: route.filename,
  }))), null, 2));
  attempt('upload');
  mkdirSync(outputDirectory, { recursive: true });
  let deliveryGraph = null;
  try {
    const path = join(cwd, 'dist/site/record-delivery-chunks.json');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Invalid bounded build-graph file.');
    const bytes = readFileSync(path);
    const graph = JSON.parse(bytes.toString('utf8'));
    if (!graph.home || !graph.runtimeLoader || !Array.isArray(graph.homeEntryClosures) || !Array.isArray(graph.runtimeLoaderClosure)) {
      throw new Error('Build-graph closure evidence is missing.');
    }
    writeFileSync(join(outputDirectory, 'record-delivery-chunks.json'), bytes);
    deliveryGraph = { file: 'record-delivery-chunks.json', sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    failures.push(`build graph export: ${error.message}`);
  }
  // Retain this collection's raw evidence in the existing uploaded export.
  // Lighthouse saves it at cwd even when its JSON report goes to stdout.
  // Leave pre-existing files and auxiliary simulated traces untouched.
  const rawAssets = readdirSync(cwd).filter(filename => RAW_ASSET_FILE.test(filename) && !existingAssets.has(filename));
  if (rawAssets.length) {
    const assetDirectory = join(outputDirectory, 'raw-assets');
    mkdirSync(assetDirectory, { recursive: true });
    for (const filename of rawAssets) renameSync(join(cwd, filename), join(assetDirectory, filename));
  }
  const evidence = {
    warmups,
    expectedRoutes: config.ci.collect.url,
    numberOfRuns: config.ci.collect.numberOfRuns,
    routes,
    rawAssets,
    deliveryGraph,
    failures,
  };
  writeFileSync(join(outputDirectory, 'route-assertions.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  try {
    const exportDiagnostic = exportDiagnostics ?? (() => runNodeSync(
      [resolve(cwd, 'tools/export-lantern-critical-path.mjs')],
      { cwd, stdio: 'inherit', label: 'Lighthouse offline diagnostic' },
    ));
    exportDiagnostic();
  } catch (error) {
    // Preserve every original route assertion, including performance failures.
    evidence.failures.push(`diagnostic export: ${error.message}`);
    writeFileSync(join(outputDirectory, 'route-assertions.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return evidence;
}

export function runProductionTransport({ cwd = process.cwd(), compareHttp1 = false,
  runCollection = runCiLighthouse, prepareTransport = prepareLighthouseHttp2 } = {}) {
  const output = join(cwd, 'artifacts/lighthouse-ci');
  const reference = join(cwd, 'artifacts/lighthouse-http1-reference');
  const identity = () => Object.fromEntries(['release.json', 'record-delivery-chunks.json'].map(name =>
    [name, createHash('sha256').update(readFileSync(join(cwd, 'dist/site', name))).digest('hex')]));
  const before = identity();
  let http1;
  if (compareHttp1) {
    http1 = runCollection({ cwd });
    if (http1.routes.length !== 3 || http1.failures.some(failure => !failure.startsWith('assert:'))) {
      throw new Error('HTTP/1 reference collection is incomplete; retain its failures before retrying.');
    }
    rmSync(reference, { recursive: true, force: true });
    renameSync(output, reference);
  }
  const config = JSON.parse(readFileSync(join(cwd, '.lighthouserc.ci.json'), 'utf8'));
  let tls;
  try {
    tls = prepareTransport(config, cwd);
    const evidence = runCollection({ cwd, configPath: tls.path, requireHttp2: true });
    const after = identity();
    if (JSON.stringify(before) !== JSON.stringify(after)) evidence.failures.push('Built artifact identity changed between transport measurements.');
    if (compareHttp1) {
      writeFileSync(join(output, 'transport-comparison.json'), JSON.stringify({
        before, after, reference: { directory: 'http1-reference', failures: http1.failures, routes: http1.routes },
        production: { failures: evidence.failures, routes: evidence.routes },
        method: 'Same build, fixed HTTP/1 reference then production HTTP/2; two host warmups and one cold measurement per route per transport. Original assertions retained.',
      }, null, 2));
    }
    writeFileSync(join(output, 'route-assertions.json'), JSON.stringify(evidence, null, 2));
    return evidence;
  } finally {
    // Even certificate setup or collection failure must leave the completed
    // reference inside the existing always-uploaded evidence directory.
    try {
      if (compareHttp1 && existsSync(reference)) {
        mkdirSync(output, { recursive: true });
        renameSync(reference, join(output, 'http1-reference'));
      }
    } finally { tls?.cleanup(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = runProductionTransport({ compareHttp1: process.argv.includes('--compare-http1') });
    if (evidence.failures.length) {
      console.error(evidence.failures.join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
