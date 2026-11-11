import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { consumeNodeResults } from './lib/assurance-node-results.mjs';

/** Additional Node reporter; preserves the existing TAP output and exit status.
 * Artifacts bind both the requested PR head and the actual checked-out merge.
 * Provider verification remains separate from these runner-recorded claims.
 */
export default async function* assuranceNodeReporter(events) {
  const identity = {
    repository: process.env.GITHUB_REPOSITORY,
    code_sha: process.env.ATLAS_RUNNER_HEAD_SHA,
    checkout_sha: process.env.GITHUB_SHA,
    run_id: process.env.GITHUB_RUN_ID,
    run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    job_key: process.env.GITHUB_JOB,
    command: process.env.npm_lifecycle_event || 'direct-node-test',
    node_version: process.version,
  };
  const report = await consumeNodeResults(events, { root: process.cwd(), identity });
  const directory = resolve('artifacts/assurance-node');
  mkdirSync(directory, { recursive: true });
  const filename = randomUUID() + '.json';
  writeFileSync(resolve(directory, filename), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  yield 'Native assurance diagnostic saved: ' + filename + '\n';
}
