import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DISA_PUBLIC_INVENTORY_URL, DISA_PUBLIC_LIBRARY_URL, DISA_PUBLIC_REQUEST_FINGERPRINT,
  disaCanonicalHash, disaEvidenceHash, disaInventoryHash, disaUiTuple, parseDisaPublicInventory, reconcileDisaPublicInventory } from '../scripts/lib/disa-public-inventory.mjs';
import { DISA_WITNESS_PATH, DISA_EVIDENCE_DIRECTORY, DISA_ACCEPTED_OUTPUT_PATHS,
  hashDisaFile, verifyRetainedDisaFile, hasDisaNativeAcceptance, validateDisaAcceptanceEvidence } from '../scripts/lib/disa-source-acceptance.mjs';
import { recordDisaInventoryReceipt, recordDisaNativeAcceptance, collectSourceChecks } from '../scripts/lib/source-check-receipts.mjs';
import { requireDisaHydrationAcceptance, hydrateArtifacts } from '../scripts/hydrate-artifacts.mjs';
import { runSourceTransaction } from '../scripts/lib/source-transaction.mjs';
import { sourceUnitsForTask } from '../scripts/lib/refresh-source-outputs.mjs';
import { reportRefreshAlerts } from '../tools/report-refresh-alerts.mjs';
import { fetchDisaPublicInventoryBytes } from '../scripts/lib/strict-conditional-fetch.mjs';

const sourceId = 'fetch-disa-library';
const receiptPath = '.local/source-check-receipts/fetch-disa-library--fetch-disa-library.json';
const publicationIds = ['disa-stig-library', 'disa-srg-library', 'disa-stig-srg-cci-references'];
const archive = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_SRG-STIG_Library_October_2026.zip';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-disa-integrity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previousSha = process.env.GITHUB_SHA; process.env.GITHUB_SHA = '8b47ab6247734ba43c39583ce0591b8b35632c2a';
  t.after(() => { if (previousSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = previousSha; });
  const now = new Date().toISOString(); const start = new Date(Date.now() - 5000).toISOString();
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)); };
  const get = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const rows = ['U_SRG-STIG_Library_October_2026.zip', 'U_Example_V1R1_STIG.zip'].map((filename, index) => ({
    Name: `File-00${index + 1}`, FileName: filename, Classification: 'Unclassified', DocumentLibrary: 'STIGs', RawDocumentLibrary: 'STIGs',
    DownloadLink: `https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/${filename}`, DownloadType: 'STIGs', RawDownloadType: 'STIGs', Topic: 'STIGs', UploadDate: '2026-10-26',
  }));
  const raw = Buffer.from(JSON.stringify({ returnValue: rows, cacheable: true }));
  const witnessBytes = Buffer.from(JSON.stringify({ schema_version: '1.0', source_page: DISA_PUBLIC_LIBRARY_URL,
    request_fingerprint: DISA_PUBLIC_REQUEST_FINGERPRINT, observed_at: '2026-11-11T01:46:00Z', inventory_checksum: disaInventoryHash(rows), record_count: 2,
    pages: [{ number: 1, start: 1, end: 2, total: 2, has_next: false, rows: rows.map(disaUiTuple) }] }));
  put(DISA_WITNESS_PATH, witnessBytes);
  put(receiptPath, { schema_version: '1.0', task_id: sourceId, source_id: sourceId, started_at: start, requests: [] });
  const snapshot = parseDisaPublicInventory(raw, { witnessBytes, observedAt: now, requestFingerprint: DISA_PUBLIC_REQUEST_FINGERPRINT, resolvedUrl: DISA_PUBLIC_INVENTORY_URL });
  const reconciliation = reconcileDisaPublicInventory(snapshot, { acceptedCompilationFiles: ['U_Example_V1R1_STIG.zip'] });
  const rawPath = `${DISA_EVIDENCE_DIRECTORY}/${snapshot.response_checksum.slice(7)}.json`; put(rawPath, raw);
  const inventory = recordDisaInventoryReceipt(join(root, receiptPath), { raw, witnessBytes, observedAt: now,
    requestFingerprint: DISA_PUBLIC_REQUEST_FINGERPRINT, resolvedUrl: DISA_PUBLIC_INVENTORY_URL, reconciliation, rawPath });
  const archiveBytes = Buffer.from('synthetic accepted archive bytes'); put('tmp/disa-cache/compilation.zip', archiveBytes);
  const manifest = { schema_version: '2.0', discovery_source: DISA_PUBLIC_INVENTORY_URL, artifact_url: archive, compilation_url: archive,
    checksum: disaEvidenceHash(archiveBytes), byte_length: archiveBytes.length, retrieval_timestamp: '2026-10-28T15:41:39.615Z',
    public_inventory: { receipt: inventory, reconciliation },
    publications: { expected_canonical_publications: 1, represented_in_compilation: 1, standalone_ingested: 0, failed_publications: 0, missing_publications: 0 },
    reconciliation: { failed_files: 0, standalone_packages: [] } };
  put('data/disa-artifact-manifest.json', manifest);
  const unit = { taskId: sourceId, sourceId, status: 'accepted', completed_at: new Date().toISOString(), checkReceiptPath: receiptPath };
  const report = { schema_version: '1.0', status: 'running', started_at: start, results: [unit] };
  const checks = () => collectSourceChecks({ registry: { publications: publicationIds.map((id) => ({ id })) }, report,
    activeStartedAt: start, readReceipt: () => get(receiptPath), disa: get('data/disa-artifact-manifest.json'),
    validateDisaEvidence: (m, r, times) => { try { return validateDisaAcceptanceEvidence(root, m, r, times); } catch { return false; } } });
  return { root, put, get, raw, witnessBytes, now, start, manifest, inventory, report, unit, checks };
}
function acceptNative(f) {
  // Simulated already-verified native output, not live publisher data. The
  // independent XML equivalence itself is covered by disa-refresh fixtures.
  for (const path of DISA_ACCEPTED_OUTPUT_PATHS) f.put(path, { fixture: 'verified native output', path });
  f.put(`${DISA_EVIDENCE_DIRECTORY}/native.json`, { fixture: 'independently verified native inventory' });
  const evidence = verifyRetainedDisaFile(join(f.root, 'tmp/disa-cache/compilation.zip'),
    { ...f.manifest, source_url: archive }, archive);
  f.manifest.native_acceptance = { scope: 'publisher_bytes_and_native_content', code_commit: f.inventory.code_commit,
    verified_at: new Date().toISOString(), response_checksum: f.inventory.sha256, inventory_checksum: f.inventory.inventory_checksum,
    native_checksum: hashDisaFile(join(f.root, DISA_EVIDENCE_DIRECTORY, 'native.json')).checksum,
    output_checksum: disaCanonicalHash(DISA_ACCEPTED_OUTPUT_PATHS.map((path) => ({ path, ...hashDisaFile(join(f.root, path)) }))), archives: [evidence] };
  recordDisaNativeAcceptance(join(f.root, receiptPath), f.manifest);
  f.put('data/disa-artifact-manifest.json', f.manifest); f.unit.completed_at = new Date().toISOString();
}
const issues = [255, 419].map((number) => ({ number, state: 'open', title: 'Source refresh quarantined: fetch-disa-library',
  body: '<!-- control-atlas-refresh:fetch-disa-library -->\nRecorded legacy directory HTTP 403. Source not recovered.' }));
