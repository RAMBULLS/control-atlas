import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAPTURE_AUDIT, RECORD_HASH, lighthouseRuntime, sha256, traceIdentity } from './lighthouse-diagnostic-support.mjs';

const runtime = lighthouseRuntime();
const { Audit } = await runtime.load('core/audits/audit.js');

export default class MetricInputs extends Audit {
  static get meta() {
    return {
      id: CAPTURE_AUDIT,
      title: 'Original metric inputs',
      description: 'Retains original inputs for offline diagnostic reproduction; contributes no score.',
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      supportedModes: ['navigation'],
      requiredArtifacts: ['HostUserAgent', 'Trace', 'DevtoolsLog', 'GatherContext', 'URL', 'SourceMaps', 'HostDPR'],
    };
  }

  static async audit(artifacts, context) {
    if (!artifacts.URL?.requestedUrl?.endsWith(RECORD_HASH)) return { score: null, notApplicable: true };
    try {
      if (process.env.INTERNAL_LANTERN_USE_TRACE !== undefined) throw new Error('Alternative trace graph is unsupported.');
      if (runtime.version !== '13.4.1') throw new Error(`Expected Lighthouse 13.4.1, found ${runtime.version}.`);
      const { ProcessedTrace } = await runtime.load('core/computed/processed-trace.js');
      const { stringifyReplacer } = await runtime.load('core/lib/asset-saver.js');
      const identity = traceIdentity(await ProcessedTrace.request(artifacts.Trace, context));
      const traceBytes = JSON.stringify(artifacts.Trace, stringifyReplacer);
      const logBytes = JSON.stringify(artifacts.DevtoolsLog, stringifyReplacer);
      const capture = {
        fetchTime: artifacts.fetchTime, identity,
        URL: artifacts.URL, gatherContext: artifacts.GatherContext, settings: context.settings,
        SourceMaps: artifacts.SourceMaps, HostDPR: artifacts.HostDPR, simulator: null,
        TraceElements: artifacts.TraceElements,
        versions: { lighthouse: runtime.version, lhci: runtime.lhciVersion },
      };
      const inputsBytes = JSON.stringify(capture, stringifyReplacer);
      const id = sha256(inputsBytes);
      const directory = resolve('.lighthouseci/metric-inputs', id);
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, 'trace.json'), traceBytes);
      writeFileSync(resolve(directory, 'devtoolslog.json'), logBytes);
      writeFileSync(resolve(directory, 'inputs.json'), inputsBytes);
      return { score: null, details: {
        type: 'debugdata', status: 'captured', id, identity,
        traceSha256: sha256(traceBytes), devtoolsLogSha256: sha256(logBytes), inputsSha256: id,
      } };
    } catch (error) {
      // A diagnostic failure must not replace the normal metric audit or its
      // mandatory assertions. The post-collection export records this gap.
      return { score: null, details: { type: 'debugdata', status: 'unavailable', reason: error.message } };
    }
  }
}
