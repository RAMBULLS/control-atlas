#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zip, ZipDeflate, Unzip, UnzipInflate } from 'fflate';
import { csvRow } from '../src/shared/csv.mjs';
import { connectionEvidenceIdsForEdge } from '../src/shared/data-trust-contracts.mjs';
import { csvRecords } from './lib/csv-records.mjs';
import { validateReferenceIdentity } from './lib/reference-export.mjs';
import { COLUMNS, CORE_CATALOGS, CONTEXT_CATALOGS, ordinal, digest, generatedRecords, compactNode, selectScope, relationshipType, citationRow, validateCompactTables, itemLabel, readableTerm, sourceRecoveryColumns } from './lib/compact-reference.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(ROOT, '.local-agent/reference-export/compact');
const archive = join(dirname(output), 'ControlAtlas_DoD_Reference.zip');
const receiptPath = join(dirname(output), 'compact-validation.json');
const verifyOnly = process.argv.includes('--verify');
for (let path = output; path !== ROOT; path = dirname(path)) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Output must not use links');
const inputs = new Map();
const read = (path) => { const bytes = readFileSync(join(ROOT, path)); inputs.set(path, { bytes: bytes.length, sha256: digest(bytes) }); return JSON.parse(bytes); };
const manifests = ['nodes', 'edges', 'sources', 'evidence'].map((name) => read(`data/generated/${name}.json`));
assert.equal(new Set(manifests.map((manifest) => manifest.generated_at)).size, 1, 'Mixed graph builds');
const sources = new Map();
for (const source of generatedRecords(ROOT, 'sources', inputs)) { assert.ok(!sources.has(source.id), 'Duplicate canonical source'); sources.set(source.id, source); }
const nodes = new Map(); const catalogInventory = new Map();
for (const node of generatedRecords(ROOT, 'nodes', inputs)) {
  assert.ok(!nodes.has(node.id), 'Duplicate canonical item');
  const projected = compactNode(node, sources); nodes.set(node.id, projected);
  if (projected.catalog) catalogInventory.set(projected.catalog, (catalogInventory.get(projected.catalog) || 0) + 1);
}
const allEdges = []; const edgeIds = new Set();
const fields = ['id', 'source_node_id', 'target_node_id', 'relationship_type', 'relationship_class', 'assertion_class', 'directionality', 'publication_status', 'status', 'authority_class', 'provenance_class', 'confidence', 'mapping_model', 'raw_relationship_type', 'inference_rule_id', 'rationale', 'warning', 'source_artifact_id', 'source_locator', 'source_refs', 'publisher_assertions'];
for (const edge of generatedRecords(ROOT, 'edges', inputs)) {
  assert.ok(!edgeIds.has(edge.id), 'Duplicate canonical connection'); edgeIds.add(edge.id);
  allEdges.push({ ...Object.fromEntries(fields.filter((field) => edge[field] !== undefined).map((field) => [field, edge[field]])), evidence_ids: connectionEvidenceIdsForEdge(edge) });
}
assert.deepEqual(validateReferenceIdentity([...nodes.values()], allEdges), [], 'Canonical identity or relationship semantics failed');
const scope = selectScope(nodes, allEdges);
const selectedNodes = [...scope.selected].sort(ordinal).map((id) => nodes.get(id));
const selectedEdges = scope.edges.sort((a, b) => ordinal(a.id, b.id));
const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
const tables = Object.fromEntries(Object.keys(COLUMNS).map((name) => [name, []]));
const groupRows = new Map(); const typeRows = new Map(); const sourceIds = new Set(); const citations = new Map(); const requiredEvidence = new Set(); const evidenceOwners = new Map();
const mappingCounts = new Map();
const citationLocations = new Map();
const addCitation = (row) => {
  const location = JSON.stringify(row.slice(0, 4));
  const related = citationLocations.get(location) || [];
  if (row[5]) {
    const existing = related.find((entry) => !entry[5]);
    if (existing) {
      citations.delete(JSON.stringify(existing));
      for (let index = 5; index < row.length; index += 1) existing[index] = row[index];
      citations.set(JSON.stringify(existing), existing); return;
    }
  }
  const key = JSON.stringify(row);
  if (!citations.has(key)) { citations.set(key, row); related.push(row); citationLocations.set(location, related); }
  if (row[2]) sourceIds.add(row[2]);
};
for (const edge of selectedEdges) {
  const from = nodes.get(edge.source_node_id); const to = nodes.get(edge.target_node_id); const type = relationshipType(edge);
  typeRows.set(type[0], type);
  tables.Connections.push([from.catalog, itemLabel(from), readableTerm(edge.relationship_type), to.catalog, itemLabel(to),
    readableTerm(edge.relationship_class), readableTerm(edge.publication_status), edge.rationale || '', edge.warning || '', edge.id, from.id, to.id, type[0], edge.source_locator || '']);
  if (edge.relationship_class === 'correlation') for (const id of new Set([from.id, to.id])) {
    const count = mappingCounts.get(id) || { published: 0, candidate: 0 }; if (edge.publication_status in count) count[edge.publication_status] += 1; mappingCounts.set(id, count);
  }
  for (const ref of edge.source_refs || []) addCitation(citationRow('connection', edge.id, ref));
  if (edge.source_artifact_id) sourceIds.add(edge.source_artifact_id);
  for (const evidenceId of edge.evidence_ids) { requiredEvidence.add(evidenceId); const owners = evidenceOwners.get(evidenceId) || []; owners.push(edge.id); evidenceOwners.set(evidenceId, owners); }
  for (const assertion of edge.publisher_assertions || []) {
    assert.ok(Object.keys(assertion).every((key) => ['mapping_id', 'relationship', 'property', 'locator'].includes(key)), 'Unrepresented publisher assertion field');
    tables.PublisherAssertions.push([edge.id, assertion.mapping_id || '', assertion.relationship || '', assertion.property || '', assertion.locator || '']);
  }
}
for (const item of selectedNodes) {
  const count = mappingCounts.get(item.id) || { published: 0, candidate: 0 };
  tables.Items.push([item.catalog, item.groupRow[2], item.nativeId, item.title, item.description, item.type, item.severity,
    item.lifecycle, count.published, count.candidate, item.id, item.groupId, item.sourceId, item.sourceLocation]);
  groupRows.set(item.groupId, [item.groupId, ...item.groupRow.slice(1)]);
  sourceIds.add(item.sourceId); if (item.publicationId) sourceIds.add(item.publicationId);
  for (const ref of item.refs) addCitation(citationRow('item', item.id, ref));
  for (const artifact of item.artifactIds) sourceIds.add(artifact);
  tables.ItemDetails.push(...item.details);
}
const foundEvidence = new Set(); const allEvidenceIds = new Set();
for (const entry of generatedRecords(ROOT, 'evidence', inputs)) {
  assert.ok(!allEvidenceIds.has(entry.id), 'Duplicate canonical evidence'); allEvidenceIds.add(entry.id);
  if (!requiredEvidence.has(entry.id)) continue;
  foundEvidence.add(entry.id);
  for (const owner of evidenceOwners.get(entry.id)) addCitation(citationRow('connection', owner, entry));
}
assert.equal(foundEvidence.size, requiredEvidence.size, 'Missing selected publication evidence');
// Resolve parent publications through existing source IDs only.
for (const id of sourceIds) {
  assert.ok(sources.has(id), `Unknown source ${id}`);
  const source = sources.get(id); if (source.publication_source_id) sourceIds.add(source.publication_source_id);
}
tables.Groups = [...groupRows.values()].sort((a, b) => ordinal(a[0], b[0]));
tables.RelationshipTypes = [...typeRows.values()].sort((a, b) => ordinal(a[0], b[0]));
tables.Sources = [...sourceIds].sort(ordinal).map((id) => { const s = sources.get(id); return [id, s.display_name || s.name || '', s.owner || '', s.version || '', s.lifecycle_status || '', s.artifact_url || '', s.catalog_browse_url || '', s.publication_source_id || '', s.entity_kind || '', s.authority_class || '', s.provenance_class || '', s.retrieved_at || '', s.sha256 || s.checksum || '', s.byte_length ?? '', s.license_or_use || '', ...sourceRecoveryColumns(s, sources)]; });
tables.Citations = [...citations.values()].sort((a, b) => ordinal(JSON.stringify(a), JSON.stringify(b)));
tables.PublisherAssertions.sort((a, b) => ordinal(JSON.stringify(a), JSON.stringify(b)));
tables.ItemDetails.sort((a, b) => ordinal(a[0], b[0]) || ordinal(a[1], b[1]) || a[2] - b[2]);
assert.deepEqual(validateCompactTables(tables), [], 'Compact table integrity failed');
assert.equal(tables.Items.length, scope.selected.size);
assert.equal(tables.Connections.length, selectedEdgeIds.size);
for (const [catalog, count] of catalogInventory) if (CORE_CATALOGS.has(catalog)) assert.equal(selectedNodes.filter((node) => node.catalog === catalog).length, count, `Omitted core item in ${catalog}`);
const coverage = read('data/source-coverage-manifest.json');
const sourceInventory = read('data/generated/catalog-source-inventory.json');
const reconciliation = read('data/generated/reference-reconciliation.json');
assert.equal(reconciliation.status, 'PASSED', 'Source relationship reconciliation must pass before export');
assert.equal(reconciliation.counts.errors, 0);
assert.ok(Object.keys(reconciliation.graph_inputs || {}).length >= 2, 'Missing source-reconciliation graph input identity');
for (const [path, identity] of Object.entries(reconciliation.graph_inputs)) assert.deepEqual(inputs.get(path), identity, `Stale source-reconciliation input: ${path}`);
const commons = read('data/commons-resource-dataset.json');
const fingerprint = digest(JSON.stringify([...inputs].sort(([a], [b]) => ordinal(a, b))));
const names = [...Object.keys(COLUMNS).map((name) => `ControlAtlas_${name}.csv`), 'README.md'];
const csvBytes = (name) => Buffer.from(`\uFEFF${csvRow(COLUMNS[name])}${tables[name].map(csvRow).join('')}`, 'utf8');
const files = Object.keys(COLUMNS).map((table) => { const bytes = csvBytes(table); return { name: `ControlAtlas_${table}.csv`, rows: tables[table].length, bytes: bytes.length, sha256: digest(bytes) }; });
console.log(JSON.stringify({ planned_files: files.map(({ name, rows, bytes }) => ({ name, rows, bytes })), planned_csv_bytes: files.reduce((sum, file) => sum + file.bytes, 0) }));
assert.ok(files.reduce((sum, file) => sum + file.bytes, 0) < 192 * 1024 * 1024, 'Compact CSV output exceeds the 192 MiB bound');
if (process.argv.includes('--plan')) process.exit(0);

