#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disaNativeInventories } from '../tools/importers/disa-native-inventory.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidate = '.local-agent/reference-export/current-disa-candidate';
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const sha = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const manifest = read(`${candidate}/data/disa-artifact-manifest.json`);
assert.equal(manifest.publications.failed_publications, 0);
assert.equal(manifest.publications.missing_publications, 0);
assert.equal(manifest.reconciliation.failed_files, 0);
const inventories = await disaNativeInventories(root, manifest, console.log);
const key = (kind, id, cci) => `${kind}:${id}:${cci}`;
const nativePairs = new Set(); const results = [];
for (const [kind, inventory] of Object.entries(inventories)) {
  const path = `data/${kind === 'stig' ? 'stig-rules' : 'srg-requirements'}.json`;
  const records = read(`${candidate}/${path}`).records;
  assert.deepEqual(records.map((row) => row.id).sort(), inventory.record_ids.slice().sort(), `${kind}: publisher identities`);
  const byId = new Map();
  for (const unit of inventory.native_units) {
    const units = byId.get(unit.id) || []; units.push(unit); byId.set(unit.id, units);
    for (const cci of unit.cci_ids) nativePairs.add(key(kind, unit.id, cci));
  }
  for (const record of records) assert.ok(byId.get(record.id).some((unit) => unit.benchmark_id === record.metadata.benchmark_id && unit.edition === record.source.version && unit.rule_id === record.rule_id), `Wrong native edition: ${record.id}`);
  const old = new Set(read(path).records.map((row) => row.id)); const current = new Set(records.map((row) => row.id));
  results.push({ catalog_id: `disa-${kind}`, current_publisher_ids: current.size, added_ids: [...current].filter((id) => !old.has(id)), prior_ids_absent_current: [...old].filter((id) => !current.has(id)) });
}
const map = read(`${candidate}/maps/stig-srg-to-cci.json`);
const observedPairs = new Set(map.relationships.map((row) => key(row.source_catalog.replace('disa-', ''), row.source_id, row.target_id)));
assert.equal(observedPairs.size, map.relationships.length, 'Duplicate native connections');
assert.deepEqual([...observedPairs].sort(), [...nativePairs].sort(), 'Every native CCI assertion must reach a connection');
const cci = new Set(read('data/ccis.json').records.map((row) => row.id));
for (const row of map.relationships) assert.ok(cci.has(row.target_id), `Missing canonical CCI endpoint: ${row.target_id}`);
const signature = (unit) => JSON.stringify([unit.source_url, unit.source_checksum, unit.locator, unit.edition, unit.rule_id, unit.benchmark_id]);
const nativeCitations = new Map();
for (const [kind, inventory] of Object.entries(inventories)) for (const unit of inventory.native_units) for (const id of unit.cci_ids) {
  const pair = key(kind, unit.id, id); const signatures = nativeCitations.get(pair) || new Set(); signatures.add(signature(unit)); nativeCitations.set(pair, signatures);
}
let citations = 0;
for (const row of map.relationships) {
  const observed = new Set(row.source_citations.map((citation) => JSON.stringify([citation.source_url, citation.checksum, citation.source_locator, citation.source_version, citation.native_rule_id, citation.benchmark_id])));
  assert.deepEqual([...observed].sort(), [...nativeCitations.get(key(row.source_catalog.replace('disa-', ''), row.source_id, row.target_id))].sort(), `Lost or altered citation: ${row.source_id}/${row.target_id}`);
  citations += observed.size;
}
assert.equal(inventories.stig.native_files.length, manifest.reconciliation.ingested_files, 'XCCDF file count must not count ZIPs as XML');
writeFileSync(join(root, candidate, 'native-inventories.json'), `${JSON.stringify(inventories, null, 2)}\n`);
const inputs = ['data/stig-rules.json', 'data/srg-requirements.json', 'maps/stig-srg-to-cci.json', 'data/disa-artifact-manifest.json', 'native-inventories.json'];
const receipt = { status: 'PASSED', input_sha256: Object.fromEntries(inputs.map((path) => [path, sha(`${candidate}/${path}`)])), catalogs: results, native_connections: nativePairs.size, native_citations: citations, xccdf_files: inventories.stig.native_files.length };
writeFileSync(join(root, candidate, 'native-audit.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ...receipt, input_sha256: undefined, catalogs: results.map((row) => ({ ...row, added_ids: row.added_ids.length, prior_ids_absent_current: row.prior_ids_absent_current.length })) }, null, 2));
