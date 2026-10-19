#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNistZeroTrustMappingWorkbook } from '../tools/importers/zero-trust-workbook-adapter.mjs';
import { resolveRedundantPublisherReference } from '../tools/importers/reference-dispositions.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(root, path)));
const source = read('data/curated/nist-zt/structured-source-manifest.json').sources.find((entry) => entry.mapping_kind === 'csf_2');
const acquired = read('.local-agent/reference-export/inventory-acquisition.json').sources.find((entry) => entry.id === source.source_key);
assert.equal(acquired.status, 'ACQUIRED'); assert.equal(acquired.sha256, source.sha256); assert.equal(acquired.bytes, source.byte_length);
const parsed = await parseNistZeroTrustMappingWorkbook(readFileSync(join(root, acquired.path)), source);
const document = read('data/curated/nist-zt/mappings.json');
const retainedById = new Map(document.records.map((entry) => [entry.id, entry]));
for (const row of parsed.mappings) {
  const retained = retainedById.get(row.id);
  assert.ok(retained, `Downloaded source row missing: ${row.id}`);
  for (const field of ['relationship', 'target_id', 'architecture_component', 'component_function', 'product', 'source_fragments']) assert.deepEqual(retained[field], row[field], `${row.id} ${field} changed`);
}
let resolved = 0;
for (const row of document.records.filter((entry) => entry.relationship_parse_status === 'unresolved')) {
  const disposition = resolveRedundantPublisherReference(row, document.records);
  if (!disposition) throw new Error(`${row.id}: no proven source-linked disposition`);
  row.source_disposition = disposition; resolved += 1;
}
writeJsonAtomically(join(root, 'data/curated/nist-zt/mappings.json'), document);
console.log(`${resolved} explicit publisher cross-references resolved; original row text and native assertions unchanged.`);
