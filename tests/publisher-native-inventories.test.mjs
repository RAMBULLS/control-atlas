import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { sourceUnitInventory, baselineProfileInventory, microsoftInventory, mobileInventory, iotInventory, assessmentInventory, controlId } from '../tools/importers/native-unit-inventories.mjs';
import { nativeDisaUnits } from '../tools/importers/disa-native-inventory.mjs';
import { resolvePublisherUnitProof } from '../scripts/lib/publisher-native-proof.mjs';
import { synchronizeCatalogInventoryContracts } from '../scripts/sync-catalog-inventory-contracts.mjs';
import { dedupeDisaRelationships, preserveDisaRecordHistory, preserveDisaConnectionIds } from '../scripts/lib/disa-publication-reconciliation.mjs';

test('publisher proof rejects wrong identities, forged byte evidence and unbounded historical claims', () => {
  const proof = { ...sourceUnitInventory([{ id: '0001' }], 'Complete declared native unit scope'), source_evidence: [{ url: 'https://publisher.example/file', sha256: `sha256:${'a'.repeat(64)}`, byte_length: 1, evidence_kind: 'downloaded_publisher_bytes' }] };
  const resolve = (value) => resolvePublisherUnitProof('catalog', { catalogs: { catalog: value } });
  assert.deepEqual(resolve(proof).record_ids, ['0001']);
  assert.throws(() => resolve({ ...proof, record_ids: ['different'] }), /disagree/);
  assert.throws(() => resolve({ ...proof, record_count: 2 }), /Invalid/);
  assert.throws(() => resolve({ ...proof, source_evidence: [{ ...proof.source_evidence[0], sha256: 'sha256:abc' }] }), /byte/);
  assert.throws(() => resolve({ ...proof, source_evidence: [{ ...proof.source_evidence[0], evidence_kind: 'complete_retained_publisher_page_capture' }] }), /reverification/);
  assert.equal(resolvePublisherUnitProof('absent', { catalogs: {} }), null);
  assert.throws(() => resolve({ ...proof, current_snapshot: { compilation_url: proof.source_evidence[0].url, checksum: proof.source_evidence[0].sha256, record_count: 1, record_ids: ['unrecorded-current-item'] } }), /Current\/retained/);
});

test('native baseline selection keeps exact membership and conflicting publisher title/version', () => {
  const profile = { metadata: { title: 'HIGH Revision 5.1.1', version: '5.2.0' }, imports: [{ 'include-controls': [{ 'with-ids': ['ac-01', 'ac-02.01'] }] }] };
  const inventory = baselineProfileInventory([{ id: 'HIGH', payload: { profile }, url: 'https://publisher.example/high.json' }]);
  assert.equal(inventory.native_units[0].edition, '5.2.0'); assert.equal(inventory.native_units[0].title, 'HIGH Revision 5.1.1');
  assert.deepEqual(inventory.memberships.HIGH, ['AC-1', 'AC-2.1']); assert.equal(controlId('AC-02 (03)'), 'AC-2.3');
  assert.throws(() => baselineProfileInventory([{ id: 'HIGH', payload: { profile: { ...profile, imports: [{ 'include-all': {} }] } } }]), /selection/);
});

test('assessment inventory walks enhancements and requires native objective parts', () => {
  const inventory = assessmentInventory({ catalog: { groups: [{ controls: [{ id: 'ac-1', class: 'SP800-53', parts: [{ name: 'assessment-objective' }], controls: [{ id: 'ac-1.1', class: 'SP800-53-enhancement', parts: [{ name: 'assessment-objective' }] }] }, { id: 'ac-2', class: 'SP800-53', parts: [] }] }] } });
  assert.deepEqual(inventory.record_ids, ['AC-1', 'AC-1.1']); assert.equal(inventory.exclusions[0].id, 'ac-2');
});

test('questionnaire traversal finds nonadjacent number columns and includes unmapped questions', async () => {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('1-Identity'); sheet.addRow(['Number', '', '', 'Question']); sheet.addRow([1, '', '', 'Unmapped question']);
  book.addWorksheet('Results').addRow(['formula']);
  const inventory = await microsoftInventory(await book.xlsx.writeBuffer()); assert.deepEqual(inventory.record_ids, ['MSZT-1-1']);
});

test('mobile grouping values are native categories; blank rows and CVE examples cannot become items', () => {
  const inventory = mobileInventory([{ ThreatID: 'M-001', ThreatCategory: 'Applications', CVE: 'CVE-0000-0000' }, { ThreatID: '', ThreatCategory: '' }]);
  assert.equal(inventory.record_count, 2); assert.equal(inventory.exclusions.length, 1); assert.ok(!inventory.record_ids.includes('CVE-0000-0000'));
  assert.throws(() => mobileInventory([{ ThreatID: '', ThreatCategory: 'Content' }]), /without an ID/);
  assert.throws(() => mobileInventory([{ ThreatID: 'M-1', ThreatCategory: 'A' }, { ThreatID: 'M-1', ThreatCategory: 'A' }]), /Duplicate/);
});

test('unknown IoT worksheets fail instead of silently skipping a mapping category', async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Future category').addRow(['ID']);
  await assert.rejects(iotInventory([{ id: 'native', bytes: await book.xlsx.writeBuffer() }]), /Unsupported IoT worksheet/);
});