function readme() {
  const inventory = [...catalogInventory].sort(([a], [b]) => ordinal(a, b)).map(([catalog, total]) => {
    const kept = selectedNodes.filter((node) => node.catalog === catalog).length;
    const proof = coverage.catalogs.find((entry) => entry.catalog_id === catalog)?.completeness_status || 'UNKNOWN';
    return `| ${catalog} | ${total} | ${kept} | ${total - kept} | ${CORE_CATALOGS.has(catalog) ? 'Core: every item' : CONTEXT_CATALOGS.has(catalog) ? 'Direct recorded control relationship and native parents' : 'Outside requested scope'} | ${proof} |`;
  }).join('\n');
  const vocabulary = new Map(); for (const edge of selectedEdges) { const key = `${edge.relationship_class} / ${edge.relationship_type} / ${edge.publication_status}`; vocabulary.set(key, (vocabulary.get(key) || 0) + 1); }
  return `# Control Atlas: DoD security reference\n\n` +
    `Start with ControlAtlas_Items.csv and ControlAtlas_Connections.csv. These contain ordinary readable columns, with no JSON cells. The remaining CSVs hold shared groups, relationship meanings, sources, citations and publisher notes. Extract the ZIP before opening files. No Google Drive access is needed.\n\n` +
    `This is a compact reference projection, not a declaration that every standard or control applies to every DoD system. Applicability depends on the system and governing authority. No assessments, organization data, operational evidence, new mappings or expanded multi-hop relationships are included.\n\n` +
    `## Snapshot and size\n\nCanonical graph build: ${manifests[0].generated_at}. Source commit: ${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()}. Local source repairs are uncommitted; commit alone does not identify these bytes. Export profile: compact-dod-1. Input fingerprint: ${fingerprint}.\n\n` +
    `Included: ${tables.Items.length} existing Atlas items, ${tables.Connections.length} existing connections, ${tables.Groups.length} shared groups and ${tables.Sources.length} sources. ${selectedNodes.filter((node) => !mappingCounts.get(node.id)?.published).length} included items have no published correlation; native hierarchy does not make an item mapped. Multiple citations never duplicate a connection. No catalog editions or distinct Atlas IDs are merged.\n\n` +
    `| File | Rows | Bytes | SHA-256 |\n| --- | ---: | ---: | --- |\n${files.map((file) => `| ${file.name} | ${file.rows} | ${file.bytes} | ${file.sha256} |`).join('\n')}\n\n` +
    `## Excel\n\n1. Extract the ZIP. Open Items for the control list; Connections is the relationship list. Catalog, Group, Control ID, Title and Description are the first item columns. Use Filter and Wrap Text if useful. Lookup IDs appear after the readable columns.\n2. CSV stores values, not column widths, filters or data types. For identifiers and editions, use Data > From Text/CSV, UTF-8 and comma delimiter, then Transform Data. Remove automatic Changed Type and set identifier/edition columns to Text. This preserves leading zeros and avoids Excel treating an identifier as a date. No spreadsheet formulas or apostrophe prefixes are added to source values.\n3. Files have a UTF-8 BOM for Excel, quoted fields and CRLF record endings. Commas, quotes, multiline text and Unicode remain literal. Blank means unavailable/not applicable in this compact view. Original null versus absent distinctions are not represented. All cells are within Excel's 32,767-character limit; long supplementary text is split into numbered parts without losing characters.\n\n` +
    `## Power BI and graph tools\n\nImport each CSV with UTF-8/comma and set keys to Text. Join Items[Group ID] to Groups[Group ID], Items[Source ID] to Sources[Source ID], and Connections[Relationship type ID] to RelationshipTypes[Relationship type ID] (many-to-one). Create separate Source Items and Target Items references to Items for the two endpoint joins. Keep both native endpoint directions. Citations[Owner kind] distinguishes item from connection citations; filter before joining Owner Atlas ID. PublisherAssertions joins to Atlas connection ID; ItemDetails joins to Atlas item ID. Citations and assertions are child rows, not extra connections.\n\nFor graph tools use Atlas item ID as node key and Atlas connection ID as edge key. From/To Atlas item IDs are native endpoints. Lookup group/type IDs are deterministic export dimension keys, not new Atlas nodes or connections.\n\n` +
    `## Tables and column meanings\n\n` +
    `- Items: one row per selected existing graph item. Catalog is the canonical catalog key; Group is the publisher family/benchmark grouping; Control ID is the native publisher identifier; Title/Description are captured primary source text; Record type and Lifecycle retain stored vocabulary. Severity is populated only where recorded. Published/Candidate mappings count incident correlation connections of that exact publication status, not containment or baseline selection. Group ID resolves benchmark/publication editions in Groups. Source location is the recorded page/sheet/row/section locator.\n` +
    `- Connections: one row per selected existing connection. From/To item show a native ID and captured title, or just the title for long generated keys; exact native IDs remain in Items and Atlas endpoint IDs are the join keys. Relationship, Class and Publication status use readable capitalization and spaces; exact stored terms remain in RelationshipTypes. Rationale and Warning preserve recorded values. Relationship type ID resolves all shared semantic attributes.\n` +
    `- Groups: one row per distinct catalog, native family, benchmark identity/edition and defining source combination. Benchmark edition and Publication edition are separate. No edition is inferred from a title. Publisher is the recorded source owner. Publication ID and Source ID retain their native identities. Artifact IDs is a semicolon-separated list of the existing shared item artifact IDs.\n` +
    `- RelationshipTypes: unique combinations of predicate, topology Class, Assertion class, Direction, Publication status, Lifecycle, Authority, Provenance, Confidence, Mapping model, Publisher relationship, Inference rule and Source artifact ID. Grouping this metadata does not combine connections. Directed means the stored From -> To order. A published assertion can cite a historical or draft source; check Sources.\n` +
    `- Sources: the existing source registry entries used by the selected items, citations and parent publications. Name, Publisher, Edition, Lifecycle, URLs, Publication ID, Record kind, Authority, Provenance, retrieval date, actual recorded checksum/length and use terms are shared once. Source access status, Prior official URL, Archive URL and Source access note expose verified relocations and archival limits. A broken URL never silently changes Lifecycle. Unavailable byte evidence remains blank. A recorded checksum alone is not a fresh-download verification.\n` +
    `- Citations: one row per distinct retained owner/source/locator/reference/evidence tuple. Owner kind is item or connection. Evidence ID identifies existing publication evidence, not operational evidence. Source edition, SHA-256, Publisher file URL, Native rule ID and Benchmark ID identify the exact native assertion where recorded. Repeated exact duplicate tuples are removed. A matching source reference and evidence record for the same owner/source/location share one row with both the original reference type and evidence metadata; distinct evidence IDs remain separate. Shared item artifact membership is in Groups and shared assertion artifact identity is in RelationshipTypes rather than repeated citation rows.\n` +
    `- PublisherAssertions: all retained publisher clauses for included connections, with original Publisher assertion ID, relationship text, qualifier and source location. Compound clauses remain separate child rows. No extra edge is created.\n` +
    `- ItemDetails: plain field/value rows for native Zero Trust outcomes, end states, responsibilities, sequencing notes, activity types, durations, mobile-threat countermeasures, unresolved source assertions and warnings where captured. DISA current snapshot presence is explicit; false means previously recorded but absent from the selected October snapshot, not retired. Previous DISA benchmark/edition/rule identities and source locations are child rows; full prior descriptions/procedures remain in canonical previous_editions and verified historical source archives. Array positions are written in field labels; nested publisher notes are expanded into named scalar fields. Part orders long text fragments. These are supporting references, not additional graph relationships.\n\n` +
    `## Relationship vocabulary\n\nStructural = publisher containment. Applicability = baseline/selection/overlay relationships. Correlation = recorded mappings, crosswalks, implementation/assessment/reference relations. Organizing = authority/editorial navigation; inspect Assertion class, Authority and Publication status. Candidate and editorial relationships remain candidate and editorial. None is promoted to a published mapping. No equivalence is inferred.\n\n| Class / predicate / status | Connections |\n| --- | ---: |\n${[...vocabulary].sort(([a], [b]) => ordinal(a, b)).map(([key, count]) => `| ${key} | ${count} |`).join('\n')}\n\n` +
    `## Scope and exclusions\n\nAll items in the core security-control, RMF, CSF, CCI, STIG/SRG, CUI/CMMC and Zero Trust catalogs are retained, including unmapped items. Supporting software/IoT references are included as core source context. ATT&CK, D3FEND, FedRAMP baseline and mobile-threat items are included only if they have a directly recorded correlation/applicability relationship to a core item, plus their native grouping parents. This selection does not invent a direct relationship for a path. The table includes every registered graph catalog; counts include generated native group/catalog nodes as well as normalized source records.\n\n| Catalog | Available graph items | Included | Excluded | Selection | Publisher proof |\n| --- | ---: | ---: | ---: | --- | --- |\n${inventory}\n\n` +
    `${nodes.size - [...catalogInventory.values()].reduce((sum, count) => sum + count, 0)} authority/editorial graph items outside those catalogs are outside this projection. All ${commons.resources.length} Resources in ${commons.collections.length} collections are outside it: they are general supporting resources without canonical control-connection IDs, not missing control mappings. The original lossless export remains the archival source for that material.\n\n` +
    `This smaller package intentionally omits raw canonical-record JSON, duplicated full source objects, raw parser fragments, media/binaries, STIG check/fix procedures, assessment-objective internals, discussion prose and other nested archival fields. Primary captured descriptions and selected native outcome/qualifier/warning fields remain readable. It is not a lossless replacement for the canonical repository or the full archival export. These omitted structures cannot be squeezed into a simple control list without either extra semantic tables or losing meaning. No control records are deduplicated merely because their prose matches.\n\n` +
    `No CVE rows are included: Atlas currently has no canonical CVE nodes or CVE-to-control mappings. Publisher CVE/exploit examples are excluded at the user's request. No path through a threat is presented as a direct CVE mapping.\n\n` +
    `## Publisher inventory scope and access limits\n\nThe coverage manifest reports ${coverage.completeness_status} for the explicitly declared retained catalog scopes: ${coverage.catalogs.filter((entry) => entry.completeness_status !== 'reconciled').length} scopes remain unreconciled. This establishes source identity coverage for those scopes and editions, not ingestion of every paragraph, linked tool, publisher document or latest release. Snapshot counts and hierarchy coverage alone do not establish mapping coverage.\n\n| Catalog | Normalized source records | Independent inventory scope |\n| --- | ---: | --- |\n${Object.entries(sourceInventory.catalogs).sort(([a], [b]) => ordinal(a, b)).map(([id, entry]) => `| ${id} | ${entry.normalized_records} | ${String(entry.inventory_scope || entry.source_selection || entry.evidence_reason || 'See source bundle expectation').replaceAll('|', '\\|')} |`).join('\n')}\n\n` +
    `DISA October 2026 public-manual packages were freshly retrieved and independently compared, including native CCI assertions and citations. Prior verified July records/assertions remain with stable Atlas IDs and explicit historical warnings. No absent ID is automatically labeled retired and no mapping is inferred. SP 800-53B membership and byte evidence now match all four acquired profiles; the publisher HIGH profile itself retains a 5.1.1 title alongside metadata.version 5.2.0, exposed with a warning. IoT identity completeness covers the two retained publisher mapping workbooks; primary-catalog extraction remains not_performed. This does not establish ingestion of every primary webpage or the latest primary-catalog edition.\n\n` +
    `Six Zero Trust shorthand source notes refer back to earlier explicit assertions; one IoT draft target PT.PT-1 is absent from the official CSF 1.1 inventory. Their native notes and terminal dispositions remain; no guessed predicate or corrected endpoint is created. NARA Privileged Safety Information identity is recorded from the official marking list while its detail prose is unavailable. Seven DoD PDFs were freshly recovered from observed links in the current official CIO library at dowcio.war.gov and exactly match retained byte checksums/lengths. The overlays PDF returns browser 404 at its old and migrated URLs. A public Red Hat archive independently corroborates all 383 retained page texts exactly; its PDF is 6 bytes longer and has a distinct checksum. Original official byte evidence remains separate. Publisher-confirmed replacement/withdrawal/currentness of that document remains UNKNOWN. A 404 alone never retires a source. These access/lifecycle limits remain separate from inventory reconciliation.\n\n` +
    `## Reproduce and verify\n\nRun npm run export:reference:compact against the existing complete generated graph, then npm run verify:reference-export:compact. The command reads every declared canonical shard, checks IDs/endpoints/source references and exact semantic values, independently reparses all CSV fields, and verifies ZIP entry hashes and row counts. npm run test:reference-compact runs focused regression tests. Export does not fetch sources, ingest data or generate mappings. CSV bytes and ZIP bytes are deterministic for identical input bytes and commit.\n\n` +
    `| Canonical input | Bytes | SHA-256 |\n| --- | ---: | --- |\n${[...inputs].sort(([a], [b]) => ordinal(a, b)).map(([path, value]) => `| ${path} | ${value.bytes} | ${value.sha256} |`).join('\n')}\n`;
}

