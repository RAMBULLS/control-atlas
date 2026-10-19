#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zip, ZipDeflate, Unzip, UnzipInflate } from 'fflate';
import { CATALOGS, MAPS } from './build-framework-data.mjs';
import { readGeneratedCollection } from './lib/generated-graph-artifacts.mjs';
import { reconcileReferenceRelationships } from './lib/reference-reconciliation.mjs';
import { ITEM_COLUMNS, CONNECTION_COLUMNS, csvRow, referenceItemRow, referenceConnectionRow, validateReferenceIdentity } from './lib/reference-export.mjs';
import { csvRecords } from './lib/csv-records.mjs';
import { validateGraphArtifacts } from '../tools/validators/federal-graph.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(ROOT, process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length) || '.local-agent/reference-export/package');
if (!output.startsWith(`${join(ROOT, '.local-agent')}/`) && !output.startsWith(`${join(ROOT, '.local-agent')}\\`)) throw new Error('Export output must remain inside the repository .local-agent directory');
let ancestor = output;
while (ancestor !== ROOT) {
  if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error('Export output must not use links');
  ancestor = dirname(ancestor);
}
const verifyOnly = process.argv.includes('--verify');
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const names = ['ControlAtlas_Items.csv', 'ControlAtlas_Connections.csv', 'README.md'];
const archivePath = join(dirname(output), 'ControlAtlas_Reference.zip');
const receiptPath = join(dirname(output), 'validation.json');
const inputs = new Set(['data/source-registry.json', 'data/commons-resource-dataset.json', 'data/source-coverage-manifest.json', 'data/source-review-manifest.json', 'data/profiles/profile-registry.json', 'data/profiles/source-adapter-registry.json', 'data/generated/build-manifest.json', 'data/generated/source-count-ledger.json']);
const graph = {};
for (const name of ['nodes', 'edges', 'evidence', 'sources']) {
  const artifact = readGeneratedCollection(ROOT, name);
  if (!artifact || !Array.isArray(artifact[name])) throw new Error(`Missing canonical ${name}; run build:data`);
  if (artifact.sharded_collection && artifact[name].length !== artifact.sharded_collection.record_count) throw new Error(`Incomplete ${name} shard inventory`);
  graph[name] = artifact[name];
  inputs.add(`data/generated/${name}.json`);
  for (const shard of artifact.sharded_collection?.shards || []) inputs.add(`data/generated/${shard.path}`);
}
const commons = read('data/commons-resource-dataset.json');
const coverage = read('data/source-coverage-manifest.json');
const sourceCounts = read('data/generated/source-count-ledger.json');
const context = { sourceById: new Map(graph.sources.map((source) => [source.id, source])), evidenceById: new Map(graph.evidence.map((entry) => [entry.id, entry])),
  parents: new Map(), originalById: new Map(), collections: commons.collections, resourceEvidence: commons.evidenceCatalog };
for (const edge of graph.edges) if (edge.relationship_class === 'structural') {
  const parents = context.parents.get(edge.target_node_id) || []; parents.push(edge.source_node_id); context.parents.set(edge.target_node_id, parents);
}
for (const [file, catalog] of CATALOGS) {
  inputs.add(`data/${file}`);
  for (const record of read(`data/${file}`).records) context.originalById.set(`${catalog}:${record.id}`, record);
}
for (const [file] of MAPS) if (existsSync(join(ROOT, 'maps', file))) inputs.add(`maps/${file}`);
inputs.add('data/curated/nist-zt/mappings.json');
inputs.add('data/curated/nist-structured-catalogs/iot-requirements.json');
inputs.add('data/curated/reference-catalogs/source-manifest.json');
for (const file of readdirSync(join(ROOT, 'maps/olir')).filter((file) => file.endsWith('.json'))) inputs.add(`maps/olir/${file}`);
const inputHashes = [];
for (const path of [...inputs].sort(ordinal)) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(join(ROOT, path))) digest.update(bytes);
  inputHashes.push({ path, sha256: digest.digest('hex'), bytes: statSync(join(ROOT, path)).size });
}
const inputIdentity = hash(JSON.stringify(inputHashes));
const identityErrors = validateReferenceIdentity(graph.nodes, graph.edges, commons.resources);
if (identityErrors.length) throw new Error(identityErrors.slice(0, 20).join('\n'));
const reconciliation = reconcileReferenceRelationships(ROOT, graph, { catalogs: CATALOGS, maps: MAPS });
if (reconciliation.errors.length) throw new Error(`Reference reconciliation failed:\n${reconciliation.errors.slice(0, 20).join('\n')}`);
const items = [...graph.nodes.map((item) => ({ item, kind: 'graph_node' })), ...commons.resources.map((item) => ({ item, kind: 'resource' }))].sort((a, b) => ordinal(a.item.id, b.item.id));
const edges = [...graph.edges].sort((a, b) => ordinal(a.id, b.id));
const connected = new Set(edges.filter((edge) => edge.relationship_class === 'correlation').flatMap((edge) => [edge.source_node_id, edge.target_node_id]));
const counts = { items: items.length, graph_nodes: graph.nodes.length, resources: commons.resources.length, connections: edges.length,
  catalog_items_without_correlation: graph.nodes.filter((item) => item.metadata?.catalog_id && !connected.has(item.id)).length,
  source_registry_entries: graph.sources.length, resource_collections: commons.collections.length,
  unresolved_reference_assertions: reconciliation.counts.unresolved_source_rows };

