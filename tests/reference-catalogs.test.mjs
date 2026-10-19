import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseCsf11Core, parseCriticalSoftware, referenceSha256 } from '../tools/importers/reference-catalog-adapter.mjs';
import { classifyCatalog, resolveExpectedLocator } from '../scripts/lib/completeness.mjs';
import { recordPresentationContract, undeclaredCapturedRecordFields } from '../src/shared/record-presentation.mjs';
import { iotMappingDisposition } from '../tools/importers/nist-structured-catalog-adapter.mjs';
import { effectiveProfile, assertionProfileId } from '../src/shared/entity-profiles.mjs';
import { verifyNormalizedArtifactEvidence } from '../scripts/lib/normalized-artifact-evidence.mjs';
import { verifyBaselineManifest } from '../scripts/lib/nist-baseline-profiles.mjs';
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('baseline publisher profiles and normalized summary retain separate artifact identities and exact evidence', () => {
  const registry = read('data/source-registry.json');
  const hydration = read('data/artifact-hydration-manifest.json');
  const baselines = read('data/800-53b-baselines.json').records;
  const summaryId = 'artifact-nist-800-53b-baselines';
  const summary = registry.artifacts.find((row) => row.id === summaryId);
  assert.equal(verifyNormalizedArtifactEvidence(summary, hydration.results.find((row) => row.id === summaryId), process.cwd()).record_count, 4);
  const bundle = registry.catalog_source_bundles.find((row) => row.catalog_id === 'nist-800-53b');
  assert.deepEqual(bundle.enrichment_artifact_ids, [summaryId]);
  for (const baseline of baselines) {
    const id = `artifact-nist-800-53b-${baseline.id.toLowerCase()}-profile`;
    const artifact = registry.artifacts.find((row) => row.id === id);
    const receipt = hydration.results.find((row) => row.id === id);
    assert.equal(baseline.metadata.primary_artifact_id, id);
    assert.ok(bundle.primary_artifact_ids.includes(id));
    assert.equal(artifact.format, 'oscal_json');
    assert.equal(artifact.origin, 'publisher_exact');
    assert.equal(artifact.sha256, receipt.sha256);
    assert.equal(artifact.byte_length, receipt.byte_length);
    assert.notEqual(artifact.sha256, summary.sha256);
  }
  const counts = verifyBaselineManifest(read('data/nist-800-53b-profile-manifest.json'), read('data/controls-800-53.json'));
  assert.equal(counts.reduce((sum, row) => sum + row.ingested, 0), 902);
});

test('restored publisher equivalence resolves an active assertion profile without relabeling', () => {
  const profile = effectiveProfile(assertionProfileId('equivalent'));
  assert.equal(profile.status, 'active');
  assert.equal(profile.native_type, 'equivalent');
  assert.ok(profile.required_fields.includes('predicate'));
});

test('CSF 1.1 parser retains native IDs, hierarchy, multiline source cells and continuation references', async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Core');
  sheet.addRows([
    ['Function', 'Category', 'Subcategory', 'Informative References'],
    ['IDENTIFY (ID)', 'Asset Management (ID.AM): Assets', 'ID.AM-1: Line one\nLine two', 'NIST SP 800-53 Rev. 4 CM-8'],
    [null, null, null, 'COBIT 5 BAI09.01'],
    [null, null, 'ID.AM-2: Software inventories', 'CIS CSC 2'],
  ]);
  const result = await parseCsf11Core(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].description, 'Line one\nLine two');
  assert.equal(result.records[0].category_id, 'ID.AM');
  assert.equal(result.records[0].function_id, 'ID');
  assert.deepEqual(result.records[0].metadata.informative_references, ['NIST SP 800-53 Rev. 4 CM-8', 'COBIT 5 BAI09.01']);
  assert.equal(result.records[1].id, 'ID.AM-2');
  for (const record of result.records) for (const fragment of record.metadata.source_fragments) assert.equal(fragment.checksum, referenceSha256(fragment.text));
});

