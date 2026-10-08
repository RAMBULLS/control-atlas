import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { INGESTION_TASKS } from '../scripts/lib/ingestion-pipeline.mjs';
import { syncCatalogSourceBundles } from '../scripts/sync-catalog-source-bundles.mjs';
import { fetchCatalogWithFallback } from '../scripts/fetch-framework-catalogs.mjs';

import { artifactHash, reconcileFreshness } from '../scripts/reconcile-source-freshness.mjs';
import { collectSourceChecks, retrievalScope, sourceCheckReceiptPath } from '../scripts/lib/source-check-receipts.mjs';

const checkTime = '2026-10-08T12:00:02.000Z';
const checkSha = `sha256:${'a'.repeat(64)}`;
const request = (url, extra = {}) => ({ url, checked_at: checkTime, method: 'GET', http: 200,
  validation: 'remote', scope: 'publisher_artifact_retrieval', sha256: checkSha, byte_length: 20, ...extra });
function checkFixture(ids) {
  const registry = { publications: ids.map((id) => ({ id })), artifacts: [], freshness: { sources: [] } };
  const report = { status: 'running', started_at: '2026-10-08T12:00:00.000Z', results: [] };
  const receipts = new Map();
  const fixture = { registry, report, activeStartedAt: report.started_at, readReceipt: (path) => receipts.get(path), hydration: { results: [] } };
  fixture.unit = (taskId, sourceId, requests) => {
    const path = sourceCheckReceiptPath(taskId, sourceId);
    report.results.push({ taskId, sourceId, checkReceiptPath: path, status: 'accepted', completed_at: '2026-10-08T12:00:03.000Z' });
    receipts.set(path, { task_id: taskId, source_id: sourceId, started_at: '2026-10-08T12:00:01.000Z', requests });
    return receipts.get(path);
  };
  fixture.artifact = (sourceId, id, url) => {
    registry.artifacts.push({ id, publication_source_id: sourceId, artifact_url: url, sha256: checkSha });
    fixture.hydration.results.push({ id, status: 'OK', http: 200, url, sha256: checkSha });
    return fixture.unit('hydrate-artifacts', id, [request(url)]);
  };
  return fixture;
}

test('canonical framework checks use exact accepted requests and CSF requires both inputs', () => {
  const fixture = checkFixture(['nist-800-53', 'nist-800-171', 'nist-csf-2', 'nist-oscal', 'nist-800-53a-assessment-procedures']);
  const base = 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/';
  fixture.unit('fetch-framework-catalogs', 'nist-800-53-rev5', [request(`${base}SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json`)]);
  fixture.unit('fetch-framework-catalogs', 'nist-800-171-rev3', [request(`${base}SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json`)]);
  const csf = fixture.unit('fetch-framework-catalogs', 'nist-csf-2', [request(`${base}CSF/v2.0/json/NIST_CSF_v2.0_catalog.json`)]);
  let checks = collectSourceChecks(fixture);
  assert.equal(checks.has('nist-800-53'), true);
  assert.equal(checks.has('nist-800-171'), true);
  assert.equal(checks.has('nist-csf-2'), false);
  assert.equal(checks.has('nist-oscal'), false);
  csf.requests.push(request('https://csrc.nist.gov/extensions/nudp/services/json/csf/download?olirids=all'));
  checks = collectSourceChecks(fixture);
  assert.equal(checks.has('nist-csf-2'), true);
  assert.equal(checks.has('nist-oscal'), true);
  assert.equal(checks.has('nist-800-53a-assessment-procedures'), false, 'controls are not assessment procedures');
});

test('all owned artifacts need successful current-run receipts, with no backfill from manifest generated_at', () => {
  const fixture = checkFixture(['publication']);
  fixture.artifact('publication', 'first', 'https://csrc.nist.gov/first');
  const second = fixture.artifact('publication', 'second', 'https://csrc.nist.gov/second');
  const good = second.requests[0];
  for (const bad of [[], [request(good.url, { checked_at: '2026-08-12T12:00:00Z' })], [request(good.url, { validation: 'cache_only' })], [request(good.url, { http: 404 })]]) {
    second.requests = bad;
    fixture.hydration.generated_at = checkTime;
    assert.equal(collectSourceChecks(fixture).has('publication'), false);
  }
  second.requests = [good];
  assert.equal(collectSourceChecks(fixture).has('publication'), true);
  fixture.hydration.results[1].carried_forward_from = '2026-08-12';
  assert.equal(collectSourceChecks(fixture).has('publication'), false);
});

