import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAPTURE_AUDIT, RECORD_HASH, assertCapturePair, lighthouseRuntime, reproduction, sha256, traceIdentity } from './lighthouse-diagnostic-support.mjs';

const finite = value => Number.isFinite(value) ? value : null;
const difference = (end, start) => Number.isFinite(end) && Number.isFinite(start) ? end - start : null;
const eventSummary = event => ({ name: event.name, tsUs: event.ts, durationUs: event.dur ?? null,
  pid: event.pid, tid: event.tid, args: event.args ?? null });

export function flattenEstimate(graph, estimate, completeTimings, timeOriginUs) {
  const nodes = [];
  graph.traverse(node => {
    const timing = estimate.nodeTimings.get(node);
    const complete = completeTimings?.get(node);
    const dependencies = node.getDependencies();
    const dependencyEndMs = Math.max(0, ...dependencies.map(dependency => estimate.nodeTimings.get(dependency)?.endTime ?? 0));
    const row = {
      id: node.id, type: node.type, dependencies: dependencies.map(dependency => dependency.id).sort(),
      observed: { startMs: (node.startTime - timeOriginUs) / 1000,
        endMs: (node.endTime - timeOriginUs) / 1000, durationMs: (node.endTime - node.startTime) / 1000 },
      modeled: { startMs: finite(timing?.startTime), endMs: finite(timing?.endTime), durationMs: finite(timing?.duration),
        queuedMs: finite(complete?.queuedTime), queueWaitMs: difference(timing?.startTime, complete?.queuedTime),
        afterDependenciesMs: difference(timing?.startTime, dependencyEndMs) },
      excludedFromLcpMaximum: false,
    };
    if (node.type === 'cpu') {
      row.cpu = { event: eventSummary(node.event), didPerformLayout: node.didPerformLayout(),
        evaluateScriptUrls: [...node.getEvaluateScriptURLs()].sort(),
        childEvents: node.childEvents.filter(event => /^(EvaluateScript|FunctionCall|TimerInstall|TimerFire|Layout|Paint|UpdateLayoutTree)$/.test(event.name)).map(eventSummary) };
    } else {
      const request = node.request;
      const connection = complete?.connectionTiming;
      row.excludedFromLcpMaximum = request.resourceType === 'Image' && ['Low', 'VeryLow'].includes(request.priority);
      row.network = {
        requestId: request.requestId, url: request.url, resourceType: request.resourceType, priority: request.priority,
        transferSize: finite(request.transferSize), resourceSize: finite(request.resourceSize),
        observedRequestTimestampMs: finite(request.networkRequestTime), observedHeadersTimestampMs: finite(request.responseHeadersEndTime),
        observedEndTimestampMs: finite(request.networkEndTime),
        observedWaitMs: difference(request.responseHeadersEndTime, request.networkRequestTime),
        observedTransferMs: difference(request.networkEndTime, request.responseHeadersEndTime),
        modeledConnection: connection ?? null,
        modeledConnectionGap: connection ? null : 'No connection breakdown was exposed for this node (including connectionless requests).',
        modeledTransferMs: difference(timing?.duration, connection?.timeToFirstByte),
      };
    }
    nodes.push(row);
  });
  nodes.sort((left, right) => left.id.localeCompare(right.id));
  const contributing = nodes.filter(node => !node.excludedFromLcpMaximum && node.modeled.endMs === estimate.timeInMs);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const predecessorChains = contributing.map(terminal => {
    const ids = [];
    const seen = new Set();
    let current = terminal;
    while (current) {
      if (seen.has(current.id)) throw new Error('Cycle in Lantern dependency chain.');
      seen.add(current.id);
      ids.push(current.id);
      current = current.dependencies.map(id => byId.get(id)).filter(Boolean)
        .sort((a, b) => (b.modeled.endMs ?? 0) - (a.modeled.endMs ?? 0) || a.id.localeCompare(b.id))[0];
    }
    return { terminalId: terminal.id, ids: ids.reverse() };
  });
  return { timeInMs: estimate.timeInMs, nodes, predecessorChains,
    chainMeaning: 'Follows the latest-finishing graph dependency. Queue/resource waits remain separately reported; component causality is not implied.' };
}

