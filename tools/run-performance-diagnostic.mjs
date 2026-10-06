import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const optional = path => {
  try { return { value: readFileSync(path, 'utf8').trim(), unavailable: null }; }
  catch (error) { return { value: null, unavailable: error.code || error.message }; }
};

export function validateDiagnosticInput(input, sha) {
  const started = Date.parse(input.build.started_at); const completed = Date.parse(input.build.completed_at);
  const created = Date.parse(input.artifact.created_at);
  if (!/^[a-f0-9]{40}$/.test(sha) || input.run.head_sha !== sha || input.run.status !== 'completed'
    || input.run.path !== '.github/workflows/ci.yml' || input.build.conclusion !== 'success'
    || !Number.isInteger(input.run.id) || input.build.run_id !== input.run.id
    || input.build.run_attempt !== input.run.run_attempt || input.build.name !== 'Build immutable site artifact'
    || input.artifact.workflow_run?.id !== input.run.id || input.artifact.workflow_run?.head_sha !== sha
    || !Number.isInteger(input.artifact.id)
    || !Number.isFinite(started) || !Number.isFinite(completed) || !Number.isFinite(created)
    || created < started || created > completed
    || input.artifact.name !== 'site-build' || input.artifact.expired !== false
    || !Number.isInteger(input.artifact.size_in_bytes) || input.artifact.size_in_bytes <= 0
    || !/^sha256:[a-f0-9]{64}$/.test(input.artifact.digest)) throw new Error('Diagnostic requires an exact-head completed CI run with a successful immutable site artifact.');
}

export function bracketHostSample(collect, clock = { monotonic: () => process.hrtime.bigint().toString(), wall: Date.now }) {
  const monotonicBeginNs = clock.monotonic(); const wallTimeMs = clock.wall();
  const fields = collect();
  return { wallTimeMs, monotonicBeginNs, ...fields, monotonicEndNs: clock.monotonic() };
}

function processSnapshot() {
  return readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(pid => {
    const stat = optional(`/proc/${pid}/stat`).value;
    if (!stat) return [];
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return [{ pid: Number(pid), ppid: Number(fields[1]), startTicks: fields[19] }];
  });
}

export function ownedDescendants(snapshot, root, known = []) {
  const owned = new Map(known.map(item => [item.pid, item]));
  const rootMatches = snapshot.some(item => item.pid === root?.pid && item.startTicks === root.startTicks);
  let parents = new Set([...(rootMatches ? [root.pid] : []), ...known.filter(item => snapshot.some(current => current.pid === item.pid && current.startTicks === item.startTicks)).map(item => item.pid)]);
  for (;;) {
    const next = snapshot.filter(item => parents.has(item.ppid) && !parents.has(item.pid));
    if (!next.length) break;
    for (const item of next) { owned.set(item.pid, item); parents.add(item.pid); }
  }
  return [...owned.values()].filter(item => snapshot.some(current => current.pid === item.pid && current.startTicks === item.startTicks));
}

export function retainPartialCollection(destination, cwd = process.cwd()) {
  const partial = join(destination, 'partial'); mkdirSync(partial, { recursive: true });
  for (const name of ['.lighthouseci', ...readdirSync(cwd).filter(name => /\.(trace|devtoolslog)\.json$/.test(name))]) {
    if (existsSync(join(cwd, name))) renameSync(join(cwd, name), join(partial, name));
  }
  writeFileSync(join(partial, 'incomplete.json'), `${JSON.stringify({ complete: false, reason: 'Interrupted collection; partial assets are not admitted as measurements.' }, null, 2)}\n`);
}

