// Deterministic source-health harness. Every failure class the refresh must
// survive is exercised against the real gate, transaction, transport and alert
// planner, with fixtures instead of live publishers. Live publisher health is a
// separate concern and is deliberately not tested here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { CATALOG_REFRESH_PROFILES, RELATIONSHIP_SET_ENDPOINTS, catalogPath } from '../scripts/lib/catalog-refresh-profiles.mjs';
import { observeRelationshipSet } from '../scripts/lib/source-change-evidence.mjs';
import { buildPulse } from '../scripts/lib/pulse.mjs';
import { CHANGE_LOG_PATH, createCandidateGate } from '../scripts/lib/refresh-candidate-gate.mjs';
import { createStrictConditionalFetch } from '../scripts/lib/strict-conditional-fetch.mjs';
import { observeCatalog } from '../scripts/lib/source-baseline.mjs';
import { runSourceTransaction } from '../scripts/lib/source-transaction.mjs';
import { runRefreshPipeline } from '../scripts/refresh-data.mjs';
import { classifyOlirRetention, retainOlirSubmissions } from '../scripts/fetch-olir-catalog.mjs';
import { applyOlirRetentionHealth, planAlertChanges } from '../tools/report-refresh-alerts.mjs';

const sha = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const record = (index, status = 'active') => ({ id: `R-${index}`, title: `Record ${index}`, status });
const records = (count, status) => Array.from({ length: count }, (_, index) => record(index, status));
const bytesOf = (list, extra = {}) => Buffer.from(JSON.stringify({ records: list, ...extra }));
const publisherInventory = (list, version) => {
  const ids = JSON.stringify(list.map((entry) => entry.id).sort());
  return {
    imported_count: list.length, eligible_count: list.length, raw_count: list.length, excluded: [],
    raw_identity_sha256: sha(ids), imported_identity_sha256: sha(ids),
    publisher_version: version, source_sha256: sha(`publisher ${version}`), source_byte_length: 1000 + list.length,
  };
};
const DISA_MANIFEST = {
  publications: { expected_canonical_publications: 292, represented_in_compilation: 175, standalone_ingested: 117, failed_publications: 0, missing_publications: 0 },
  reconciliation: { failed_files: 0 },
};
const NIST = 'nist-800-53';
const DISA = 'disa-stig';

