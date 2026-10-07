import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNodeSync } from './lib/process-runner.mjs';

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

export function runCiLighthouse({ cwd = process.cwd(), runCommand } = {}) {
  const configPath = resolve(cwd, '.lighthouserc.ci.json');
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
  // A failed collection must never upload evidence from an earlier invocation.
  for (const filename of readdirSync(reportDirectory)) {
    if (/^lhr-\d+\.(json|html)$/.test(filename) || filename === 'assertion-results.json') {
      rmSync(join(reportDirectory, filename));
    }
  }
  if (attempt('healthcheck', ['--fatal'])) attempt('collect');

  try {
    const reports = readdirSync(reportDirectory).filter(filename => REPORT_FILE.test(filename))
      .sort().map(filename => ({ filename, report: JSON.parse(readFileSync(join(reportDirectory, filename), 'utf8')) }));
    inventoryCiReports(config, reports);
    for (const { filename, report } of reports) {
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
      routes.push({ requestedUrl: report.requestedUrl, ...(typeof report.fetchTime === 'string' ? { fetchTime: report.fetchTime } : {}), filename, passed: passed && assertions.length > 0, assertions });
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
    expectedRoutes: config.ci.collect.url,
    numberOfRuns: config.ci.collect.numberOfRuns,
    routes,
    rawAssets,
    failures,
  };
  writeFileSync(join(outputDirectory, 'route-assertions.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = runCiLighthouse();
    if (evidence.failures.length) {
      console.error(evidence.failures.join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
