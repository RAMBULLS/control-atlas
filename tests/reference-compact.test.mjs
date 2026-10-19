import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { COLUMNS, compactNode, selectScope, relationshipType, flattenDetails, citationRow, generatedRecords, validateCompactTables, itemLabel, sourceRecoveryColumns } from '../scripts/lib/compact-reference.mjs';
import { csvRow } from '../src/shared/csv.mjs';
import { csvRows } from '../scripts/lib/publisher-inventory.mjs';
import { csvRecords } from '../scripts/lib/csv-records.mjs';
import { cuiPublisherInventory } from '../tools/importers/cui-inventory.mjs';

const base = resolve('.local-agent/reference-export/compact-test-fixtures');
function fixture(t) {
  mkdirSync(base, { recursive: true }); const path = mkdtempSync(join(base, 'case-'));
  t.after(() => { assert.ok(path.startsWith(`${base}\\`) || path.startsWith(`${base}/`)); rmSync(path, { recursive: true }); }); return path;
}
const node = (id, catalog = 'nist-800-53') => ({ id, catalog });
const edge = (id, from, to, kind = 'correlation') => ({ id, source_node_id: from, target_node_id: to, relationship_class: kind });

test('scope keeps unmapped core controls, takes only direct context and retains native grouping ancestors', () => {
  const nodes = new Map([node('a'), node('unmapped'), node('direct', 'mitre-attack'), node('parent', 'mitre-attack'), node('indirect', 'mitre-attack'), node('irrelevant', 'dod-rai')].map((item) => [item.id, item]));
  const edges = [edge('map', 'a', 'direct'), edge('path', 'direct', 'indirect'), edge('hierarchy', 'parent', 'direct', 'structural'), edge('ai', 'a', 'irrelevant')];
  const scope = selectScope(nodes, edges);
  assert.deepEqual([...scope.selected].sort(), ['a', 'direct', 'parent', 'unmapped']);
  assert.deepEqual(scope.edges.map((item) => item.id), ['map', 'hierarchy']);
  assert.throws(() => selectScope(nodes, [edge('broken', 'missing', 'a')]), /Unknown canonical endpoint/);
});

test('hierarchy and editorial adjacency alone cannot bring a supporting item into mapping scope', () => {
  const nodes = new Map([node('a'), node('b', 'nist-mobile-threats')].map((item) => [item.id, item]));
  for (const kind of ['structural', 'organizing']) assert.equal(selectScope(nodes, [edge('not-map', 'a', 'b', kind)]).selected.has('b'), false);
});

test('native identifiers, descriptions and different benchmark/publication editions survive grouping', () => {
  const sources = new Map([['old', { version: '1.1', owner: 'NIST' }], ['new', { version: '2.0', owner: 'NIST' }]]);
  const raw = { id: 'old:0009', source_id: 'old', lifecycle_status: 'superseded', metadata: { catalog_id: 'nist-csf-1.1', publisher_item_id: '0009', family: 'Protect', title: 'Comma, "quote" — 連携', description: 'a\r\nb', benchmark_version: '1.1' } };
  const old = compactNode(raw, sources); const fresh = compactNode({ ...raw, id: 'new:0009', source_id: 'new', metadata: { ...raw.metadata, catalog_id: 'csf-2', benchmark_version: '2.0' } }, sources);
  assert.equal(old.nativeId, '0009'); assert.equal(old.description, 'a\r\nb'); assert.equal(old.lifecycle, 'superseded');
  assert.notEqual(old.groupId, fresh.groupId); assert.equal(old.groupRow[6], '1.1'); assert.equal(fresh.groupRow[8], '2.0');
});

test('type grouping does not conflate directions, confidence, candidate status or native qualifier text', () => {
  const raw = { relationship_type: 'supported_by', relationship_class: 'correlation', assertion_class: 'published_mapping', publication_status: 'published', confidence: 'direct', provenance_class: 'federal_published', raw_relationship_type: 'Supported by (precedes)' };
  const original = relationshipType(raw);
  assert.equal(original[4], 'directed'); assert.equal(original[11], 'Supported by (precedes)');
  for (const change of [{ publication_status: 'candidate' }, { directionality: 'bidirectional' }, { confidence: 'inferred_high' }, { raw_relationship_type: 'Supported by (example of)' }, { assertion_class: 'atlas_navigation' }]) assert.notEqual(relationshipType({ ...raw, ...change })[0], original[0]);
});