function world(t) {
  mkdirSync('.local', { recursive: true });
  const root = mkdtempSync(resolve('.local', 'health-harness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const committed = new Map();
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const get = (path) => readFileSync(join(root, path));
  const base = bytesOf(records(100));
  const observation = observeCatalog(base);
  const baseline = { schema_version: '1.0', seed_commit: 'a'.repeat(40), catalogs: {} };
  const policy = { schema_version: '1.0', description: 'Harness policy', catalogs: {} };
  for (const id of Object.keys(CATALOG_REFRESH_PROFILES)) {
    committed.set(catalogPath(id), base);
    put(catalogPath(id), base);
    baseline.catalogs[id] = { anchor: observation, accepted: observation, accepted_at: '2026-09-09T00:00:00.000Z', history: [] };
    policy.catalogs[id] = { absolute_floor: 10, max_delta_pct: 20, max_anchor_delta_pct: 20, require_independent_inventory: false };
  }
  for (const [path, value] of [
    ['data/source-baselines.json', JSON.stringify(baseline)], ['data/source-refresh-policy.json', JSON.stringify(policy)],
    ['data/source-registry.json', '{}'],
  ]) { committed.set(path, Buffer.from(value)); put(path, value); }
  put('data/disa-artifact-manifest.json', JSON.stringify(DISA_MANIFEST));
  const native = new Map();
  const gate = () => createCandidateGate(root, {
    readCommitted: (path) => committed.get(path), readNativeInventory: (_root, id) => native.get(id) ?? null,
    commitTimestamp: () => '2026-09-16T00:00:00.000Z',
  });
  const unit = (id) => ({ sourceId: `fetch-${id}`, taskId: `fetch-${id}`, paths: [catalogPath(id)], retries: 1 });
  const changeLog = () => (existsSync(join(root, CHANGE_LOG_PATH)) ? JSON.parse(get(CHANGE_LOG_PATH)) : null);
  return { root, put, get, committed, native, gate, unit, changeLog, baseline: () => JSON.parse(get('data/source-baselines.json')) };
}

/** Run one candidate the way refresh does: transaction, gate validation, acceptance. */
async function refreshOne(w, gate, id, candidateBytes, extra = {}) {
  const unit = w.unit(id);
  const result = await runSourceTransaction({
    root: w.root, sourceId: unit.sourceId, paths: unit.paths, attempts: 1,
    operation: () => w.put(catalogPath(id), candidateBytes),
    validate: () => gate.validateCandidate(unit), ...extra,
  });
  gate.recordResult({ ...unit, ...result });
  return result;
}

// ---- A. no change ------------------------------------------------------
test('A: an exact no-change refresh accepts nothing, advances nothing and writes no change evidence', async (t) => {
  const w = world(t);
  const gate = w.gate();
  const result = await refreshOne(w, gate, NIST, w.committed.get(catalogPath(NIST)));
  assert.equal(result.status, 'accepted');
  assert.deepEqual(gate.finalize([{ ...w.unit(NIST), status: 'accepted' }]), JSON.parse(w.committed.get('data/source-baselines.json')));
  assert.equal(w.changeLog(), null);
  assert.equal(gate.verifyPublished(), true);
});

// ---- B, I. small valid update and supersession ---------------------------
test('B: a small valid update is accepted automatically and leaves added, changed and removed counts', async (t) => {
  const w = world(t);
  const gate = w.gate();
  const next = [...records(100).map((entry, index) => (index < 2 ? { ...entry, title: 'Revised' } : entry)), record(100), record(101), record(102)];
  assert.equal((await refreshOne(w, gate, NIST, bytesOf(next))).status, 'accepted');
  gate.finalize([{ ...w.unit(NIST), status: 'accepted' }]);
  const [entry] = w.changeLog().catalogs[NIST];
  assert.deepEqual([entry.added_count, entry.removed_count, entry.changed_count], [3, 0, 2]);
  assert.equal(entry.decision, 'within_band');
  assert.equal(entry.previous.record_count, 100);
  assert.equal(entry.current.record_count, 103);
  assert.ok(entry.accepted_at);
  assert.equal(w.baseline().catalogs[NIST].accepted.record_count, 103);
  assert.equal(gate.verifyPublished(), true);
});

test('I: superseded records are accepted and their lifecycle transition is recorded', async (t) => {
  const w = world(t);
  const gate = w.gate();
  const next = records(100).map((entry, index) => (index < 10 ? { ...entry, status: 'superseded', superseded_by: `R-new-${index}` } : entry));
  assert.equal((await refreshOne(w, gate, NIST, bytesOf(next))).status, 'accepted');
  gate.finalize([{ ...w.unit(NIST), status: 'accepted' }]);
  const [entry] = w.changeLog().catalogs[NIST];
  assert.equal(entry.changed_count, 10);
  assert.deepEqual(entry.lifecycle_transitions.find((move) => move.field === 'status'), { field: 'status', from: 'active', to: 'superseded', count: 10 });
});

// ---- C. large valid update, and the same size without evidence ------------
test('C: a large change is accepted when the publisher inventory reconciles and nothing was removed', async (t) => {
  const w = world(t);
  w.native.set(DISA, { expected_count: 180, excluded_count: 0 });
  const gate = w.gate();
  const result = await refreshOne(w, gate, DISA, bytesOf(records(180)));
  assert.equal(result.status, 'accepted');
  gate.finalize([{ ...w.unit(DISA), status: 'accepted' }]);
  const [entry] = w.changeLog().catalogs[DISA];
  assert.equal(entry.decision, 'reconciled_change');
  assert.deepEqual([entry.added_count, entry.removed_count], [80, 0]);
  assert.equal(w.baseline().catalogs[DISA].anchor.record_count, 180, 'the anchor follows an evidenced change');
  assert.equal(gate.verifyPublished(), true);
});

test('C: the same growth is quarantined when the publisher reconciliation reports a failed publication', async (t) => {
  const w = world(t);
  w.native.set(DISA, { expected_count: 180, excluded_count: 0 });
  w.put('data/disa-artifact-manifest.json', JSON.stringify({ ...DISA_MANIFEST, publications: { ...DISA_MANIFEST.publications, failed_publications: 1 } }));
  const gate = w.gate();
  const result = await refreshOne(w, gate, DISA, bytesOf(records(180)));
  assert.equal(result.status, 'quarantined');
  assert.match(result.error, /uncorroborated_count_change \(80 added, 0 removed, 0 changed of 100\)/);
  assert.deepEqual(w.get(catalogPath(DISA)), w.committed.get(catalogPath(DISA)));
});

// ---- D, E, F. malformed, duplicate, schema drift -------------------------
for (const [label, candidate, pattern] of [
  ['D: one malformed record', bytesOf([...records(99), { title: 'no identity' }]), /identities must be nonempty and unique/],
  ['E: a duplicate stable identity', bytesOf([...records(99), record(0)]), /identities must be nonempty and unique/],
  ['F: schema drift (records renamed)', Buffer.from(JSON.stringify({ items: records(100) })), /requires records/],
  ['a zero-record result', bytesOf([]), /malformed_or_empty/],
  ['truncated JSON', Buffer.from('{"records":[{"id":"R-0"'), /JSON/],
]) {
  test(`${label} is quarantined and the accepted file is restored byte for byte`, async (t) => {
    const w = world(t);
    const gate = w.gate();
    const result = await refreshOne(w, gate, NIST, candidate);
    assert.equal(result.status, 'quarantined');
    assert.match(result.error, pattern);
    assert.deepEqual(w.get(catalogPath(NIST)), w.committed.get(catalogPath(NIST)));
    assert.deepEqual(gate.finalize([{ ...w.unit(NIST), status: 'quarantined' }]), JSON.parse(w.committed.get('data/source-baselines.json')));
    assert.equal(w.changeLog(), null, 'a quarantined candidate leaves no accepted-change evidence');
  });
}

// ---- G. publisher version change -----------------------------------------
test('G: a publisher revision that proves itself is accepted and the version change is recorded', async (t) => {
  const w = world(t);
  const gate = w.gate();
  const next = records(150);
  assert.equal((await refreshOne(w, gate, NIST, bytesOf(next, { publisher_inventory: publisherInventory(next, '2.0') }))).status, 'accepted');
  gate.finalize([{ ...w.unit(NIST), status: 'accepted' }]);
  const [entry] = w.changeLog().catalogs[NIST];
  assert.equal(entry.decision, 'publisher_revision');
  assert.equal(entry.version_changed, true);
  assert.equal(entry.current.publisher_version, '2.0');
});

// ---- H. removed records ---------------------------------------------------
test('H: mass removal is quarantined even when the count would be reconciled', async (t) => {
  const w = world(t);
  w.native.set(DISA, { expected_count: 60, excluded_count: 0 });
  const gate = w.gate();
  const result = await refreshOne(w, gate, DISA, bytesOf(records(60)));
  assert.equal(result.status, 'quarantined');
  assert.match(result.error, /unexplained_removals \(0 added, 40 removed, 0 changed of 100\)/);
  assert.deepEqual(w.get(catalogPath(DISA)), w.committed.get(catalogPath(DISA)));
});

test('H: an unreconciled shrink is quarantined too', async (t) => {
  const w = world(t);
  const gate = w.gate();
  assert.equal((await refreshOne(w, gate, NIST, bytesOf(records(60)))).status, 'quarantined');
});

// ---- reviewed commits that never went through refresh ---------------------
test('a reviewed commit that changed data without a baseline is adopted instead of failing every later refresh', async (t) => {
  const w = world(t);
  const reviewed = bytesOf(records(140));
  w.committed.set(catalogPath(DISA), reviewed);
  w.put(catalogPath(DISA), reviewed);
  w.native.set(DISA, { expected_count: 140, excluded_count: 0 });
  const gate = w.gate();
  assert.deepEqual([...gate.adoptions.keys()], [DISA]);
  const result = await refreshOne(w, gate, DISA, reviewed);
  assert.equal(result.status, 'accepted');
  const baseline = gate.finalize([{ ...w.unit(DISA), status: 'accepted' }]);
  assert.equal(baseline.catalogs[DISA].adopted_from, 'committed_data');
  assert.equal(baseline.catalogs[DISA].accepted.record_count, 140);
  assert.equal(baseline.catalogs[DISA].accepted_at, '2026-09-16T00:00:00.000Z');
  assert.equal(w.changeLog().catalogs[DISA][0].decision, 'adopted_committed_state');
  assert.equal(gate.verifyPublished(), true);
});

test('adoption is refused for committed data that fails the structural floor', (t) => {
  const w = world(t);
  const tiny = bytesOf(records(3));
  w.committed.set(catalogPath(NIST), tiny);
  assert.equal(w.gate().adoptions.size, 0);
});

// ---- J. optional artifact unavailable: last accepted contribution stays ----
const olirPrevious = (retention) => ({
  id: 194, ingested: true, map_file: 'maps/olir/194.json',
  artifact: { map_file: 'maps/olir/194.json', checksum: sha('map'), byte_length: 3, relationship_count: 2 },
  ...(retention ? { retention } : {}),
});
const olirMap = Buffer.from(JSON.stringify({ olir_id: 194, sha256: sha('map'), byte_length: 3, relationships: [{}, {}] }));
const missingMapping = (status) => new Map([[194, { attempts: [{ kind: 'detail', status: 200 }, { kind: 'artifact', status }], mapping: null, unavailable_reason: 'no public relationship mapping could be downloaded' }]]);

test('J: a mapping NIST no longer publishes keeps its last accepted relationships and is a recorded limitation', () => {
  const retrieved = missingMapping(404);
  const retained = retainOlirSubmissions(retrieved, [olirPrevious()], () => olirMap);
  assert.equal(retained.get(194).mapping.relationship_count, 2, 'relationships are not dropped');
  assert.equal(classifyOlirRetention(retrieved.get(194)), 'publisher_unavailable');
  const results = [{ sourceId: 'fetch-olir-catalog', status: 'accepted' }];
  const manifest = { processed_items: [{ id: 194, refresh_status: 'retained_last_good', refresh_error: 'no mapping', retention: { cause: 'publisher_unavailable', first_retained_at: '2026-09-16T00:00:00.000Z', consecutive_refreshes: 5 } }] };
  const [health] = applyOlirRetentionHealth(results, manifest);
  assert.equal(health.status, 'accepted_partial');
  assert.equal(health.limitations[0].cause, 'publisher_unavailable');
  const open = { number: 212, state: 'open', title: 'x', body: '<!-- control-atlas-refresh:fetch-olir-catalog -->\nold' };
  const [close] = planAlertChanges([health], [open]);
  assert.equal(close.payload.state, 'closed');
  assert.match(close.payload.body, /1 recorded limitation/);
});

test('J: a temporary failure is quiet at first and becomes an alert only if it keeps repeating', () => {
  const results = [{ sourceId: 'fetch-olir-catalog', status: 'accepted' }];
  const manifest = (count) => ({ processed_items: [{ id: 194, refresh_status: 'retained_last_good', refresh_error: 'HTTP 503', retention: { cause: 'transient', first_retained_at: 'x', consecutive_refreshes: count } }] });
  assert.equal(classifyOlirRetention(missingMapping(503).get(194)), 'transient');
  assert.equal(applyOlirRetentionHealth(results, manifest(1))[0].status, 'accepted_partial');
  assert.equal(applyOlirRetentionHealth(results, manifest(2))[0].status, 'accepted_partial');
  const [escalated] = applyOlirRetentionHealth(results, manifest(3));
  assert.equal(escalated.status, 'quarantined');
  assert.match(escalated.error, /194: HTTP 503/);
});

test('J: a retained mapping whose stored evidence no longer matches is refused rather than trusted', () => {
  assert.throws(() => retainOlirSubmissions(missingMapping(404), [olirPrevious()], () => Buffer.from(JSON.stringify({ olir_id: 194, sha256: sha('other'), byte_length: 3, relationships: [{}, {}] }))), /evidence mismatch/);
});

// ---- K. required artifact unavailable; L, M, N transport ----------------
test('K: a required artifact that stays unavailable quarantines the source and keeps every accepted byte', async (t) => {
  const w = world(t);
  const gate = w.gate();
  let calls = 0;
  const result = await runSourceTransaction({
    root: w.root, sourceId: 'fetch-nist', paths: [catalogPath(NIST)], attempts: 3,
    sleep: async () => { assert.fail('a 404 is not retried'); },
    operation: () => { calls += 1; w.put(catalogPath(NIST), 'partial'); throw new Error('Fetch failed (404) for https://csrc.nist.gov/example'); },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'quarantined');
  assert.equal(result.failure_class, 'permanent');
  assert.deepEqual(w.get(catalogPath(NIST)), w.committed.get(catalogPath(NIST)));
  gate.recordResult({ ...w.unit(NIST), ...result });
  assert.equal(JSON.parse(w.get('data/source-registry.json')).quarantine[0].disposition, 'retained_last_good');
});

const noSleep = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };
const officialUrl = 'https://csrc.nist.gov/extensions/example';
const timeoutError = () => Object.assign(new Error('network timeout'), { type: 'request-timeout' });

test('L: an HTTP timeout is retried with exponential backoff, then reported after a bounded number of attempts', async () => {
  const { waits, sleep } = noSleep();
  let calls = 0;
  const flaky = createStrictConditionalFetch({ sleep, fetchImpl: async () => { calls += 1; if (calls < 3) throw timeoutError(); return new Response('ok'); } });
  assert.equal(await (await flaky(officialUrl)).text(), 'ok');
  assert.deepEqual(waits, [1000, 2000]);
  calls = 0;
  waits.length = 0;
  const dead = createStrictConditionalFetch({ sleep, fetchImpl: async () => { calls += 1; throw timeoutError(); } });
  await assert.rejects(dead(officialUrl), /timeout/);
  assert.equal(calls, 3, 'never more than three requests');
  assert.deepEqual(waits, [1000, 2000]);
});

test('L: every request carries a deterministic timeout', async () => {
  let seen;
  const fetchSource = createStrictConditionalFetch({ fetchImpl: async (_url, init) => { seen = init.timeout; return new Response('ok'); } });
  await fetchSource(officialUrl);
  assert.equal(seen, 60000);
});

test('M: HTTP 500 and 503 are retried, and a persistent 503 is returned honestly for the caller to report', async () => {
  const { waits, sleep } = noSleep();
  const statuses = [500, 503, 200];
  const recovering = createStrictConditionalFetch({ sleep, fetchImpl: async () => new Response('ok', { status: statuses.shift() }) });
  assert.equal((await recovering(officialUrl)).status, 200);
  assert.deepEqual(waits, [1000, 2000]);
  let calls = 0;
  const down = createStrictConditionalFetch({ sleep: async () => {}, fetchImpl: async () => { calls += 1; return new Response('', { status: 503 }); } });
  assert.equal((await down(officialUrl)).status, 503);
  assert.equal(calls, 3);
});

test('M: 429 honors Retry-After within a cap, and 404 or 403 are never retried', async () => {
  const { waits, sleep } = noSleep();
  const answers = [new Response('', { status: 429, headers: { 'retry-after': '2' } }), new Response('ok')];
  const limited = createStrictConditionalFetch({ sleep, fetchImpl: async () => answers.shift() });
  assert.equal((await limited(officialUrl)).status, 200);
  assert.deepEqual(waits, [2000]);
  const huge = createStrictConditionalFetch({ sleep, fetchImpl: (() => { const list = [new Response('', { status: 429, headers: { 'retry-after': '3600' } }), new Response('ok')]; return async () => list.shift(); })() });
  waits.length = 0;
  await huge(officialUrl);
  assert.deepEqual(waits, [15000], 'a publisher cannot make the job wait an hour');
  for (const status of [404, 403]) {
    let calls = 0;
    const fetchSource = createStrictConditionalFetch({ sleep: async () => assert.fail('not retried'), fetchImpl: async () => { calls += 1; return new Response('', { status }); } });
    assert.equal((await fetchSource(officialUrl)).status, status);
    assert.equal(calls, 1);
  }
});

test('N: a temporary redirect to another official host is followed and only official hosts are contacted', async () => {
  const requested = [];
  const fetchSource = createStrictConditionalFetch({ fetchImpl: async (url) => {
    requested.push(url);
    return requested.length === 1 ? new Response('', { status: 302, headers: { location: 'https://csrc.nist.gov/moved/here' } }) : new Response('moved');
  } });
  assert.equal(await (await fetchSource(officialUrl)).text(), 'moved');
  assert.deepEqual(requested, [officialUrl, 'https://csrc.nist.gov/moved/here']);
  const mirror = createStrictConditionalFetch({ fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://mirror.example/copy' } }) });
  await assert.rejects(mirror(officialUrl), /source URL policy/);
});

test('a transient whole-source failure is retried with backoff and a deterministic one is not', async (t) => {
  const w = world(t);
  const { waits, sleep } = noSleep();
  let attempts = 0;
  const recovered = await runSourceTransaction({
    root: w.root, sourceId: 's', paths: [catalogPath(NIST)], attempts: 3, sleep, backoff: { baseMs: 15000, maxMs: 60000 },
    operation: () => { attempts += 1; if (attempts < 3) throw new Error('HTTP 503 fetching https://csrc.nist.gov/x'); },
  });
  assert.equal(recovered.status, 'accepted');
  assert.deepEqual(waits, [15000, 30000]);
  const exhausted = await runSourceTransaction({
    root: w.root, sourceId: 's', paths: [catalogPath(NIST)], attempts: 3, sleep, backoff: { baseMs: 15000, maxMs: 60000 },
    operation: () => { throw new Error('ETIMEDOUT'); },
  });
  assert.equal(exhausted.status, 'quarantined');
  assert.equal(exhausted.attempts, 3);
  assert.equal(exhausted.failure_class, 'transient');
  let validations = 0;
  const rejected = await runSourceTransaction({
    root: w.root, sourceId: 's', paths: [catalogPath(NIST)], attempts: 3, sleep,
    operation: () => {}, validate: () => { validations += 1; throw new Error(`${NIST}: uncorroborated_count_change`); },
  });
  assert.equal(rejected.attempts, 1, 'a validation rejection is the publisher\'s current answer');
  assert.equal(validations, 1);
});

// ---- O, P. failure between retrieval and acceptance, and in derived work ------
test('O: a failure after retrieval but before acceptance restores last-known-good and cannot advance the baseline', async (t) => {
  const w = world(t);
  const gate = w.gate();
  const result = await runSourceTransaction({
    root: w.root, sourceId: 'fetch-nist', paths: [catalogPath(NIST)], attempts: 1,
    operation: () => w.put(catalogPath(NIST), bytesOf(records(101))),
    validate: () => { throw new Error('derived contract rejected candidate'); },
  });
  assert.equal(result.status, 'quarantined');
  assert.deepEqual(w.get(catalogPath(NIST)), w.committed.get(catalogPath(NIST)));
  assert.deepEqual(gate.finalize([{ ...w.unit(NIST), status: 'quarantined' }]), JSON.parse(w.committed.get('data/source-baselines.json')));
});

function pipelineTasks() {
  return [
    { id: 'fetch-good', script: 'x.mjs', args: [], stages: ['acquire'], scope: ['a'], retries: 1, remote_fetch: true, isolation: 'quarantinable' },
    { id: 'fetch-bad', script: 'x.mjs', args: [], stages: ['acquire'], scope: ['b'], retries: 1, remote_fetch: true, isolation: 'quarantinable' },
    { id: 'derive', script: 'x.mjs', args: [], stages: ['normalize'], scope: ['all'], retries: 1, isolation: 'fail_fast' },
  ];
}

test('one bad source is quarantined while an unaffected source is accepted and published', async (t) => {
  const w = world(t);
  const gate = w.gate();
  const paths = { 'fetch-good': [catalogPath(NIST)], 'fetch-bad': [catalogPath('nist-800-171')] };
  const result = await runRefreshPipeline({
    root: w.root, tasks: pipelineTasks(), validateCandidate: (unit) => gate.validateCandidate(unit), recordResult: (entry) => gate.recordResult(entry),
    finalize: (results) => gate.finalize(results), describeProjection: () => null,
    describeSources: (task) => [{ taskId: task.id, sourceId: task.id, script: task.script, args: [], paths: paths[task.id], retries: 1 }],
    executor: (unit) => {
      if (unit.sourceId === 'fetch-good') w.put(catalogPath(NIST), bytesOf([...records(100), record(100)]));
      if (unit.sourceId === 'fetch-bad') w.put(catalogPath('nist-800-171'), bytesOf([...records(99), record(0)]));
    },
  });
  assert.equal(result.status, 'complete_with_quarantine');
  assert.deepEqual(result.sourceResults.map((entry) => [entry.sourceId, entry.status]), [['fetch-good', 'accepted'], ['fetch-bad', 'quarantined']]);
  const baseline = w.baseline();
  assert.equal(baseline.catalogs[NIST].accepted.record_count, 101);
  assert.equal(baseline.catalogs['nist-800-171'].accepted.record_count, 100);
  assert.deepEqual(w.get(catalogPath('nist-800-171')), w.committed.get(catalogPath('nist-800-171')));
  assert.equal(JSON.parse(w.get('data/source-registry.json')).quarantine.length, 1);
});

test('P: a failure during derived work stops the run before finalization and the accepted baseline is untouched', async (t) => {
  const w = world(t);
  const gate = w.gate();
  let finalized = false;
  await assert.rejects(runRefreshPipeline({
    root: w.root, tasks: pipelineTasks(), validateCandidate: (unit) => gate.validateCandidate(unit), recordResult: (entry) => gate.recordResult(entry),
    finalize: () => { finalized = true; }, describeProjection: () => null,
    describeSources: (task) => [{ taskId: task.id, sourceId: task.id, script: task.script, args: [], paths: [catalogPath(NIST)], retries: 1 }],
    executor: (unit) => {
      if (unit.sourceId === 'fetch-good') w.put(catalogPath(NIST), bytesOf([...records(100), record(100)]));
      if (unit.sourceId === 'derive') throw new Error('derived build failed');
    },
  }), /derived build failed/);
  assert.equal(finalized, false);
  assert.deepEqual(w.get('data/source-baselines.json'), w.committed.get('data/source-baselines.json'));
  assert.equal(JSON.parse(w.get('.local/source-refresh-results.json')).status, 'failed');
  assert.equal(JSON.parse(w.get('data/ingestion-pipeline-manifest.json')).failed_task, 'derive');
  assert.equal(w.changeLog(), null, 'no accepted-change evidence exists for a run that did not finish');
});

// ---- Q. recovery on the next schedule -------------------------------------
test('Q: the next schedule recovers by itself: one issue while failing, updated not duplicated, closed on acceptance', async (t) => {
  const w = world(t);
  const runUrl = (id) => `https://github.com/RAMBULLS/control-atlas/actions/runs/${id}`;
  const failing = { sourceId: 'fetch-nist', status: 'quarantined', attempts: 2, error: 'HTTP 503' };
  const [create] = planAlertChanges([failing], [], runUrl(1));
  assert.equal(create.type, 'create');
  const issue = { number: 300, state: 'open', ...create.payload };
  assert.deepEqual(planAlertChanges([failing], [issue], runUrl(2)), [], 'the same failure next week adds nothing');
  const gate = w.gate();
  gate.recordResult({ ...w.unit(NIST), status: 'quarantined', error: 'HTTP 503' });
  assert.equal(JSON.parse(w.get('data/source-registry.json')).quarantine.length, 1);
  const recovered = await refreshOne(w, w.gate(), NIST, bytesOf([...records(100), record(100)]));
  assert.equal(recovered.status, 'accepted');
  assert.equal(JSON.parse(w.get('data/source-registry.json')).quarantine.length, 0, 'the quarantine record clears');
  const [close] = planAlertChanges([{ sourceId: 'fetch-nist', status: 'accepted' }], [issue], runUrl(3));
  assert.equal(close.number, 300);
  assert.equal(close.payload.state, 'closed');
});

// ---- Pulse: accepted change -> governed diff -> Pulse ----------------------
const CSF_SET = 'maps/800-53-to-csf.json';
const crosswalk = (pairs, version = '2.0-final', date = '2026-09-01') => JSON.stringify({
  source_key: 'nist-olir-csf2-to-sp800-53', source_version: version, snapshot_date: date,
  relationships: pairs.map(([source_id, target_id]) => ({ source_id, target_id, relationship_type: 'Concept Crosswalk' })),
});
const pulsePublications = new Map([[NIST, { name: 'NIST SP 800-53', publisher: 'NIST' }], ['csf-2', { name: 'NIST CSF 2.0', publisher: 'NIST' }], ['nist-800-171', { name: 'NIST SP 800-171', publisher: 'NIST' }]]);
function pulseOf(w) {
  const served = existsSync(join(w.root, CSF_SET)) ? observeRelationshipSet(JSON.parse(w.get(CSF_SET))) : null;
  return buildPulse({
    changeLog: w.changeLog(), baselines: w.baseline(), releaseLog: null, registry: JSON.parse(w.get('data/source-registry.json')),
    publications: pulsePublications, relationshipSets: RELATIONSHIP_SET_ENDPOINTS, servedSets: new Map(served ? [[CSF_SET, served]] : []),
    dataset: { dataset_id: 'abcdefabcdef', source_data_generated_at: '2026-09-23T00:00:00.000Z' }, inputs: {},
  });
}
async function refreshSet(w, gate, bytes, validate = () => {}) {
  const unit = { sourceId: 'fetch-olir-mappings', taskId: 'fetch-olir-mappings', paths: [CSF_SET], retries: 1 };
  const result = await runSourceTransaction({ root: w.root, sourceId: unit.sourceId, paths: unit.paths, attempts: 1, operation: () => w.put(CSF_SET, bytes), validate });
  gate.recordResult({ ...unit, ...result });
  return { unit, result };
}

test('Pulse: an accepted catalog change surfaces as a verified event; a quarantined one in the same run never does', async (t) => {
  const w = world(t);
  const gate = w.gate();
  const paths = { 'fetch-good': [catalogPath(NIST)], 'fetch-bad': [catalogPath('nist-800-171')] };
  await runRefreshPipeline({
    root: w.root, tasks: pipelineTasks(), validateCandidate: (unit) => gate.validateCandidate(unit), recordResult: (entry) => gate.recordResult(entry),
    finalize: (results) => gate.finalize(results), describeProjection: () => null,
    describeSources: (task) => [{ taskId: task.id, sourceId: task.id, script: task.script, args: [], paths: paths[task.id], retries: 1 }],
    executor: (unit) => {
      if (unit.sourceId === 'fetch-good') w.put(catalogPath(NIST), bytesOf([...records(100), record(100)]));
      if (unit.sourceId === 'fetch-bad') w.put(catalogPath('nist-800-171'), bytesOf([...records(99), record(0)]));
    },
  });
  const pulse = pulseOf(w);
  assert.deepEqual(pulse.events.map((event) => [event.subject.id, event.type, event.counts.added]), [[NIST, 'records_added', 1]]);
  assert.ok(!pulse.events.some((event) => event.subject.id === 'nist-800-171'), 'the quarantined candidate is not an event');
  assert.ok(!pulse.withheld.some((item) => item.catalog_id === 'nist-800-171'), 'nor even an accepted-log entry: it never reached the change log');
  assert.equal(pulse.quarantine.length, 1);
  assert.equal(pulse.quarantine[0].shown_as_event, false);
});

test('Pulse: an accepted relationship-set change is logged with direction and surfaces; a re-stamp and a quarantined set do not', async (t) => {
  const w = world(t);
  const before = crosswalk([['AC-01', 'GV.OC-03']]);
  w.committed.set(CSF_SET, Buffer.from(before));
  w.put(CSF_SET, before);

  // A quarantined candidate is rolled back and leaves no evidence.
  let gate = w.gate();
  const bad = await refreshSet(w, gate, crosswalk([['AC-01', 'GV.OC-03'], ['AC-02', 'PR.AA-01']]), () => { throw new Error('schema drift'); });
  assert.equal(bad.result.status, 'quarantined');
  gate.finalize([{ ...bad.unit, status: 'quarantined' }]);
  assert.equal(w.changeLog(), null);
  assert.deepEqual(pulseOf(w).events, []);

  // Each run starts from the committed state, as a real refresh does.
  const fresh = () => { w.put('data/source-baselines.json', w.committed.get('data/source-baselines.json')); return w.gate(); };
  // Only the retrieval date moved: nothing to record.
  gate = fresh();
  const stamped = await refreshSet(w, gate, crosswalk([['AC-01', 'GV.OC-03']], '2.0-final', '2026-09-23'));
  gate.finalize([{ ...stamped.unit, status: 'accepted' }]);
  assert.equal(w.changeLog(), null);

  // A real change is recorded, verifiable by admission, and shown with its direction.
  w.put(CSF_SET, before);
  gate = fresh();
  const good = await refreshSet(w, gate, crosswalk([['AC-01', 'GV.OC-03'], ['AC-02', 'PR.AA-01']]));
  assert.equal(good.result.status, 'accepted');
  gate.finalize([{ ...good.unit, status: 'accepted' }]);
  const [entry] = w.changeLog().relationship_sets[CSF_SET];
  assert.deepEqual([entry.added_count, entry.removed_count, entry.direction], [1, 0, 'source_to_target']);
  assert.equal(w.gate().verifyPublished(), true);
  const [event] = pulseOf(w).events;
  assert.equal(event.type, 'relationships_changed');
  assert.deepEqual(event.subject.direction, { from: NIST, to: 'csf-2' });
});