if (!verifyOnly) {
  mkdirSync(output, { recursive: true });
  for (const name of Object.keys(COLUMNS)) writeFileSync(join(output, `ControlAtlas_${name}.csv`), csvBytes(name));
  writeFileSync(join(output, 'README.md'), readme(), 'utf8');
  assert.deepEqual(readdirSync(output).sort(ordinal), [...names].sort(ordinal), 'Unexpected package files');
  const fd = openSync(`${archive}.partial`, 'w'); let final = false;
  const zip = new Zip((error, bytes, done) => { if (error) throw error; writeSync(fd, bytes); final ||= done; });
  try {
    for (const name of names) { const entry = new ZipDeflate(name, { level: 9 }); entry.mtime = new Date('2000-01-01T00:00:00Z'); zip.add(entry); for await (const bytes of createReadStream(join(output, name))) entry.push(bytes, false); entry.push(new Uint8Array(), true); }
    zip.end(); assert.ok(final, 'ZIP did not finish');
  } finally { closeSync(fd); }
  renameSync(`${archive}.partial`, archive);
}
for (const name of Object.keys(COLUMNS)) {
  let index = -1;
  for await (const row of csvRecords(join(output, `ControlAtlas_${name}.csv`))) {
    assert.deepEqual(row, (index < 0 ? COLUMNS[name] : tables[name][index])?.map((value) => String(value ?? '')), `${name} CSV round trip, row ${index + 1}`); index += 1;
  }
  assert.equal(index, tables[name].length, `${name} row count`);
  assert.equal(digest(readFileSync(join(output, `ControlAtlas_${name}.csv`))), files.find((file) => file.name === `ControlAtlas_${name}.csv`).sha256, `${name} exact bytes`);
}
assert.equal(readFileSync(join(output, 'README.md'), 'utf8'), readme(), 'README input identity changed');
const extracted = new Map();
const unzip = new Unzip((entry) => {
  assert.ok(names.includes(entry.name) && !extracted.has(entry.name), 'Unexpected/duplicate ZIP entry'); extracted.set(entry.name, []);
  const hashParts = [];
  entry.ondata = (error, bytes, done) => { if (error) throw error; hashParts.push(Buffer.from(bytes)); if (done) { const actual = digest(Buffer.concat(hashParts)); assert.equal(actual, digest(readFileSync(join(output, entry.name))), `ZIP content ${entry.name}`); extracted.set(entry.name, actual); } };
  entry.start();
});
unzip.register(UnzipInflate); for await (const bytes of createReadStream(archive)) unzip.push(bytes, false); unzip.push(new Uint8Array(), true);
assert.deepEqual([...extracted.keys()].sort(ordinal), [...names].sort(ordinal)); assert.ok([...extracted.values()].every((entry) => typeof entry === 'string'));
assert.ok(statSync(archive).size < 18 * 1024 * 1024, 'ZIP exceeds conservative attachment size');
const receipt = { status: 'PASSED', profile: 'compact-dod-1', source_build: manifests[0].generated_at, input_fingerprint: fingerprint,
  items: tables.Items.length, connections: tables.Connections.length, catalogs: new Set(selectedNodes.map((node) => node.catalog)).size,
  unmapped_core_items: selectedNodes.filter((node) => scope.coreIds.has(node.id) && !mappingCounts.get(node.id)?.published).length,
  files, zip: { path: archive, bytes: statSync(archive).size, sha256: digest(readFileSync(archive)) },
  checks: ['complete canonical shards and counts', 'canonical unique IDs and endpoints', 'no candidate/editorial promotion', 'all core items including unmapped', 'one row per native connection ID', 'exact native semantic grouping and edition grouping', 'citation and supporting-source integrity', 'all CSV cells within Excel limit', 'independent every-field CSV round trip', 'exact ZIP file inventory and content hashes'],
  publisher_completeness: coverage.completeness_status, release_gates: 'NOT RUN; local projection only, not ship-ready publication' };
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`); console.log(JSON.stringify(receipt, null, 2));