export async function runCollection(destination, signal, { args = ['tools/run-ci-lighthouse.mjs'], timeoutMs = 240000 } = {}) {
  if (signal.aborted) throw new Error('Workflow cancellation');
  const log = openSync(join(destination, 'runner.log'), 'w');
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log] }); closeSync(log);
  const rootIdentity = processSnapshot().find(item => item.pid === child.pid);
  let known = []; let interrupted = null; let cleanup = null;
  const remember = () => {
    const snapshot = processSnapshot();
    known = ownedDescendants(snapshot, rootIdentity, known);
  };
  const send = (item, name) => {
    if (!processSnapshot().some(current => current.pid === item.pid && current.startTicks === item.startTicks)) return;
    try { process.kill(item.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stop = reason => {
    if (cleanup) return cleanup;
    interrupted = reason; remember();
    cleanup = (async () => {
      const root = processSnapshot().find(item => item.pid === rootIdentity?.pid && item.startTicks === rootIdentity.startTicks);
      const owned = [...known].reverse(); if (root) owned.push(root);
      for (const item of owned) send(item, 'SIGTERM');
      await new Promise(resolvePause => setTimeout(resolvePause, 2000));
      remember();
      for (const item of [...known].reverse()) send(item, 'SIGKILL');
      if (rootIdentity) send(rootIdentity, 'SIGKILL');
    })();
    return cleanup;
  };
  const cancelled = () => { void stop('Workflow cancellation'); };
  signal.addEventListener('abort', cancelled, { once: true });
  const interval = setInterval(remember, 1000);
  const timeout = setTimeout(() => { void stop('Collection timeout'); }, timeoutMs);
  try {
    const result = await new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit); child.once('exit', (status, killedBy) => resolveExit({ status, signal: killedBy }));
    });
    if (cleanup) await cleanup;
    if (interrupted) throw new Error(interrupted);
    return result;
  } finally { clearInterval(interval); clearTimeout(timeout); signal.removeEventListener('abort', cancelled); }
}