function writeCsv(name, columns, values) {
  const temporary = join(output, `${name}.partial`); const fd = openSync(temporary, 'w');
  const digest = createHash('sha256'); let bytes = 0; let rows = 0;
  const write = (row) => { const value = Buffer.from(csvRow(row)); bytes += value.length; if (bytes > 1536 * 1024 * 1024) throw new Error(`${name} exceeds the 1.5 GiB file bound`); writeSync(fd, value); digest.update(value); };
  try { write(columns.map(([header]) => header)); for (const row of values) { write(row); rows += 1; } }
  finally { closeSync(fd); }
  renameSync(temporary, join(output, name));
  return { name, rows, bytes, sha256: digest.digest('hex') };
}
function* itemRows() { for (const { item, kind } of items) yield referenceItemRow(item, context, kind); }
function* connectionRows() { for (const edge of edges) yield referenceConnectionRow(edge, context); }
const escapeTable = (value) => String(value ?? 'UNKNOWN').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
function readme(files) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal', '--', 'data', 'maps', 'scripts', 'src', 'tools', 'package.json', 'package-lock.json'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const sourceState = dirty ? 'Source inputs include uncommitted changes; the commit alone does not identify these bytes. Use the input hashes below.' : 'Source inputs are committed. The input hashes below identify the exported build bytes.';
  const catalogTable = coverage.catalogs.map((row) => `| ${row.catalog_id} | ${row.imported_records} | ${row.completeness_status} | ${row.inventory_evidence_class || 'unknown'} |`).join('\n');
  const typeCounts = new Map();
  for (const edge of edges) { const key = `${edge.relationship_class} / ${edge.relationship_type} / ${edge.publication_status}`; typeCounts.set(key, (typeCounts.get(key) || 0) + 1); }
  return `# Control Atlas portable reference export\n\n` +
    `This package contains public reference material and recorded relationships. It contains no organization assessments, operational evidence, findings, system inventories or compliance decisions. Publication-provenance citations are reference evidence.\n\n` +
    `## Source build and files\n\nSource commit: ${commit}. ${sourceState}\n\n` +
    `Canonical source build timestamp: ${read('data/generated/nodes.json').generated_at}. Export contract: 1.0.\n\nInput SHA-256 fingerprint: ${inputIdentity}. No network access or UI scraping occurs during export.\n\n` +
    `| File | Data rows | Bytes | SHA-256 |\n| --- | ---: | ---: | --- |\n${files.map((file) => `| ${file.name} | ${file.rows} | ${file.bytes} | ${file.sha256} |`).join('\n')}\n\n` +
    `Items: ${counts.graph_nodes} graph nodes plus ${counts.resources} Resources. Connections: ${counts.connections}. ${counts.catalog_items_without_correlation} catalog items have no correlation edge and are still included; hierarchy and editorial navigation do not make an item mapped.\n\n` +
    `## Power BI import\n\n1. Extract the ZIP. In Power BI Desktop choose Get data > Text/CSV for each CSV, select UTF-8 and comma delimiter, then Transform Data.\n2. Disable automatic type detection or remove the automatically added Changed Type step. Set identifiers, edition, text, lifecycle and relationship columns to Text. CSV has no type declarations; quotes alone do not preserve types in every importer.\n3. Keep Items as the complete item table. Create Source Items and Target Items as references to it. Join Source Items[AtlasItemId] to Connections[SourceAtlasItemId] and Target Items[AtlasItemId] to Connections[TargetAtlasItemId], each one-to-many with single-direction filtering. Separate role tables avoid ambiguous active paths.\n4. Use RelationshipClass, PublicationStatus and source lifecycle to select the relationships appropriate to the report. Candidate, editorial and published source claims remain separate. A published relationship may cite a draft or historical publication; inspect SourcesJson.\n5. JSON columns are literal JSON text. Use Json.Document in Power Query when expanding them, or leave them as Text. Expanding citations creates analysis rows, not additional Atlas connections. Do not discard unmatched Items.\n\nFor graph tools, use AtlasItemId as the node key and native source/target item IDs as edge endpoints. AtlasConnectionId is the edge key. No multi-hop paths are converted into direct relationships.\n\n` +
    `## Columns\n\n### ControlAtlas_Items.csv\n\n| Column | Meaning |\n| --- | --- |\n${ITEM_COLUMNS.map(([header, meaning]) => `| ${header} | ${meaning} |`).join('\n')}\n\n### ControlAtlas_Connections.csv\n\n| Column | Meaning |\n| --- | --- |\n${CONNECTION_COLUMNS.map(([header, meaning]) => `| ${header} | ${meaning} |`).join('\n')}\n\n` +
    `All fields are quoted; embedded quotes are doubled. Records use CRLF and UTF-8 without a BOM. Embedded source line breaks, Unicode, leading zeros and formula-like text are retained literally. Import as Text. Blank scalar fields mean unavailable or not applicable; CanonicalRecordJson preserves the original distinction between null and an absent field. JSON arrays retain native order. Rows sort by the exact Atlas ID using ordinal comparison.\n\n` +
    `## Relationship vocabulary\n\nStructural means publisher-native containment. Applicability means selections, baselines or overlays. Correlation means recorded mappings, crosswalks, assessments, implementations or references. Organizing includes both published authority links (such as issued_under) and Atlas editorial navigation. Use AssertionClass, AuthorityClass, ProvenanceClass and PublicationStatus to distinguish them; the topology class alone does not establish publication status or mapping coverage. Predicates are the stored vocabulary, not inferred equivalence.\n\n| Class / predicate / publication status | Connections |\n| --- | ---: |\n${[...typeCounts].sort(([a], [b]) => ordinal(a, b)).map(([key, count]) => `| ${key} | ${count} |`).join('\n')}\n\n` +
    `## Catalog and Resource inventory\n\nPackage reconciliation covers all current canonical items and connections; it does not establish complete coverage of every upstream publication. The source inventory result is ${coverage.completeness_status}. Reviewed snapshot counts remain regression checks and are not independent publisher-completeness proof.\n\n| Catalog | Normalized records | Publisher completeness | Evidence class |\n| --- | ---: | --- | --- |\n${catalogTable}\n\n` +
    `### Publisher assertions and artifact accounting\n\nSource rows, normalized assertions, citations and unique connection IDs are different quantities. Compound rows can contain multiple predicates, and multiple cited assertions can support one connection. The source reconciliation checks ${reconciliation.counts.asserted_relationship_rows} input relationship rows across normalized and retained source views; those overlapping views must not be summed as distinct publisher claims. Every checked row is represented; ${counts.unresolved_reference_assertions} source assertions have explicit unresolved dispositions.\n\n| Zero Trust workbook category | Source rows | Represented source rows | Unresolved rows |\n| --- | ---: | ---: | ---: |\n${Object.entries(reconciliation.zero_trust_workbooks).map(([kind, value]) => `| ${kind} | ${value.source_rows} | ${value.represented_rows} | ${value.unresolved_rows} |`).join('\n')}\n\nIoT workbooks retain ${reconciliation.iot_workbooks.source_assertions} assertions: ${reconciliation.iot_workbooks.represented_assertions} represented and ${reconciliation.iot_workbooks.unresolved_assertions} unresolved.\n\nAll ${sourceCounts.artifacts.length} registered acquisition artifacts are inventoried below; ${sourceCounts.artifacts.filter((entry) => entry.counts.published_source_relationships > 0).length} declare publisher relationships. Runtime citation counts measure connections citing the artifact, so adding them across artifacts would double-count shared connections. Zero means the existing source ledger records no rows of that kind, not that the publisher has no such content.\n\n| Artifact | Role | Parsed source records | Publisher relationship rows | Runtime node citations | Runtime connection citations |\n| --- | --- | ---: | ---: | ---: | ---: |\n${sourceCounts.artifacts.map((entry) => `| ${entry.artifact_id} | ${entry.source_role} | ${entry.counts.parsed_source_records} | ${entry.counts.published_source_relationships} | ${entry.counts.runtime_node_citations} | ${entry.counts.runtime_edge_citations} |`).join('\n')}\n\n` +
    `${commons.collections.length} Resource collections and ${commons.evidenceCatalog.length} Resource publication-evidence entries support ${commons.resources.length} Resources. Collection membership, external links, lifecycle replacements and child-resource references have no canonical graph connection IDs; they remain in Resource JSON and are not promoted into graph edges. Complete collection definitions follow:\n\n\`\`\`json\n${JSON.stringify(commons.collections, null, 2)}\n\`\`\`\n\n` +
    `## Source registry\n\nAll ${graph.sources.length} source entries, including metadata-only and graph-ineligible sources, are inventoried below. Sources used by an item or connection are included in full in its SourcesJson. Defining publications, parser artifacts and relationship sources remain distinct.\n\n| Source ID | Name | Edition | Lifecycle | Graph eligible | Official URL |\n| --- | --- | --- | --- | --- | --- |\n${graph.sources.map((source) => `| ${[source.id, source.display_name || source.name, source.version, source.lifecycle_status, source.graph_eligible, source.artifact_url || source.catalog_browse_url].map(escapeTable).join(' | ')} |`).join('\n')}\n\n` +
    `## Known limitations and retained source content\n\n- Six NIST Zero Trust shorthand source rows are terminal redundant references to earlier explicit assertions. Their original text, cited prior assertion IDs and disposition remain supporting source content; no new predicate or connection is invented.\n- One NIST IoT draft-workbook assertion cites PT.PT-1, which is absent from the complete official CSF 1.1 Core. Its original cell, locator and source-linked rejected-identifier disposition are retained in the item JSON. No guessed correction or connection was created.\n- CSF 1.1 and CSF 2.0 remain separate editions. CSF 1.1 is superseded. Critical-software measures without Zero Trust mappings remain Items.\n- Resource collections, informative-reference prose, code/configuration blocks, tables, images, media locators and compound publisher clauses cannot become ordinary scalar CSV fields without losing meaning. Structured text, offsets and locators are retained in JSON; external media/binary files are not embedded.\n- Supporting OLIR retrieval snapshots are not a second canonical graph. Their inventory below identifies retained source content with no independent Atlas connection IDs. Raw retrieval snapshots are not exported as invented items or edges. Their complete original binary/download artifacts remain upstream; this package exports the canonical captured reference model.\n- Publisher completeness remains UNKNOWN wherever an independent inventory is unavailable. A successful package check proves faithful export and the stated relationship reconciliation, not universal source completeness.\n\n| Supporting snapshot | Retained relationship rows | Disposition |\n| --- | ---: | --- |\n${reconciliation.supporting_snapshots.map((entry) => `| ${entry.path} | ${entry.retained_rows ?? 'UNKNOWN'} | ${entry.disposition} |`).join('\n')}\n\n` +
    `## Reproduction and validation\n\nRun npm run export:reference against an existing complete generated graph, then npm run verify:reference-export. Run npm run verify:reference-relationships for source-row accounting. Export does not refresh sources or generate mappings. Actual executed results are delivered alongside the ZIP; validation checks input identity, counts, IDs, endpoints, all CSV fields and ZIP entry hashes.\n\nInput files and actual hashes:\n\n| Input | Bytes | SHA-256 |\n| --- | ---: | --- |\n${inputHashes.map((file) => `| ${file.path} | ${file.bytes} | ${file.sha256} |`).join('\n')}\n`;
}