export function timerEdges(events, estimates) {
  const installs = new Map();
  const edges = [];
  const graphNodesFor = event => Object.fromEntries(Object.entries(estimates).map(([name, estimate]) => [name,
    estimate.nodes.filter(node => node.cpu?.childEvents.some(child => child.name === event.name && child.tsUs === event.ts &&
      child.pid === event.pid && child.tid === event.tid && child.args?.data?.timerId === event.args?.data?.timerId))
      .map(node => node.id).sort(),
  ]));
  for (const event of [...events].sort((a, b) => a.ts - b.ts)) {
    const timerId = event.args?.data?.timerId;
    if (timerId === undefined) continue;
    const key = `${event.pid}:${event.tid}:${timerId}`;
    if (event.name === 'TimerInstall') installs.set(key, event);
    if (event.name !== 'TimerFire') continue;
    const install = installs.get(key);
    edges.push({ timerId, fire: eventSummary(event), install: install ? eventSummary(install) : null,
      observedElapsedMs: install ? (event.ts - install.ts) / 1000 : null,
      declaredTimeoutMs: finite(install?.args?.data?.timeout),
      installGraphNodes: install ? graphNodesFor(install) : null, fireGraphNodes: graphNodesFor(event),
      relation: 'Observed timer events mapped by identity into graph child events; inclusion does not prove this timer is on an LCP predecessor chain.' });
  }
  return edges;
}