test('independent mapping-workbook identities cannot be promoted to primary-catalog acquisition proof', () => {
  const proof = { ...sourceUnitInventory([{ id: 'IOT-1' }], 'Retained mapping workbooks only'), evidence_class: 'publisher_mapping_inventory', primary_extraction_status: 'not_performed', source_evidence: [{ url: 'https://www.nist.gov/workbook.xlsx', sha256: `sha256:${'a'.repeat(64)}`, byte_length: 100, evidence_kind: 'downloaded_publisher_bytes' }] };
  const native = resolvePublisherUnitProof('nist-iot-cybersecurity', { catalogs: { 'nist-iot-cybersecurity': proof } });
  const registry = synchronizeCatalogInventoryContracts({ artifacts: [], catalog_source_bundles: [{ catalog_id: 'nist-iot-cybersecurity', mapping_source_ids: ['workbook'] }] }, { 'nist-iot-cybersecurity': native });
  assert.equal(registry.catalog_source_bundles[0].expected_inventory.evidence_class, 'publisher_mapping_inventory');
  assert.equal(registry.catalog_source_bundles[0].expected_inventory.primary_extraction_status, 'not_performed');
});

const xml = (version = '2') => `<Benchmark id="Native_STIG"><title>Native Security Technical Implementation Guide</title><version>${version}</version><plain-text id="release-info">Release: 3</plain-text><Group id="V-000001"><Group id="V-000002"><Rule id="SV-000002r2_rule"><ident>CCI-000001</ident><ident>CCI-000001</ident></Rule></Group><Rule id="SV-000001r2_rule"><ident>CCI-000002</ident></Rule></Group></Benchmark>`;
test('independent XCCDF traversal preserves native rule editions and nested units, never creates transitively inferred mappings', () => {
  const units = nativeDisaUnits(xml(), 'native.xml', 'stig'); assert.equal(units.length, 2);
  assert.deepEqual(units.find((unit) => unit.id === 'V-000002').cci_ids, ['CCI-000001']); assert.equal(units[0].edition, 'V2R3');
  assert.equal(units[0].benchmark_id, 'Native_STIG'); assert.throws(() => nativeDisaUnits('<Benchmark>', 'bad.xml'), /Malformed/);
  assert.deepEqual(nativeDisaUnits('<Supporting/>', 'support.xml'), []);
});

const row = (id, edition = 'V1R1') => ({ source_catalog: 'disa-stig', source_id: id, target_catalog: 'disa-cci', target_id: 'CCI-000001', relationship_type: 'references', source_locator: `${edition}.xml#${id}`, source_version: edition, source_url: 'https://publisher.example/package.zip', source_checksum: `sha256:${'a'.repeat(64)}`, native_rule_id: `SV-${id}`, benchmark_id: 'Native_STIG', why: 'Native assertion' });
test('citation aggregation keeps edition/checksum distinctions without duplicating connections', () => {
  const old = row('V-1'); const next = { ...row('V-1', 'V2R1'), source_checksum: `sha256:${'b'.repeat(64)}` };
  const relationships = dedupeDisaRelationships([old, old, next]); assert.equal(relationships.length, 1); assert.equal(relationships[0].source_citations.length, 2);
  assert.equal(relationships[0].source_locator, old.source_locator); assert.notEqual(relationships[0].source_citations[0].checksum, relationships[0].source_citations[1].checksum);
});

test('inserted and absent rows cannot renumber old Atlas connection IDs or discard publisher assertions', () => {
  const old = dedupeDisaRelationships([row('V-2'), row('V-3')]); const next = dedupeDisaRelationships([row('V-1'), row('V-2', 'V2R1')]);
  const merged = preserveDisaConnectionIds(old, next); const byId = new Map(merged.map((entry) => [entry.source_id, entry]));
  assert.equal(byId.get('V-2').atlas_connection_id, 'edge:stig-srg-to-cci:1'); assert.equal(byId.get('V-3').atlas_connection_id, 'edge:stig-srg-to-cci:2'); assert.equal(byId.get('V-1').atlas_connection_id, 'edge:stig-srg-to-cci:3');
  assert.equal(byId.get('V-2').source_citations.length, 2); assert.equal(byId.get('V-3').current_snapshot_presence, false); assert.match(byId.get('V-3').warning, /No current applicability/);
  assert.deepEqual(preserveDisaConnectionIds(merged, next), merged);
  assert.throws(() => preserveDisaConnectionIds([old[0], old[0]], next), /Duplicate/);
});

test('new editions retain full old captured text and absent records without inventing retirement', () => {
  const record = (id, edition, description) => ({ id, rule_id: 'SV-1', description, source: { version: edition }, metadata: { benchmark_id: 'Native_STIG' } });
  const previous = [record('V-1', 'V1R1', 'Old exact text'), record('V-2', 'V1R1', 'Retain me')]; const current = [record('V-1', 'V2R1', 'New exact text')];
  const merged = preserveDisaRecordHistory(previous, current); assert.equal(merged.length, 2); assert.equal(merged[0].metadata.previous_editions[0].description, 'Old exact text');
  assert.equal(merged[1].metadata.current_snapshot_presence, false); assert.equal(merged[1].lifecycle, undefined); assert.match(merged[1].metadata.source_warnings[0], /UNKNOWN/);
  assert.deepEqual(preserveDisaRecordHistory(merged, current), merged); assert.throws(() => preserveDisaRecordHistory(previous, [...current, ...current]), /Duplicate/);
});