test('old, quarantined, mismatched and non-active transaction receipts cannot mint check dates', () => {
  const fixture = checkFixture(['publication']);
  const receipt = fixture.artifact('publication', 'artifact', 'https://csrc.nist.gov/publication');
  for (const status of ['quarantined', 'failed']) {
    fixture.report.results[0].status = status;
    assert.equal(collectSourceChecks(fixture).size, 0);
  }
  fixture.report.results[0].status = 'accepted';
  receipt.source_id = 'other';
  assert.equal(collectSourceChecks(fixture).size, 0);
  receipt.source_id = 'artifact';
  fixture.activeStartedAt = '2026-10-01T12:00:00Z';
  assert.equal(collectSourceChecks(fixture).size, 0);
  fixture.activeStartedAt = fixture.report.started_at;
  fixture.report.status = 'complete';
  assert.equal(collectSourceChecks(fixture).size, 0);
});

test('a dated eCFR fetch records only pinned-edition retrieval, preserving the source check and import', () => {
  const fixture = checkFixture(['dod-cmmc-rule']);
  const url = 'https://www.ecfr.gov/api/versioner/v1/full/2026-08-01/title-32.xml?part=170';
  fixture.artifact('dod-cmmc-rule', 'artifact-dod-cmmc-rule', url);
  fixture.registry.freshness.sources.push({ source_id: 'dod-cmmc-rule', sync_model: 'curated', last_checked: '2026-06-09', last_imported: '2026-06-09', hash: checkSha });
  const checks = collectSourceChecks(fixture);
  assert.equal(checks.get('dod-cmmc-rule').scope, 'pinned_edition_retrieval');
  reconcileFreshness(fixture.registry, new Map(), '2026-10-08', checks);
  const freshness = fixture.registry.freshness.sources[0];
  assert.equal(freshness.last_checked, '2026-06-09');
  assert.equal(freshness.last_imported, '2026-06-09');
  assert.equal(freshness.last_retrieval_checked, '2026-10-08');
  assert.equal(retrievalScope('https://raw.githubusercontent.com/usnistgov/oscal-content/v1.5.0/catalog.json'), 'pinned_edition_retrieval');
});

test('local and committed-extraction hydration never checks DoD, and missing publications initialize unknown', () => {
  const fixture = checkFixture(['dod-zt-strategy', 'nist-iot-device-cybersecurity-requirement-catalogs']);
  fixture.artifact('dod-zt-strategy', 'artifact-dod-zt-strategy', 'https://dodcio.defense.gov/strategy.pdf');
  for (const http of ['local', 'committed-extraction']) {
    fixture.hydration.results[0].http = http;
    assert.equal(collectSourceChecks(fixture).size, 0);
  }
  reconcileFreshness(fixture.registry, new Map(), '2026-10-08', collectSourceChecks(fixture));
  assert.equal(fixture.registry.freshness.sources.length, 2);
  assert.ok(fixture.registry.freshness.sources.every((entry) => entry.last_checked === null && entry.last_imported === null && entry.hash === null));
});

test('actual Microsoft, NIST PDF, IoT workbook and mobile retrievals reach their own admitted publication', () => {
  const ids = ['microsoft-zero-trust-maturity-questionnaire-v1-1', 'nist-sp-800-207', 'nist-sp-800-207a', 'nist-iot-requirements-80053-mapping-draft', 'nist-mobile-threat-catalogue'];
  const fixture = checkFixture(ids);
  for (const id of ids) fixture.artifact(id, `artifact-${id}`, `https://csrc.nist.gov/${id}`);
  reconcileFreshness(fixture.registry, new Map(), '2026-10-08', collectSourceChecks(fixture));
  assert.deepEqual(fixture.registry.freshness.sources.map((entry) => [entry.source_id, entry.last_checked, entry.last_imported]), ids.map((id) => [id, '2026-10-08', null]));
});