test('CVE and exploit examples are excluded while unresolved publisher notes remain plain labeled cells', () => {
  const item = compactNode({ id: 'threat:1', metadata: { cve_examples: ['CVE-2015-4640'], unresolved_mappings: [{ target_id: 'PT.PT-1', source_disposition: { status: 'rejected_invalid_publisher_identifier', reason: 'Not present' } }] } }, new Map());
  assert.ok(item.details.every((row) => !row[1].includes('cve examples') && !row[1].includes('exploit examples')));
  assert.ok(item.details.some((row) => row[3] === 'rejected_invalid_publisher_identifier'));
  assert.ok(item.details.every((row) => typeof row[3] === 'string' && !row[3].includes('[object Object]')));
  assert.equal('edges' in item, false);
});

test('long supplementary text splits below the Excel cell limit and preserves surrogate pairs', () => {
  const text = 'a'.repeat(29999) + '😀連携\r\n'.repeat(8000); const rows = [];
  flattenDetails('id', 'publisher note', text, rows);
  assert.equal(rows.map((row) => row[3]).join(''), text); assert.ok(rows.every((row) => row[3].length <= 30000));
  assert.ok(rows.every((row) => !/[\uD800-\uDBFF]$/.test(row[3])));
  assert.deepEqual(rows.map((row) => row[2]), rows.map((_, index) => index + 1));
});

test('multiple source/evidence references remain child rows of the same native connection', () => {
  const refs = [citationRow('connection', 'edge:one', { source_id: 's1', locator: 'sheet#row=2' }), citationRow('connection', 'edge:one', { id: 'evidence:one', source_id: 's2', locator: 'page 2', source_version: 'draft' })];
  assert.equal(new Set(refs.map((row) => row[1])).size, 1); assert.equal(refs[1][5], 'evidence:one'); assert.equal(refs[1][6], 'draft');
  assert.equal(citationRow('item', 'id', 'artifact#https://example.com/#section')[3], 'https://example.com/#section');
});

test('native DISA citation URL, checksum, rule and edition survive readable export together', () => {
  const ref = { id: 'evidence:native', source_id: 'disa-stig-library', locator: 'native.xml#V-000001', source_version: 'V2R3', source_url: 'https://publisher.example/package.zip', native_rule_id: 'SV-000001r3_rule', benchmark_id: 'Native_STIG', checksum: `sha256:${'a'.repeat(64)}` };
  const row = citationRow('connection', 'edge:001', ref);
  assert.equal(row.length, COLUMNS.Citations.length); assert.equal(row[6], 'V2R3'); assert.equal(row[8], ref.checksum); assert.deepEqual(row.slice(10), [ref.source_url, ref.native_rule_id, ref.benchmark_id]);
});

test('readable sources distinguish recovery and archival availability from publisher lifecycle', () => {
  const publication = { id: 'publisher', lifecycle_status: 'active' };
  const artifact = { id: 'artifact', publication_source_id: 'publisher', artifact_url: 'https://publisher.example/old.pdf', metadata: { source_recovery: { status: 'archive_content_verified', archival_corroboration: { url: 'https://archive.example/file.pdf' } } } };
  const rows = sourceRecoveryColumns(publication, new Map([[artifact.id, artifact]]));
  assert.match(rows[0], /publisher location unconfirmed/); assert.equal(rows[2], 'https://archive.example/file.pdf'); assert.match(rows[3], /retirement or replacement is unconfirmed/); assert.equal(publication.lifecycle_status, 'active');
  assert.deepEqual(sourceRecoveryColumns({ id: 'ordinary' }, new Map()), ['', '', '', '']);
});

test('prior edition identities and historical absence are visible without injecting large archival records into cells', () => {
  const item = compactNode({ id: 'disa-stig:V-1', metadata: { current_snapshot_presence: false, previous_editions: [{ rule_id: 'SV-1', description: 'Archived prose', source: { version: 'V1R1', locator: 'old.xml' }, metadata: { benchmark_id: 'Native_STIG' } }] } }, new Map());
  assert.ok(item.details.some((row) => row[1] === 'current snapshot presence' && row[3] === 'false'));
  for (const value of ['SV-1', 'V1R1', 'old.xml', 'Native_STIG']) assert.ok(item.details.some((row) => row[3] === value));
  assert.ok(!item.details.some((row) => row[3] === 'Archived prose'));
});