test('critical-software parser retains full text, objective and references without inventing mappings', () => {
  const result = parseCriticalSoftware(Buffer.from('<table><tr><th>Security Measure (SM)</th><th>Federal Government Informative References</th></tr><tr><td colspan="2">Objective 1: Protect software.</td></tr><tr><td>SM 1.1: First line<br>Second line</td><td><ul><li>NIST, <a href="https://www.nist.gov/">CSF</a>: PR.AC-1</li></ul></td></tr></table>'));
  assert.equal(result.records[0].id, 'SM-1.1');
  assert.equal(result.records[0].metadata.publisher_item_id, 'SM 1.1');
  assert.match(result.records[0].description, /First line[\s\S]+Second line/);
  assert.equal(result.records[0].metadata.informative_references.length, 1);
  assert.equal(result.records[0].metadata.relationships, undefined);
  assert.throws(() => parseCriticalSoftware(Buffer.from('<table></table>')), /table not found/);
});

test('complete official catalogs reconcile identifiers, groups and stored source fragments', () => {
  const manifest = read('data/curated/reference-catalogs/source-manifest.json');
  const csf = read('data/csf-1.1.json').records;
  const measures = read('data/critical-software.json').records;
  assert.equal(csf.length, 108); assert.equal(measures.length, 20);
  assert.equal(new Set(csf.map((r) => r.function_id)).size, 5);
  assert.equal(new Set(csf.map((r) => r.category_id)).size, 23);
  assert.equal(new Set(measures.map((r) => r.metadata.category)).size, 5);
  for (const [records, inventory] of [[csf, manifest.catalogs.csf11], [measures, manifest.catalogs.critical_software]]) {
    assert.deepEqual(records.map((r) => r.id).sort(), inventory.record_ids);
    for (const record of records) {
      assert.ok(record.title && record.description && record.source.locator);
      for (const fragment of record.metadata.source_fragments) assert.equal(fragment.checksum, referenceSha256(fragment.text));
    }
  }
  for (const id of ['SM-2.5', 'SM-4.5', 'SM-5.1', 'SM-5.2', 'SM-5.3']) assert.ok(measures.some((record) => record.id === id), `${id} must survive without a Zero Trust mapping`);
});

test('snapshot regression equality does not establish publisher completeness', () => {
  const result = classifyCatalog({ expected: 344, imported: 344, excluded: 0, allChecksumsReal: true, primaryQuarantined: false, independentInventory: false });
  assert.equal(result.status, 'discovered'); assert.equal(result.missing, null);
  const changed = classifyCatalog({ expected: 344, imported: 343, excluded: 0, allChecksumsReal: true, primaryQuarantined: false, independentInventory: false });
  assert.ok(changed.errors.includes('regression-inventory-mismatch'));
});

test('new catalog contracts account for every captured metadata field', () => {
  for (const [file, catalog] of [['data/csf-1.1.json', 'nist-csf-1.1'], ['data/critical-software.json', 'nist-critical-software']]) {
    const contract = recordPresentationContract(catalog, 'requirement');
    for (const record of read(file).records) assert.deepEqual(undeclaredCapturedRecordFields(contract, record.metadata), [], record.id);
  }
});

test('evidence locators resolve exact edition IDs containing periods', () => {
  assert.equal(resolveExpectedLocator('x.json#catalogs.nist-csf-1.1.normalized_records', () => ({ catalogs: { 'nist-csf-1.1': { normalized_records: 108 } } })), 108);
});

test('publisher IoT typo remains a cited unresolved assertion instead of a guessed CSF mapping', () => {
  const valid = { target_catalog: 'nist-csf-1.1', target_id: 'PR.DS-1', source_locator: 'workbook#row=46', raw_mapping: 'PR.DS-1; PT.PT-1' };
  const invalid = { ...valid, target_id: 'PT.PT-1' };
  const result = iotMappingDisposition({ publisher_mappings: [valid, invalid] });
  assert.deepEqual(result.relationships, [valid]); assert.equal(result.unresolved_mappings[0].target_id, 'PT.PT-1');
  assert.equal(result.unresolved_mappings[0].raw_mapping, 'PR.DS-1; PT.PT-1'); assert.match(result.unresolved_mappings[0].reason, /absent from the complete official CSF 1.1/);
});