test('a partially retained MITRE mapping cannot borrow the successful ontology check', () => {
  const fixture = checkFixture(['mitre-d3fend-mappings', 'mitre-d3fend-ontology']);
  const ontology = 'https://d3fend.mitre.org/ontologies/d3fend.json';
  const mappings = 'https://d3fend.mitre.org/api/ontology/inference/d3fend-full-mappings.json';
  fixture.hydration.results = [
    { id: 'artifact-mitre-d3fend-ontology', sha256: checkSha, url: ontology },
    { id: 'artifact-mitre-d3fend-mappings', sha256: checkSha, url: mappings },
  ];
  const receipt = fixture.unit('fetch-mitre', 'fetch-mitre', [request(ontology), request('https://d3fend.mitre.org/api/version.json')]);
  assert.equal(collectSourceChecks(fixture).has('mitre-d3fend-ontology'), true);
  assert.equal(collectSourceChecks(fixture).has('mitre-d3fend-mappings'), false);
  receipt.requests.push(request(mappings, { sha256: `sha256:${'b'.repeat(64)}` }));
  assert.equal(collectSourceChecks(fixture).has('mitre-d3fend-mappings'), false, 'a different rejected payload is not the retained mapping');
  receipt.requests.push(request(mappings));
  assert.equal(collectSourceChecks(fixture).has('mitre-d3fend-mappings'), true);
});

test('a local reconcile preserves every auto source check even when imported content changed', () => {
  const registry = { publications: [{ id: 'auto' }], freshness: { sources: [{ source_id: 'auto', sync_model: 'auto_synced', last_checked: '2026-08-01', last_imported: '2026-08-01', hash: checkSha }] } };
  reconcileFreshness(registry, new Map([['auto', [{ records: [{ id: 'changed' }] }]]]), '2026-10-08');
  assert.equal(registry.freshness.sources[0].last_checked, '2026-08-01');
  assert.equal(registry.freshness.sources[0].last_imported, '2026-10-08');
});

test('canonical 800-171 quarantine follows its verified primary artifact alias', () => {
  const fixture = checkFixture(['nist-800-171']);
  fixture.registry.quarantine = [{ id: 'artifact-nist-800-171-oscal-mappings', disposition: 'retained_last_good' }];
  reconcileFreshness(fixture.registry, new Map(), '2026-10-08', new Map([['nist-800-171', { scope: 'publisher_artifact_retrieval', checked_at: checkTime }]]));
  assert.equal(fixture.registry.freshness.sources[0].last_checked, null);
});

test('all four baseline profiles and the live publisher revision discovery are required', () => {
  const fixture = checkFixture(['nist-800-53b-baselines']);
  const root = 'https://raw.githubusercontent.com/usnistgov/oscal-content/0123456789012345678901234567890123456789/nist.gov/SP800-53/rev5/json/';
  const profiles = ['LOW', 'MODERATE', 'HIGH', 'PRIVACY'].map((name) => ({ url: `${root}NIST_SP-800-53_rev5_${name}-baseline_profile.json` }));
  fixture.baselines = { profiles, discovery: { profiles,
    revision_discovery: { url: 'https://api.github.com/repos/usnistgov/oscal-content/commits/main' },
    url: 'https://api.github.com/repos/usnistgov/oscal-content/contents/nist.gov/SP800-53/rev5/json?ref=0123456789012345678901234567890123456789',
  } };
  const urls = [fixture.baselines.discovery.revision_discovery.url, fixture.baselines.discovery.url, ...profiles.map((entry) => entry.url)];
  const receipt = fixture.unit('fetch-framework-catalogs', 'nist-800-53-rev5', urls.slice(0, -1).map((url) => request(url)));
  assert.equal(collectSourceChecks(fixture).has('nist-800-53b-baselines'), false);
  receipt.requests.push(request(urls.at(-1)));
  assert.equal(collectSourceChecks(fixture).get('nist-800-53b-baselines').scope, 'publisher_revision_retrieval');
});