async function pack() {
  const fd = openSync(`${archivePath}.partial`, 'w'); let finished = false;
  const zip = new Zip((error, bytes, final) => { if (error) throw error; writeSync(fd, bytes); if (final) finished = true; });
  try {
    for (const name of names) {
      const entry = new ZipDeflate(name, { level: 6 }); entry.mtime = new Date('2000-01-01T00:00:00.000Z'); zip.add(entry);
      for await (const bytes of createReadStream(join(output, name), { highWaterMark: 256 * 1024 })) entry.push(bytes, false);
      entry.push(new Uint8Array(), true);
    }
    zip.end(); if (!finished) throw new Error('ZIP stream did not finish');
  } finally { closeSync(fd); }
  renameSync(`${archivePath}.partial`, archivePath);
}
async function verifyCsv(name, columns, expectedRows) {
  let index = -1; const digest = createHash('sha256'); const iterator = expectedRows[Symbol.iterator]();
  for await (const row of csvRecords(join(output, name))) {
    if (index === -1) assert.deepEqual(row, columns.map(([header]) => header), `${name} column order`);
    else {
      const next = iterator.next(); assert.equal(next.done, false, `${name} contains an extra row`);
      assert.deepEqual(row, next.value.map((value) => String(value ?? '')), `${name} row ${index + 1} round trip`);
      digest.update(csvRow(row));
    }
    index += 1;
  }
  assert.equal(iterator.next().done, true, `${name} omitted a row`);
  return { rows: index, literal_rows_sha256: digest.digest('hex') };
}
async function verifyZip() {
  const extracted = new Map();
  const unzip = new Unzip((file) => {
    assert.ok(names.includes(file.name), `Unexpected ZIP entry ${file.name}`); assert.ok(!extracted.has(file.name), 'Duplicate ZIP entry');
    const digest = createHash('sha256'); extracted.set(file.name, null);
    file.ondata = (error, bytes, final) => { if (error) throw error; digest.update(bytes); if (final) extracted.set(file.name, digest.digest('hex')); };
    file.start();
  });
  unzip.register(UnzipInflate);
  for await (const bytes of createReadStream(archivePath)) unzip.push(bytes, false);
  unzip.push(new Uint8Array(), true);
  assert.equal(extracted.size, 3, 'ZIP must contain exactly three files');
  for (const name of names) {
    const digest = createHash('sha256'); for await (const bytes of createReadStream(join(output, name))) digest.update(bytes);
    assert.equal(extracted.get(name), digest.digest('hex'), `${name} ZIP content differs`);
  }
}

