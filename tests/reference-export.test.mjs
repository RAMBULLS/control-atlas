import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { ITEM_COLUMNS, CONNECTION_COLUMNS, csvRow, referenceItemRow, referenceConnectionRow, validateReferenceIdentity } from '../scripts/lib/reference-export.mjs';
import { csvRows } from '../scripts/lib/publisher-inventory.mjs';
import { csvRecords } from '../scripts/lib/csv-records.mjs';
import { readGeneratedCollection } from '../scripts/lib/generated-graph-artifacts.mjs';
import { reconcileReferenceRelationships } from '../scripts/lib/reference-reconciliation.mjs';
const base = resolve('.local-agent/reference-export/test-fixtures');
const fixture = (t) => {
  mkdirSync(base, { recursive: true }); const root = mkdtempSync(join(base, 'case-'));
  t.after(() => { assert.ok(root.startsWith(`${base}\\`) || root.startsWith(`${base}/`)); rmSync(root, { recursive: true }); });
  return root;
};
const write = (root, path, value) => { const full = join(root, path); mkdirSync(resolve(full, '..'), { recursive: true }); writeFileSync(full, JSON.stringify(value)); };
const context = () => ({ sourceById: new Map([['p1', { id: 'p1', version: '1.1' }], ['p2', { id: 'p2', version: '2.0' }]]), evidenceById: new Map([['e1', { id: 'e1', source_id: 'p1', locator: 'row 1' }], ['e2', { id: 'e2', source_id: 'p2', locator: 'row 2' }]]), parents: new Map(), originalById: new Map(), collections: [], resourceEvidence: [] });
const item = (id, source = 'p1') => ({ id, source_id: source, node_type: 'requirement', lifecycle_status: 'superseded', metadata: { item_id: '009', catalog_id: source, title: 'Comma, "quote" — 連携', description: 'First\r\nSecond\nThird', origin: 'publisher_normalized' } });
const edge = (extra = {}) => ({ id: 'edge:001', source_node_id: 'p1:009', target_node_id: 'p2:009', relationship_type: 'supported_by', relationship_class: 'correlation', assertion_class: 'published_mapping', publication_status: 'published', provenance_class: 'federal_published', confidence: 'direct', status: 'active', rationale: 'Exact reason', evidence_ids: ['e1', 'e2'], source_refs: [{ source_id: 'p1', locator: 'row 1' }, { source_id: 'p2', locator: 'row 2' }], publisher_assertions: [{ property: 'precedes', relationship: 'Supported by (precedes)' }], ...extra });