function reportPlans(f, status) {
  f.put('.local/source-refresh-results.json', { ...f.report, results: [{ ...f.unit, status }] });
  return reportRefreshAlerts({ root: f.root, reportPath: join(f.root, '.local/source-refresh-results.json'),
    repository: 'RAMBULLS/control-atlas', execFileImpl: (_command, args) => args.includes('--slurp') ? JSON.stringify([issues]) : '{}' });
}

test('legacy 403 plus fixed public metadata success never visits legacy directory or marks recovery', async (t) => {
  const f = fixture(t); const seen = [];
  const result = await fetchDisaPublicInventoryBytes({ fetchImpl: async (url) => {
    seen.push(url); const response = new Response(f.raw, { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: DISA_PUBLIC_INVENTORY_URL }); return response;
  } });
  assert.deepEqual(result.bytes, f.raw); assert.deepEqual(seen, [DISA_PUBLIC_INVENTORY_URL]);
  assert.equal(f.checks().size, 0);
  assert.throws(() => requireDisaHydrationAcceptance(f.root, f.manifest, f.start), /metadata alone/);
  for (const status of ['accepted', 'accepted_partial']) assert.ok(!reportPlans(f, status).some((plan) => plan.payload.state === 'closed'));
  assert.equal(f.get('data/disa-artifact-manifest.json').retrieval_timestamp, '2026-10-28T15:41:39.615Z');
});