test('BOM CSV is readable and independently round trips Unicode, quotes, leading zeros, multiline text and blank values', async (t) => {
  const path = join(fixture(t), 'readable.csv'); const rows = [['Control ID', 'Description'], ['000012345678901234567890', 'Comma, "quote"\r\n連携😀'], ['=publisher-literal', ''], ['null', 'Not a JSON value']];
  writeFileSync(path, '\uFEFF' + rows.map(csvRow).join('')); const actual = []; for await (const row of csvRecords(path)) actual.push(row);
  assert.deepEqual(actual, rows); assert.deepEqual(csvRows(csvRow(rows[1])), [rows[1]]);
});

test('shard traversal rejects a missing file, duplicate path, wrong count, wrong total and escaping path', (t) => {
  const root = fixture(t); const dir = join(root, 'data/generated'); mkdirSync(dir, { recursive: true });
  const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value));
  const manifest = (shards, count = 1) => write('nodes.json', { sharded_collection: { record_count: count, shards } });
  manifest([{ path: 'one.json', record_count: 1 }]); assert.throws(() => [...generatedRecords(root, 'nodes')], /ENOENT/);
  write('one.json', { nodes: [{ id: 'one' }] }); assert.equal([...generatedRecords(root, 'nodes')].length, 1);
  manifest([{ path: 'one.json', record_count: 1 }, { path: 'one.json', record_count: 1 }], 2); assert.throws(() => [...generatedRecords(root, 'nodes')], /Duplicate/);
  manifest([{ path: 'one.json', record_count: 2 }]); assert.throws(() => [...generatedRecords(root, 'nodes')], /shard count/);
  manifest([{ path: 'one.json', record_count: 1 }], 2); assert.throws(() => [...generatedRecords(root, 'nodes')], /shard total/);
  manifest([{ path: '../escape.json', record_count: 1 }]); assert.throws(() => [...generatedRecords(root, 'nodes')], /Invalid.*path/);
});

test('readable table integrity fails on nested cells, dangling citations, missing groups and missing endpoints', () => {
  const tables = Object.fromEntries(Object.keys(COLUMNS).map((name) => [name, []]));
  tables.Items = [['nist-800-53', 'Access', 'AC-1', 'Title', 'Description', 'control', '', 'active', 0, 0, 'item:1', 'group:missing', 'source:missing', '']];
  tables.Connections = [['nist-800-53', 'AC-1', 'supports', 'csf-2', 'PR.AA-01', 'correlation', 'published', '', '', 'edge:1', 'item:1', 'missing', 'type:missing', '']];
  tables.Citations = [['connection', 'missing', 'source:missing', '', '', '', '', '', '', '']];
  assert.ok(validateCompactTables(tables).includes('Connection endpoint missing')); assert.ok(validateCompactTables(tables).includes('Item group missing'));
  assert.ok(validateCompactTables(tables).includes('Citation owner missing'));
  tables.Items[0][4] = { bad: 'JSON' }; assert.ok(validateCompactTables(tables).includes('Items: structured cell'));
});

test('connection labels show readable controls/titles while long generated keys remain in Items', () => {
  assert.equal(itemLabel({ nativeId: 'AC-1', title: 'Policy and Procedures' }), 'AC-1 — Policy and Procedures');
  assert.equal(itemLabel({ nativeId: 'CCI-000001', title: 'CCI-000001' }), 'CCI-000001');
  assert.equal(itemLabel({ nativeId: 'REFERENCE-COMPONENT-'.repeat(8), title: 'Policy Enforcement Point' }), 'Policy Enforcement Point');
});

test('CUI identity proof comes from native registry links and regulation definitions, not normalized counts', () => {
  const html = '<a href="/cui/registry/category-detail/cui/registry/category-detail/privileged-safety-info">PSI</a><a href="/cui/registry/category-detail/other">Other</a>';
  const xml = '(CUI) Program <I>CUI Basic</I><I>CUI Specified</I>';
  const inventory = cuiPublisherInventory(html, xml);
  assert.deepEqual(inventory.record_ids, ['CATEGORY-OTHER', 'CATEGORY-PRIVILEGED-SAFETY-INFO', 'CUI-BASIC', 'CUI-PROGRAM', 'CUI-SPECIFIED']);
  assert.equal(inventory.source_evidence[0].byte_length, Buffer.byteLength(html));
  assert.match(inventory.source_evidence[0].sha256, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => cuiPublisherInventory(html + html, xml), /duplicate/);
  assert.throws(() => cuiPublisherInventory(html, 'Missing definitions'), /definitions missing/);
});
