import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { INGESTION_TASKS } from '../scripts/lib/ingestion-pipeline.mjs';
import {
  loadSourceRefreshContract,
  validateSourceRefreshContract,
} from '../scripts/lib/source-refresh-contract.mjs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const sourceRegistry = JSON.parse(readFileSync('data/source-registry.json', 'utf8'));

test('every scheduled remote fetch has explicit source ownership and cadence', () => {
  const contract = loadSourceRefreshContract();
  assert.deepEqual(validateSourceRefreshContract(contract, INGESTION_TASKS, workflow, sourceRegistry), []);
  assert.ok(contract.tasks.every((task) => task.cadence === 'weekly'));
  assert.equal(contract.schedule.stale_source_detection_independent, true);
});

test('an unmapped scheduled source fetch fails closed', () => {
  const contract = loadSourceRefreshContract();
  const incomplete = {
    ...contract,
    tasks: contract.tasks.filter((task) => task.task_id !== 'fetch-ccis'),
  };
  assert.match(
    validateSourceRefreshContract(incomplete, INGESTION_TASKS, workflow, sourceRegistry).join('\n'),
    /fetch-ccis is missing/,
  );
});

test('catalog scopes resolve to governed production catalogs', () => {
  const contract = loadSourceRefreshContract();
  const invalid = structuredClone(contract);
  invalid.tasks[0].catalog_ids.push('invented-catalog');
  assert.match(
    validateSourceRefreshContract(invalid, INGESTION_TASKS, workflow, sourceRegistry).join('\n'),
    /unknown catalog invented-catalog/,
  );
});

test('scheduled source and health fetches use the governed transport', () => {
  const files = [];
  const collect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.name.endsWith('.mjs')) files.push(path);
    }
  };
  collect('scripts');
  collect(join('tools', 'importers'));
  collect(join('tools', 'relationship-builders'));
  const directFetchFiles = files
    .filter((path) => /\bfetch\s*\(/.test(readFileSync(path, 'utf8')))
    .map((path) => path.replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(directFetchFiles, []);
  const disa = readFileSync('scripts/fetch-disa-stigs.mjs', 'utf8');
  assert.match(disa, /options\.fetchImpl \|\| strictConditionalFetch/);
});

test('the contract states the same retry, heartbeat and escalation numbers the code runs', async () => {
  const { behavior } = loadSourceRefreshContract();
  const { DEFAULT_REQUEST_RETRY } = await import('../scripts/lib/strict-conditional-fetch.mjs');
  const { DEFAULT_UNIT_BACKOFF } = await import('../scripts/refresh-data.mjs');
  const { HEARTBEAT_DAYS } = await import('../tools/classify-refresh-outcome.mjs');
  const { OLIR_TRANSIENT_ESCALATION } = await import('../tools/report-refresh-alerts.mjs');
  const request = behavior.transient_failure.request_retry;
  assert.deepEqual(
    [request.attempts, request.base_ms, request.max_ms, request.retry_after_cap_ms, request.timeout_ms],
    [DEFAULT_REQUEST_RETRY.attempts, DEFAULT_REQUEST_RETRY.baseMs, DEFAULT_REQUEST_RETRY.maxMs, DEFAULT_REQUEST_RETRY.retryAfterCapMs, DEFAULT_REQUEST_RETRY.timeoutMs],
  );
  assert.deepEqual([behavior.transient_failure.source_retry.base_ms, behavior.transient_failure.source_retry.max_ms], [DEFAULT_UNIT_BACKOFF.baseMs, DEFAULT_UNIT_BACKOFF.maxMs]);
  assert.equal(behavior.freshness_heartbeat_days, HEARTBEAT_DAYS);
  const olir = loadSourceRefreshContract().tasks.find((task) => task.task_id === 'fetch-olir-catalog');
  assert.match(olir.partial_rule, new RegExp(`${OLIR_TRANSIENT_ESCALATION} consecutive refreshes`));
});

test('each task declares required and optional artifacts, identity, change policy and downstream work', () => {
  const contract = loadSourceRefreshContract();
  const broken = structuredClone(contract);
  const first = broken.tasks[0];
  delete first.identity_key;
  first.check_tier = 'invented';
  first.partial_policy = 'retain_optional_last_good';
  first.downstream = [];
  const errors = validateSourceRefreshContract(broken, INGESTION_TASKS, workflow, sourceRegistry).join('\n');
  for (const pattern of [/no stable identity key/, /unsupported check tier invented/, /downstream artifacts/, /does not name them and the rule/]) assert.match(errors, pattern);
  const olir = contract.tasks.find((task) => task.task_id === 'fetch-olir-catalog');
  assert.equal(olir.partial_policy, 'retain_optional_last_good');
  assert.ok(olir.optional_artifacts.length > 0);
  assert.ok(contract.tasks.filter((task) => task.partial_policy === 'retain_optional_last_good').length === 1, 'only a source proven to retain last-good contributions may claim it');
  const noBehavior = structuredClone(contract);
  delete noBehavior.behavior.large_change_policy;
  assert.match(validateSourceRefreshContract(noBehavior, INGESTION_TASKS, workflow, sourceRegistry).join('\n'), /behavior is missing large_change_policy/);
});