test('metadata-only hydration fails atomically and keeps existing artifact timestamps and evidence', async (t) => {
  const f = fixture(t); const id = 'artifact-disa-compilation-zip';
  f.put('data/source-registry.json', { artifacts: [{ id, retrieved_at: '2026-10-28', sha256: f.manifest.checksum }] });
  f.put('data/artifact-hydration-manifest.json', { results: [{ id, retrieved_at: '2026-10-28', status: 'OK' }] });
  const paths = ['data/source-registry.json', 'data/artifact-hydration-manifest.json'];
  const before = paths.map((path) => readFileSync(join(f.root, path)));
  const old = [process.env.CONTROL_ATLAS_REQUIRE_FRESH_FETCH, process.env.CONTROL_ATLAS_REFRESH_STARTED_AT];
  process.env.CONTROL_ATLAS_REQUIRE_FRESH_FETCH = '1'; process.env.CONTROL_ATLAS_REFRESH_STARTED_AT = f.start;
  try { await assert.rejects(hydrateArtifacts({ root: f.root, only: id, resolutions: [{ id, url: archive }], fetchImpl: () => assert.fail('must not fetch archive') }), /metadata alone/); }
  finally {
    for (const [index, name] of ['CONTROL_ATLAS_REQUIRE_FRESH_FETCH', 'CONTROL_ATLAS_REFRESH_STARTED_AT'].entries()) {
      if (old[index] === undefined) delete process.env[name]; else process.env[name] = old[index];
    }
  }
  assert.deepEqual(paths.map((path) => readFileSync(join(f.root, path))), before);
});

test('actual retained hashes plus current native/output proof are distinct from fresh retrieval and metadata', (t) => {
  const f = fixture(t); acceptNative(f);
  assert.equal(hasDisaNativeAcceptance(f.manifest, f.get(receiptPath), { startedAt: f.start, completedAt: f.unit.completed_at }), true);
  assert.equal(validateDisaAcceptanceEvidence(f.root, f.manifest, f.get(receiptPath), { startedAt: f.start, completedAt: f.unit.completed_at }), true);
  const checks = f.checks(); assert.deepEqual([...checks.keys()], publicationIds);
  assert.equal(checks.get(publicationIds[0]).publisher_bytes_retrieved, false);
  assert.equal(requireDisaHydrationAcceptance(f.root, f.manifest, f.start).archives[0].retrieval_timestamp, '2026-10-28T15:41:39.615Z');
  assert.equal(reportPlans(f, 'accepted').filter((plan) => plan.payload.state === 'closed').length, 2);
});

test('same-size changed bytes, stale proof, modified native/output, witness or raw evidence cannot recover', (t) => {
  const f = fixture(t); acceptNative(f);
  const originalArchive = readFileSync(join(f.root, 'tmp/disa-cache/compilation.zip'));
  const changed = Buffer.from(originalArchive); changed[0] ^= 1;
  f.put('tmp/disa-cache/compilation.zip', changed);
  assert.throws(() => verifyRetainedDisaFile(join(f.root, 'tmp/disa-cache/compilation.zip'), { ...f.manifest, source_url: archive }, archive), /differ/);
  assert.equal(f.checks().size, 0); assert.ok(!reportPlans(f, 'accepted_partial').some((plan) => plan.payload.state === 'closed'));
  f.put('tmp/disa-cache/compilation.zip', originalArchive);
  for (const path of [DISA_WITNESS_PATH, f.inventory.raw_path, `${DISA_EVIDENCE_DIRECTORY}/native.json`, 'data/stig-rules.json']) {
    const before = readFileSync(join(f.root, path)); f.put(path, '{}');
    assert.equal(f.checks().size, 0, path); f.put(path, before);
  }
  const prior = f.get(receiptPath); prior.started_at = '2026-10-01'; f.put(receiptPath, prior);
  assert.equal(f.checks().size, 0);
});

test('downstream native failure restores the entire declared DISA source/cache/receipt and historical times', async (t) => {
  const f = fixture(t);
  const task = { id: sourceId, script: 'fetch-disa-stigs.mjs', remote_fetch: true, isolation: 'quarantinable', retries: 1 };
  const paths = [...sourceUnitsForTask(task, {})[0].paths, receiptPath];
  const retained = ['data/disa-artifact-manifest.json', 'tmp/disa-cache/compilation.zip', f.inventory.raw_path, receiptPath, DISA_WITNESS_PATH];
  const before = retained.map((path) => readFileSync(join(f.root, path)));
  const old = new Date('2026-10-28T15:41:39Z'); for (const path of retained) utimesSync(join(f.root, path), old, old);
  const outcome = await runSourceTransaction({ root: f.root, sourceId, paths, operation: () => {
    for (const path of retained) f.put(path, 'unaccepted candidate');
    f.put('tmp/disa-cache/inventory/unaccepted.json', 'temporary proof');
    f.put('data/stig-rules.json', 'unaccepted normalized data');
    throw new Error('native IDs/editions did not reconcile');
  } });
  assert.equal(outcome.status, 'quarantined');
  assert.deepEqual(retained.map((path) => statSync(join(f.root, path)).mtimeMs), retained.map(() => old.getTime()));
  assert.deepEqual(retained.map((path) => readFileSync(join(f.root, path))), before);
  assert.equal(existsSync(join(f.root, 'tmp/disa-cache/inventory/unaccepted.json')), false);
  assert.equal(existsSync(join(f.root, 'data/stig-rules.json')), false);
  assert.ok(!reportPlans(f, 'accepted').some((plan) => plan.payload.state === 'closed'));
});