test('item IDs and native identifiers remain literal across editions, lifecycle and unmapped records', () => {
  const old = referenceItemRow(item('p1:009'), context()); const current = referenceItemRow(item('p2:009', 'p2'), context());
  assert.equal(old[0], 'p1:009'); assert.equal(old[3], '009'); assert.equal(old[6], '1.1'); assert.equal(current[6], '2.0');
  assert.equal(old[10], 'superseded'); assert.equal(JSON.parse(old.at(-1)).metadata.description, 'First\r\nSecond\nThird');
  assert.deepEqual(validateReferenceIdentity([item('p1:009'), item('p2:009', 'p2')], []), []);
});
test('a connection with multiple citations stays one row with native direction, qualifiers and evidence', () => {
  const row = referenceConnectionRow(edge(), context());
  assert.equal(row.length, CONNECTION_COLUMNS.length); assert.equal(row[1], 'p1:009'); assert.equal(row[2], 'p2:009'); assert.equal(row[3], 'supported_by');
  assert.equal(JSON.parse(row[19]).length, 2); assert.equal(JSON.parse(row[20])[0].property, 'precedes'); assert.equal(JSON.parse(row[21]).length, 2);
  assert.equal(csvRows(csvRow(row)).length, 1);
});
test('candidate/editorial status and recorded confidence are preserved and promotion is rejected', () => {
  const candidate = edge({ publication_status: 'candidate', provenance_class: 'inferred', confidence: 'inferred_high', warning: 'Candidate only', inference_rule_id: 'rule-1' });
  const row = referenceConnectionRow(candidate, context()); assert.equal(row[7], 'candidate'); assert.equal(row[11], 'inferred_high'); assert.equal(row[15], 'Candidate only');
  assert.ok(validateReferenceIdentity([item('p1:009'), item('p2:009')], [{ ...candidate, publication_status: 'published' }]).some((error) => error.includes('Promoted inference')));
  assert.ok(validateReferenceIdentity([item('p1:009'), item('p2:009')], [edge({ relationship_class: 'organizing', assertion_class: 'atlas_navigation', authority_class: 'atlas_editorial' })]).some((error) => error.includes('Promoted editorial')));
  assert.deepEqual(validateReferenceIdentity([item('p1:009'), item('p2:009')], [edge({ relationship_class: 'organizing', relationship_type: 'issued_under', provenance_class: 'mandated', authority_class: 'publisher' })]), []);
});
test('duplicate identities and unknown endpoints fail while distinct connection IDs survive', () => {
  assert.ok(validateReferenceIdentity([item('p1:009'), item('p1:009')], []).some((error) => error.includes('Duplicate item')));
  assert.ok(validateReferenceIdentity([item('p1:009')], [edge()]).some((error) => error.includes('Unknown endpoint')));
  const nodes = [item('p1:009'), item('p2:009')];
  assert.deepEqual(validateReferenceIdentity(nodes, [edge(), edge({ id: 'edge:002', relationship_type: 'supports' })]), []);
});
test('CSV round trip preserves Unicode, literal formulas, quotes, leading zeros, null JSON and mixed newlines across stream chunks', async (t) => {
  const root = fixture(t); const path = join(root, 'roundtrip.csv');
  const rows = [['ID', 'Text'], ['000012345678901234567890', '=1+1'], ['@SUM(A1:A2)', 'a,"b"\r\nc\nd'], ["'original", '連携😀'.repeat(70000)], ['null', JSON.stringify({ missing: null, list: ['a,b', 'line\r\nbreak'] })]];
  writeFileSync(path, rows.map(csvRow).join(''));
  const parsed = []; for await (const row of csvRecords(path)) parsed.push(row);
  assert.deepEqual(parsed, rows);
  writeFileSync(path, '"unclosed'); await assert.rejects(async () => { for await (const row of csvRecords(path)) void row; }, /unterminated quote/);
});
test('generated readers reject missing shards, wrong shard counts and wrong total counts', (t) => {
  const root = fixture(t); const manifest = { sharded_collection: { record_count: 2, shards: [{ path: 'one.json', record_count: 1 }] } };
  write(root, 'data/generated/nodes.json', manifest);
  assert.throws(() => readGeneratedCollection(root, 'nodes'), /ENOENT/);
  write(root, 'data/generated/one.json', { nodes: [] }); assert.throws(() => readGeneratedCollection(root, 'nodes'), /count or collection missing/);
  write(root, 'data/generated/one.json', { nodes: [{ id: 'one' }] }); assert.throws(() => readGeneratedCollection(root, 'nodes'), /shard total/);
});
test('source reconciliation rejects silently dropped mappings, wrong editions and hierarchy-only evidence', (t) => {
  const root = fixture(t);
  write(root, 'data/a.json', { records: [{ id: 'one', metadata: { relationships: [{ target_catalog: 'old', target_id: '009', relationship_type: 'supports', source_id: 'pub', source_locator: 'sheet#row=1' }] } }] });
  write(root, 'data/curated/nist-zt/mappings.json', { records: [] });
  const nodes = [{ id: 'a:one' }, { id: 'old:009' }, { id: 'new:009' }];
  const contracts = { catalogs: [['a.json', 'a']], maps: [] };
  const good = { id: 'connection', source_node_id: 'a:one', target_node_id: 'old:009', relationship_type: 'supports', source_refs: [{ source_id: 'pub', locator: 'sheet#row=1' }] };
  assert.equal(reconcileReferenceRelationships(root, { nodes, edges: [good] }, contracts).status, 'PASSED');
  for (const edges of [[], [{ ...good, target_node_id: 'new:009' }], [{ ...good, relationship_type: 'contains', relationship_class: 'structural' }], [{ ...good, source_refs: [] }]]) {
    assert.equal(reconcileReferenceRelationships(root, { nodes, edges }, contracts).status, 'FAILED');
  }
});
test('CSV headers are unique and fixed for the portable item and connection contracts', () => {
  assert.equal(new Set(ITEM_COLUMNS.map(([name]) => name)).size, ITEM_COLUMNS.length);
  assert.equal(new Set(CONNECTION_COLUMNS.map(([name]) => name)).size, CONNECTION_COLUMNS.length);
  assert.deepEqual(ITEM_COLUMNS.slice(0, 4).map(([name]) => name), ['AtlasItemId', 'ItemKind', 'PublisherId', 'PublisherItemId']);
});

test('retained workbook categories cannot disappear merely because normalization skipped them', (t) => {
  const root = fixture(t);
  const mapping = { id: 'retained-csf11-row', mapping_kind: 'csf_1_1', relationship_parse_status: 'resolved',
    locator: 'official-workbook#row=2', relationship_clauses: [{ relationship_type: 'supports', property: null }] };
  write(root, 'data/curated/nist-zt/mappings.json', { records: [mapping] });
  const result = reconcileReferenceRelationships(root, { nodes: [], edges: [] }, { catalogs: [], maps: [] });
  assert.equal(result.status, 'FAILED');
  assert.match(result.errors.join('\n'), /retained-csf11-row.*publisher clause missing/);
  assert.equal(result.zero_trust_workbooks.csf_1_1.source_rows, 1);
  assert.equal(result.zero_trust_workbooks.csf_1_1.represented_rows, 0);
});