export async function exportLanternCriticalPath({ cwd = process.cwd() } = {}) {
  const reportDirectory = join(cwd, '.lighthouseci');
  const output = join(cwd, 'artifacts/lighthouse-ci/lantern');
  const reports = readdirSync(reportDirectory).filter(name => /^lhr-\d+\.json$/.test(name)).map(name => {
    const bytes = readFileSync(join(reportDirectory, name));
    return { name, bytes, report: JSON.parse(bytes) };
  }).filter(({ report }) => report.requestedUrl?.endsWith(RECORD_HASH));
  // Failed collection still exports the ordinary route/assertion evidence.
  if (!reports.length) return;
  mkdirSync(output, { recursive: true });
  const result = { status: 'unavailable', gaps: [], graphSource: 'devtools-log', versions: null };
  try {
    if (reports.length !== 1) throw new Error('Ambiguous requested record reports.');
    const { report, bytes, name } = reports[0];
    writeFileSync(join(output, 'report.json'), bytes);
    result.report = { requestedUrl: report.requestedUrl, fetchTime: report.fetchTime, filename: name, exportedFile: 'report.json', sha256: sha256(bytes) };
    if (process.env.INTERNAL_LANTERN_USE_TRACE !== undefined) throw new Error('INTERNAL_LANTERN_USE_TRACE must be absent.');
    const reference = report.audits?.[CAPTURE_AUDIT]?.details;
    if (reference?.status !== 'captured' || !/^[a-f0-9]{64}$/.test(reference.id ?? '')) {
      throw new Error(reference?.reason ?? 'Original URL/GatherContext/settings/simulator/SourceMaps/HostDPR capture is missing.');
    }
    const runtime = lighthouseRuntime(cwd);
    result.versions = { installedLighthouse: runtime.version, lhci: runtime.lhciVersion, reportLighthouse: report.lighthouseVersion };
    if (runtime.version !== '13.4.1' || report.lighthouseVersion !== runtime.version) throw new Error('Same-version Lighthouse 13.4.1 is required.');
    const directory = join(reportDirectory, 'metric-inputs', reference.id);
    const saved = {};
    for (const [key, filename, expected] of [
      ['inputs', 'inputs.json', reference.inputsSha256],
      ['trace', 'trace.json', reference.traceSha256],
      ['devtoolsLog', 'devtoolslog.json', reference.devtoolsLogSha256],
    ]) {
      const assetBytes = readFileSync(join(directory, filename));
      if (sha256(assetBytes) !== expected) throw new Error(`Original ${key} hash does not match the report capture.`);
      saved[key] = JSON.parse(assetBytes);
      writeFileSync(join(output, filename), assetBytes);
    }
    result.assets = { inputsSha256: reference.inputsSha256, traceSha256: reference.traceSha256, devtoolsLogSha256: reference.devtoolsLogSha256,
      source: 'Original gather artifacts captured during this report navigation, before saveAssets adds synthetic metric events.' };
    const capture = saved.inputs;
    for (const field of ['URL', 'gatherContext', 'settings', 'simulator', 'SourceMaps', 'HostDPR']) {
      if (!Object.hasOwn(capture, field)) throw new Error(`Missing original metric input: ${field}.`);
    }
    if (capture.simulator !== null || capture.gatherContext?.gatherMode !== 'navigation' || capture.settings?.throttlingMethod !== 'simulate') {
      throw new Error('Original metric inputs are not the default navigation simulation.');
    }
    if (capture.versions?.lighthouse !== runtime.version || capture.versions?.lhci !== runtime.lhciVersion) throw new Error('Capture runtime differs from offline runtime.');
    const [{ ProcessedTrace }, { ProcessedNavigation }, { LanternLargestContentfulPaint }, { LanternFirstContentfulPaint }, Lantern] = await Promise.all([
      runtime.load('core/computed/processed-trace.js'), runtime.load('core/computed/processed-navigation.js'),
      runtime.load('core/computed/metrics/lantern-largest-contentful-paint.js'),
      runtime.load('core/computed/metrics/lantern-first-contentful-paint.js'), runtime.load('core/lib/lantern/lantern.js'),
    ]);
    const context = { computedCache: new Map() };
    const processed = await ProcessedTrace.request(saved.trace, context);
    const identity = traceIdentity(processed);
    assertCapturePair(report, capture, reference, identity);
    result.identity = identity;
    const input = { trace: saved.trace, devtoolsLog: saved.devtoolsLog, gatherContext: capture.gatherContext,
      settings: capture.settings, URL: capture.URL, SourceMaps: capture.SourceMaps, HostDPR: capture.HostDPR, simulator: capture.simulator };
    const metric = await LanternLargestContentfulPaint.request(input, context);
    const fcp = await LanternFirstContentfulPaint.request(input, context);
    const navigation = await ProcessedNavigation.request(saved.trace, context);
    result.reproduction = reproduction(report.audits?.['largest-contentful-paint']?.numericValue, metric.timing);
    result.accounting = { firstContentfulPaintMs: fcp.timing, optimisticWeight: 0.5, pessimisticWeight: 0.5,
      weightedLcpMs: 0.5 * metric.optimisticEstimate.timeInMs + 0.5 * metric.pessimisticEstimate.timeInMs,
      finalRule: 'max(firstContentfulPaintMs, weightedLcpMs)' };
    result.optimistic = flattenEstimate(metric.optimisticGraph, metric.optimisticEstimate,
      Lantern.Simulation.Simulator.allNodeTimings.get('optimisticLargestContentfulPaint'), identity.timeOriginUs);
    result.pessimistic = flattenEstimate(metric.pessimisticGraph, metric.pessimisticEstimate,
      Lantern.Simulation.Simulator.allNodeTimings.get('pessimisticLargestContentfulPaint'), identity.timeOriginUs);
    const lcpTimestamp = navigation.timestamps.largestContentfulPaint;
    const traceEvents = processed.mainThreadEvents.filter(event => event.ts >= identity.timeOriginUs && event.ts <= lcpTimestamp);
    result.observed = { largestContentfulPaintMs: navigation.timings.largestContentfulPaint,
      largestContentfulPaintEvent: navigation.largestContentfulPaintEvt ? eventSummary(navigation.largestContentfulPaintEvt) : null,
      traceElements: capture.TraceElements ?? null,
      timersBeforeLcp: traceEvents.filter(event => /^(TimerInstall|TimerFire)$/.test(event.name)).map(eventSummary),
      timerEdges: timerEdges(traceEvents, { optimistic: result.optimistic, pessimistic: result.pessimistic }),
      userTimingBeforeLcp: traceEvents.filter(event => event.cat?.includes('blink.user_timing')).map(eventSummary) };
    if (!capture.TraceElements) result.gaps.push('Original TraceElements were unavailable; the captured LCP event is not a verified official-paragraph element mapping.');
    result.gaps.push('No explicit official-record commit marker or component-to-Lantern-node mapping was captured; modeled nodes alone cannot prove paragraph or removed retry-gap causality.');
    if (!result.reproduction.accepted) result.gaps.push('Reproduced LCP differs from the original audit by more than 1 ms; no explanatory causal claim is accepted.');
    result.status = result.reproduction.accepted ? 'reproduced' : 'discrepancy';
  } catch (error) {
    result.gaps.push(error.message);
  }
  writeFileSync(join(output, 'ac2-critical-path.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await exportLanternCriticalPath();
    if (result) console.log(`Lantern diagnostic: ${result.status}; ${result.gaps.join(' ')}`);
  } catch (error) {
    console.error(`Lantern diagnostic unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}