function selectInput() {
  const id = process.env.DIAGNOSTIC_RUN_ID || '';
  if (!/^\d+$/.test(id)) throw new Error('A completed CI run ID is required.');
  const api = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  const base = `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${id}`;
  const run = api(base);
  const jobs = api(`${base}/attempts/${run.run_attempt}/jobs?per_page=100`);
  const artifacts = api(`${base}/artifacts?per_page=100`);
  if (jobs.total_count > jobs.jobs.length || artifacts.total_count > artifacts.artifacts.length) throw new Error('Truncated CI inventory.');
  const builds = jobs.jobs.filter(job => job.name === 'Build immutable site artifact');
  const sites = artifacts.artifacts.filter(artifact => artifact.name === 'site-build');
  if (builds.length !== 1 || sites.length !== 1) throw new Error('Exactly one build and immutable artifact are required.');
  const input = { run, build: builds[0], artifact: sites[0] };
  validateDiagnosticInput(input, process.env.GITHUB_SHA || '');
  const active = api(`repos/${process.env.GITHUB_REPOSITORY}/actions/runs?status=in_progress&per_page=100`);
  if (active.total_count > active.workflow_runs.length || active.workflow_runs.some(item => String(item.id) !== process.env.GITHUB_RUN_ID)) throw new Error('Another workflow is running; diagnostic collections must not overlap.');
  mkdirSync('.ci', { recursive: true });
  writeFileSync('.ci/diagnostic-input.json', `${JSON.stringify(input, null, 2)}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `artifact_id=${input.artifact.id}\n`);
}

export function siteIdentity(directory) {
  const digest = createHash('sha256'); let files = 0; let bytes = 0;
  const visit = (path, prefix = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(join(path, entry.name), `${relative}/`);
      else if (entry.isFile()) {
        const content = readFileSync(join(path, entry.name));
        digest.update(JSON.stringify([relative, content.length, hash(content)])); files++; bytes += content.length;
      } else throw new Error('Site artifact must contain regular files only.');
    }
  };
  visit(directory); return { files, bytes, sha256: digest.digest('hex') };
}

export function clockAnchors(trace, log) {
  const sends = new Map((trace.traceEvents || []).filter(event => event.name === 'ResourceSendRequest')
    .map(event => [event.args?.data?.requestId, event.ts]));
  const pairs = log.filter(entry => entry.method === 'Network.requestWillBeSent'
    && Number.isFinite(entry.params?.timestamp) && Number.isFinite(entry.params?.wallTime)
    && sends.has(entry.params.requestId)).map(entry => ({
    requestId: entry.params.requestId, traceUs: sends.get(entry.params.requestId),
    devtoolsMonotonicUs: entry.params.timestamp * 1e6, wallTimeMs: entry.params.wallTime * 1000,
    traceToDevtoolsUs: sends.get(entry.params.requestId) - entry.params.timestamp * 1e6,
  }));
  return pairs.length ? { status: 'paired-event-observations', first: pairs[0], last: pairs.at(-1),
    minimumOffsetUs: Math.min(...pairs.map(pair => pair.traceToDevtoolsUs)),
    maximumOffsetUs: Math.max(...pairs.map(pair => pair.traceToDevtoolsUs)),
    pairs, limitation: 'Host UTC/monotonic brackets and paired browser events bound alignment; 1Hz host samples are interval context, not precise task attribution.' }
    : { status: 'unknown', reason: 'No matching trace/request wall-clock anchors; host/task correlation is unavailable.', pairs: [] };
}

function sample(path) {
  const tick = () => {
    const snapshot = bracketHostSample(() => {
    const processes = [];
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      const comm = optional(`/proc/${pid}/comm`).value;
      if (!/chrome|chromium/.test(comm || '') && Number(pid) !== process.pid) continue;
      const threads = [];
      try {
        for (const tid of readdirSync(`/proc/${pid}/task`)) {
          const stat = optional(`/proc/${pid}/task/${tid}/stat`).value;
          if (!stat) continue;
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          threads.push({ tid: Number(tid), userTicks: Number(fields[11]), systemTicks: Number(fields[12]), startTicks: Number(fields[19]) });
        }
      } catch { /* A browser process can exit between snapshots. */ }
      processes.push({ pid: Number(pid), comm, threads });
    }
    return {
      cpu: optional('/proc/stat'), load: optional('/proc/loadavg'), cpuPressure: optional('/proc/pressure/cpu'),
      memoryPressure: optional('/proc/pressure/memory'), memory: optional('/proc/meminfo'),
      cgroupCpu: optional('/sys/fs/cgroup/cpu.stat'), processes };
    });
    appendFileSync(path, `${JSON.stringify(snapshot)}\n`);
  };
  tick(); const timer = setInterval(tick, 1000);
  process.on('SIGTERM', () => { clearInterval(timer); tick(); process.exit(0); });
}

export function summarizeCollection(directory, expectedUrls) {
  const evidence = read(join(directory, 'route-assertions.json'));
  if (evidence.numberOfRuns !== 1 || evidence.routes.length !== expectedUrls.length
    || evidence.routes.some(route => !expectedUrls.includes(route.requestedUrl))
    || new Set(evidence.routes.map(route => route.requestedUrl)).size !== expectedUrls.length
    || evidence.failures.some(failure => !/^assert: Lighthouse assert failed with exit 1$/.test(failure))) throw new Error('Incomplete or invalid diagnostic collection; no retry is allowed.');
  const reports = readdirSync(directory).filter(name => name.endsWith('.report.json')).map(name => read(join(directory, name)));
  if (reports.length !== expectedUrls.length || evidence.diagnostics.length !== reports.length) throw new Error('Diagnostic reports or raw assets are missing.');
  if (new Set(reports.map(report => report.requestedUrl)).size !== expectedUrls.length
    || reports.some(report => !expectedUrls.includes(report.requestedUrl))) throw new Error('Duplicate or unexpected report route.');
  return reports.map(report => {
    const diagnostic = evidence.diagnostics.find(item => item.requestedUrl === report.requestedUrl && item.fetchTime === report.fetchTime);
    if (!diagnostic || report.runtimeError || evidence.routes.find(item => item.requestedUrl === report.requestedUrl).assertions.length !== 9) throw new Error('Report identity, assertions or runtime failure.');
    for (const asset of diagnostic.files) {
      const bytes = readFileSync(join(directory, asset.path));
      if (bytes.length !== asset.byteLength || hash(bytes) !== asset.sha256) throw new Error('Diagnostic asset integrity failure.');
    }
    const file = suffix => read(join(directory, diagnostic.files.find(item => item.path.endsWith(suffix)).path));
    return { requestedUrl: report.requestedUrl, fetchTime: report.fetchTime,
      lighthouseVersion: report.lighthouseVersion, hostUserAgent: report.environment.hostUserAgent,
      settingsHash: hash(JSON.stringify(report.configSettings)), benchmarkIndex: report.environment.benchmarkIndex,
      lcp: report.audits['largest-contentful-paint'].numericValue, tbt: report.audits['total-blocking-time'].numericValue,
      cls: report.audits['cumulative-layout-shift'].numericValue,
      observedLcp: report.audits.metrics.details.items[0].observedLargestContentfulPaint,
      assertions: evidence.routes.find(item => item.requestedUrl === report.requestedUrl).assertions,
      clock: clockAnchors(file('-0.trace.json'), file('-0.devtoolslog.json')) };
  });
}

async function main() {
  if (process.platform !== 'linux') throw new Error('This diagnostic is CI Linux only; no laptop measurement or synthetic load.');
  const sha = process.env.GITHUB_SHA || '';
  const input = read('.ci/diagnostic-input.json'); validateDiagnosticInput(input, sha);
  if (read('dist/site/release.json').commit_sha !== sha) throw new Error('Immutable site release mismatch.');
  const output = resolve('artifacts/performance-diagnostic');
  if (existsSync(output)) throw new Error('Diagnostic output already exists; no selective retry or overwrite.');
  mkdirSync(output, { recursive: true });
  const configBytes = readFileSync('.lighthouserc.ci.json'); const config = JSON.parse(configBytes);
  if (config.ci.collect.numberOfRuns !== 1 || config.ci.collect.url.length !== 3) throw new Error('Expected unchanged three-route single-collection configuration.');
  const identity = { sha, input, configHash: hash(configBytes), lockHash: hash(readFileSync('package-lock.json')),
    site: siteIdentity('dist/site'), node: process.version, lighthouse: read('node_modules/lighthouse/package.json').version,
    logicalCpus: optional('/proc/cpuinfo'), kernel: optional('/proc/version'),
    clockTicksPerSecond: Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()),
    policy: 'Exactly three sequential collections, unchanged settings, no synthetic load, no retries or acceptance aggregation.' };
  writeFileSync(join(output, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  const sampler = spawn(process.execPath, [process.argv[1], '--telemetry', join(output, 'host-telemetry.jsonl')], { stdio: 'inherit' });
  let samplerFailure = null;
  const samplerExited = new Promise(resolveExit => {
    sampler.once('exit', (code, signal) => resolveExit({ code, signal }));
    sampler.once('error', error => { samplerFailure = error.message; resolveExit({ code: null, error: error.message }); });
  });
  const summary = { identity, collections: [], completed: false, diagnosticOnly: true, failure: null };
  let activeDestination = null;
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.on('SIGTERM', cancel); process.on('SIGINT', cancel);
  try {
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      if (cancellation.signal.aborted) throw new Error('Workflow cancellation');
      if (samplerFailure || sampler.exitCode !== null || sampler.signalCode) throw new Error('Host telemetry exited before collections finished.');
      const destination = join(output, `collection-${ordinal}`); mkdirSync(destination);
      activeDestination = destination;
      const start = { wallTimeMs: Date.now(), monotonicNs: process.hrtime.bigint().toString() };
      let result;
      try { result = await runCollection(destination, cancellation.signal); }
      catch (error) {
        if (existsSync('artifacts/lighthouse-ci')) renameSync('artifacts/lighthouse-ci', join(destination, 'lighthouse'));
        retainPartialCollection(destination);
        summary.collections.push({ ordinal, start, complete: false, failure: error.message });
        throw error;
      }
      if (existsSync('artifacts/lighthouse-ci')) renameSync('artifacts/lighthouse-ci', join(destination, 'lighthouse'));
      if (result.signal || ![0, 1].includes(result.status)) throw new Error(`Collection execution failed: ${result.signal || result.status}`);
      const routes = summarizeCollection(join(destination, 'lighthouse'), config.ci.collect.url);
      summary.collections.push({ ordinal, start, end: { wallTimeMs: Date.now(), monotonicNs: process.hrtime.bigint().toString() }, exitStatus: result.status, routes });
      if (hash(readFileSync('.lighthouserc.ci.json')) !== identity.configHash || hash(readFileSync('package-lock.json')) !== identity.lockHash
        || JSON.stringify(siteIdentity('dist/site')) !== JSON.stringify(identity.site)) throw new Error('Diagnostic inputs changed during measurement.');
      const first = summary.collections[0].routes[0];
      if (routes.some(route => route.settingsHash !== first.settingsHash || route.hostUserAgent !== first.hostUserAgent || route.lighthouseVersion !== first.lighthouseVersion)) throw new Error('Browser/settings identity changed; results cannot be pooled.');
      writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      console.log(`Diagnostic collection ${ordinal}/3 retained: ${routes.map(route => `${route.requestedUrl} LCP=${route.lcp} TBT=${route.tbt}`).join('; ')}`);
      activeDestination = null;
    }
    summary.completed = true;
  } catch (error) {
    if (activeDestination && !existsSync(join(activeDestination, 'partial'))) retainPartialCollection(activeDestination);
    summary.failure = error.message; process.exitCode = 1;
  }
  finally {
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    sampler.kill('SIGTERM');
    const stopped = await Promise.race([samplerExited, new Promise(resolveStop => setTimeout(() => resolveStop(null), 5000))]);
    if (!stopped) { sampler.kill('SIGKILL'); await samplerExited; summary.failure ||= 'Telemetry cleanup timeout'; process.exitCode = 1; }
    else if (stopped.code !== 0) { summary.failure ||= 'Telemetry collection failed'; process.exitCode = 1; }
    if (summary.failure) summary.completed = false;
    writeFileSync(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  }
}

if (process.argv[2] === '--telemetry') sample(process.argv[3]);
else if (process.argv[2] === '--select-input') selectInput();
else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