test('DISA needs a consumed compilation probe and every fresh standalone archive', () => {
  const ids = ['disa-stig-library', 'disa-srg-library', 'disa-stig-srg-cci-references'];
  const fixture = checkFixture(ids);
  const index = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/';
  const archive = `${index}compilation.zip`;
  fixture.disa = { discovery_source: index, artifact_url: archive, byte_length: 100, retrieval_timestamp: checkTime,
    publications: { failed_publications: 0, missing_publications: 0, standalone_ingested: 1 },
    reconciliation: { failed_files: 0, standalone_packages: [{ filename: 'standalone.zip', checksum: checkSha }] },
  };
  const receipt = fixture.unit('fetch-disa-library', 'fetch-disa-library', [request(index), request(archive, { http: 206, scope: 'publisher_range_probe', total_byte_length: 100 })]);
  assert.equal(collectSourceChecks(fixture).size, 0, 'a disk-cached standalone does not count');
  receipt.requests.push(request(`${index}standalone.zip`));
  assert.deepEqual([...collectSourceChecks(fixture).keys()], ids);
  receipt.requests[1].total_byte_length = 99;
  assert.equal(collectSourceChecks(fixture).size, 0);
});

test('optional unavailable link observations cannot borrow an accepted observation task', () => {
  const fixture = checkFixture(['nuwcdivnpt-stig-manager']);
  const url = 'https://github.com/nuwcdivnpt/stig-manager';
  fixture.unit('observe-disa-sources', 'observe-disa-sources', [request(url)]);
  fixture.observations = [{ source_id: 'nuwcdivnpt-stig-manager', url, observed_at: checkTime, available: false }];
  assert.equal(collectSourceChecks(fixture).size, 0);
  fixture.observations[0].available = true;
  assert.equal(collectSourceChecks(fixture).has('nuwcdivnpt-stig-manager'), true);
});

test('artifact hashes ignore refresh timestamps but retain substantive changes', () => {
  const first = { snapshot_date: '2026-01-01', records: [{ id: 'A', title: 'Alpha' }] };
  const later = { snapshot_date: '2026-07-16', records: [{ id: 'A', title: 'Alpha' }] };
  const changed = { snapshot_date: '2026-07-16', records: [{ id: 'A', title: 'Beta' }] };
  assert.equal(artifactHash(first), artifactHash(later));
  assert.notEqual(artifactHash(first), artifactHash(changed));
});

test('reconciliation separates checked dates, imported dates, and link observations', () => {
  const unchangedArtifact = { source_version: '1', records: [{ id: 'A' }] };
  const existingHash = artifactHash([unchangedArtifact]);
  const registry = {
    sources: [{ id: 'auto', version: '1' }, { id: 'changed', version: '1' }, { id: 'link', version: 'current' }],
    freshness: { sources: [
      { source_id: 'auto', sync_model: 'auto_synced', last_checked: '2026-07-01', last_imported: '2026-07-01', hash: existingHash },
      { source_id: 'changed', sync_model: 'auto_synced', last_checked: '2026-07-01', last_imported: '2026-07-01', hash: null },
      { source_id: 'link', sync_model: 'link_out', last_checked: '2026-07-01', last_imported: null, hash: null },
    ] },
  };
  const artifacts = new Map([
    ['auto', [unchangedArtifact]],
    ['changed', [{ source_version: '2', records: [{ id: 'B' }] }]],
  ]);
  reconcileFreshness(registry, artifacts, '2026-07-16', new Map(['auto', 'changed', 'link'].map((id) => [id, {
    scope: 'publisher_artifact_retrieval', checked_at: '2026-07-16T12:00:00Z', requests: [],
  }])));
  assert.equal(registry.freshness.sources[0].last_checked, '2026-07-16');
  assert.equal(registry.freshness.sources[0].last_imported, '2026-07-01');
  assert.equal(registry.freshness.sources[1].last_imported, '2026-07-16');
  assert.equal(registry.sources[1].version, '2');
  assert.equal(registry.freshness.sources[2].last_checked, '2026-07-16');
  assert.equal(registry.freshness.sources[2].last_imported, null);
});