let files;
if (!verifyOnly) {
  const graphErrors = validateGraphArtifacts(graph); if (graphErrors.length) throw new Error(graphErrors.slice(0, 20).join('\n'));
  mkdirSync(output, { recursive: true });
  files = [writeCsv(names[0], ITEM_COLUMNS, itemRows()), writeCsv(names[1], CONNECTION_COLUMNS, connectionRows())];
  writeFileSync(join(output, 'README.md'), readme(files), 'utf8');
  files.push({ name: 'README.md', rows: null, bytes: statSync(join(output, 'README.md')).size, sha256: hash(readFileSync(join(output, 'README.md'))) });
  await pack();
} else {
  const previous = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(previous.input_identity_sha256, inputIdentity, 'Canonical inputs changed since export');
  for (const file of previous.files) {
    const digest = createHash('sha256'); for await (const bytes of createReadStream(join(output, file.name))) digest.update(bytes);
    assert.equal(digest.digest('hex'), file.sha256, `${file.name} bytes changed since export`);
  }
}
assert.deepEqual(readdirSync(output).sort(), [...names].sort(), 'Package directory must contain exactly three files');
const verifiedItems = await verifyCsv(names[0], ITEM_COLUMNS, itemRows());
const verifiedConnections = await verifyCsv(names[1], CONNECTION_COLUMNS, connectionRows());
await verifyZip();
const receipt = { status: 'PASSED', contract_version: '1.0', input_identity_sha256: inputIdentity, counts,
  items_csv: verifiedItems, connections_csv: verifiedConnections, files: files || JSON.parse(readFileSync(receiptPath, 'utf8')).files,
  zip: { path: relative(ROOT, archivePath).replaceAll('\\', '/'), bytes: statSync(archivePath).size },
  checks: ['source-to-graph relationship reconciliation', 'unique item/connection IDs', 'complete endpoints', 'native relationship semantics and source fields', 'ordinal row order', 'all CSV fields independently parsed and compared', 'exact ZIP entry inventory and uncompressed hashes'],
  publisher_completeness: coverage.completeness_status, unresolved_source_rows: reconciliation.counts.unresolved_source_rows };
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(receipt, null, 2));
