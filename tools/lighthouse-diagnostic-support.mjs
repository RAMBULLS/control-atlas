import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RECORD_HASH = '#/record/nist-800-53/AC-2';
export const CAPTURE_AUDIT = 'atlas-metric-inputs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function lighthouseRuntime(cwd = process.cwd()) {
  // Resolve from the same module that starts Lighthouse in LHCI, including
  // installations where LHCI has its own nested Lighthouse dependency.
  const lhciRequire = createRequire(resolve(cwd, 'node_modules/@lhci/cli/src/collect/node-runner.js'));
  const root = dirname(dirname(lhciRequire.resolve('lighthouse')));
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  const lhciVersion = JSON.parse(readFileSync(resolve(cwd, 'node_modules/@lhci/cli/package.json'), 'utf8')).version;
  return { root, version, lhciVersion, load: relative => import(pathToFileURL(resolve(root, relative)).href) };
}

export function traceIdentity(processed) {
  const origin = processed.timeOriginEvt;
  return {
    frameId: processed.mainFrameInfo.frameId,
    navigationId: origin.args?.data?.navigationId ?? null,
    timeOriginUs: origin.ts,
    originName: origin.name,
    originPid: origin.pid,
    originTid: origin.tid,
  };
}

export function assertCapturePair(report, capture, reference, identity) {
  if (!report.requestedUrl?.endsWith(RECORD_HASH) ||
      capture.URL?.requestedUrl !== report.requestedUrl ||
      capture.fetchTime !== report.fetchTime || !report.fetchTime ||
      capture.URL?.mainDocumentUrl !== report.finalUrl ||
      capture.URL?.finalDisplayedUrl !== report.finalDisplayedUrl) {
    throw new Error('Original URL/fetchTime does not match the requested record report.');
  }
  if (!identity.frameId || !Number.isFinite(identity.timeOriginUs) ||
      JSON.stringify(identity) !== JSON.stringify(capture.identity) ||
      JSON.stringify(identity) !== JSON.stringify(reference.identity)) {
    throw new Error('Original frame/navigation identity does not match the captured report.');
  }
}

export function reproduction(reportTiming, timing) {
  const deltaMs = Number.isFinite(reportTiming) && Number.isFinite(timing) ? Math.abs(reportTiming - timing) : null;
  return { reportMs: reportTiming ?? null, reproducedMs: timing ?? null, deltaMs,
    toleranceMs: 1, accepted: deltaMs !== null && deltaMs <= 1 };
}