test('reconciliation keeps publication, source, and primary-artifact versions aligned', () => {
  const registry = {
    publications: [{ id: 'attack', version: '1', retrieved_at: '2026-07-01' }],
    sources: [{ id: 'attack', version: '1', retrieved_at: '2026-07-01' }],
    artifacts: [{ id: 'artifact-attack', publication_source_id: 'attack', version: '1', retrieved_at: '2026-07-01' }],
    freshness: { sources: [{ source_id: 'attack', sync_model: 'auto_synced', last_checked: '2026-07-01', last_imported: '2026-07-01', hash: null }] },
  };
  reconcileFreshness(registry, new Map([['attack', [{ source_version: '2', records: [{ id: 'A' }] }]]]), '2026-07-16');
  assert.equal(registry.publications[0].version, '2');
  assert.equal(registry.sources[0].version, '2');
  assert.equal(registry.artifacts[0].version, '2');
  assert.equal(registry.publications[0].retrieved_at, '2026-07-16');
});

test('bundle sync runs before the generator that creates its input, so it must tolerate absence', () => {
  // Regression guard for the 2026-09-09 refresh outage (run 34371450147):
  // sync-catalog-source-bundles read data/generated/catalog-records with a bare
  // readdirSync and aborted the refresh with ENOENT. data/generated is
  // gitignored, and the directory is produced by build-framework-data, which
  // runs LATER in the pipeline -- so on a clean runner the input cannot exist
  // and "none yet" is the correct answer.
  const ids = INGESTION_TASKS.map((task) => task.id);
  const sync = ids.indexOf('sync-source-bundles');
  const generator = ids.indexOf('build-framework-data');
  assert.ok(sync >= 0 && generator >= 0, 'both tasks must exist in the pipeline');
  assert.ok(
    sync < generator,
    'sync-source-bundles still precedes build-framework-data; if this ever flips, the '
      + 'absent-directory guard in catalogIds() can be revisited',
  );

  // The guard must never prune: `known` is seeded from the committed registry,
  // so a run that finds no generated records leaves every existing bundle in place.
  const registry = JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url), 'utf8'));
  const before = registry.catalog_source_bundles.length;
  assert.equal(syncCatalogSourceBundles(registry).catalog_source_bundles.length, before);
});

test('a catalog falls back to its backup source only when the primary is unavailable', async () => {
  const target = {
    id: 'nist-800-53-rev5',
    url: 'https://primary.example/catalog.json',
    backupUrls: ['https://backup.example/catalog.json'],
  };
  const ok = (url) => ({ ok: true, status: 200, url });

  // Healthy primary wins and the backup is never contacted.
  const seen = [];
  const healthy = await fetchCatalogWithFallback(target, async (url) => {
    seen.push(url);
    return ok(url);
  });
  assert.equal(healthy.url, target.url);
  assert.equal(healthy.usedBackup, false);
  assert.deepEqual(seen, [target.url]);

  // A non-OK primary falls through to the backup and reports that it did.
  const viaStatus = await fetchCatalogWithFallback(target, async (url) => (
    url === target.url ? { ok: false, status: 404 } : ok(url)
  ));
  assert.equal(viaStatus.url, target.backupUrls[0]);
  assert.equal(viaStatus.usedBackup, true);
  assert.match(viaStatus.failures[0], /HTTP 404/);

  // A throwing primary (DNS, TLS, a thrown 304) falls through the same way.
  const viaThrow = await fetchCatalogWithFallback(target, async (url) => {
    if (url === target.url) throw new Error('getaddrinfo ENOTFOUND');
    return ok(url);
  });
  assert.equal(viaThrow.usedBackup, true);

  // Every candidate failing is still an error, and names each one.
  await assert.rejects(
    () => fetchCatalogWithFallback(target, async () => { throw new Error('boom'); }),
    (error) => error.message.includes('primary.example')
      && error.message.includes('backup.example')
      && error.message.includes('all 2 candidate'),
  );
});
