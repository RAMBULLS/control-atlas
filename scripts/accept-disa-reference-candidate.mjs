#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preserveDisaRecordHistory, preserveDisaConnectionIds } from './lib/disa-publication-reconciliation.mjs';
import { sourceUnitInventory } from '../tools/importers/native-unit-inventories.mjs';
import { readDisaCatalog, separateDisaHistory } from './lib/disa-record-history.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidate = '.local-agent/reference-export/current-disa-candidate';
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const encode = (data) => `${JSON.stringify(data, null, 2)}\n`;
const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const audit = read(`${candidate}/native-audit.json`); assert.equal(audit.status, 'PASSED');
for (const [path, expected] of Object.entries(audit.input_sha256)) assert.equal(hash(readFileSync(join(root, candidate, path))).slice(7), expected, `Candidate changed after independent audit: ${path}`);
const manifest = read(`${candidate}/data/disa-artifact-manifest.json`);
const proofs = read('data/curated/reference-catalogs/publisher-inventories.json'); const nextProofs = read(`${candidate}/native-inventories.json`);
const writes = new Map(); const summary = { catalogs: [] };
for (const kind of ['stig', 'srg']) {
  const path = `data/${kind === 'stig' ? 'stig-rules' : 'srg-requirements'}.json`;
  const prior = readDisaCatalog(root, kind); const next = read(`${candidate}/${path}`); const native = nextProofs[kind]; const oldProof = proofs.catalogs[`disa-${kind}`];
  const currentCount = next.records.length;
  next.records = preserveDisaRecordHistory(prior.records, next.records);
  const stored = separateDisaHistory(next, kind); writes.set(path, stored.main);
  if (stored.main.record_history) writes.set(stored.main.record_history.path, stored.history);
  const units = [...oldProof.native_units.map((unit) => ({ ...unit, source_checksum: unit.source_checksum || oldProof.source_evidence.find((source) => source.url === unit.source_url).sha256 })), ...native.native_units];
  const distinct = (rows) => [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()];
  const proof = { ...sourceUnitInventory(distinct(units), 'Union of independently byte-verified July and October 2026 public manual source snapshots, including native standalone publications. Current snapshot IDs are listed separately; previously recorded IDs absent from October remain explicitly historical. Every native edition occurrence remains in this inventory. No retirement or applicability is inferred.', distinct([...oldProof.exclusions, ...native.exclusions])), source_evidence: distinct([...oldProof.source_evidence, ...native.source_evidence]), native_files: distinct([...oldProof.native_files, ...native.native_files]), current_snapshot: { compilation_url: manifest.compilation_url, checksum: manifest.checksum, record_count: native.record_count, record_ids: native.record_ids }, native_occurrences: distinct(units).length };
  assert.deepEqual(next.records.map((row) => row.id).sort(), proof.record_ids.slice().sort(), 'Historical/current union must preserve every source ID');
  proofs.catalogs[`disa-${kind}`] = proof;
  summary.catalogs.push({ catalog_id: `disa-${kind}`, previous: prior.records.length, current: currentCount, retained_total: next.records.length, retained_absent_current: next.records.filter((row) => !row.metadata.current_snapshot_presence).length, previous_edition_records: next.records.filter((row) => row.metadata.previous_editions?.length).length });
}
const mapPath = 'maps/stig-srg-to-cci.json'; const prior = read(mapPath); const next = read(`${candidate}/${mapPath}`);
next.relationships = preserveDisaConnectionIds(prior.relationships, next.relationships); writes.set(mapPath, next);
const nativeKey = (row) => JSON.stringify([row.source_catalog, row.source_id, row.target_catalog, row.target_id, row.relationship_type]);
const nextIds = new Map(next.relationships.map((row) => [nativeKey(row), row.atlas_connection_id]));
prior.relationships.forEach((row, index) => assert.equal(nextIds.get(nativeKey(row)), row.atlas_connection_id || `edge:stig-srg-to-cci:${index + 1}`));
summary.connections = { previous: prior.relationships.length, current: audit.native_connections, retained_total: next.relationships.length, citations: next.relationships.reduce((count, row) => count + row.source_citations.length, 0), retained_absent_current: next.relationships.filter((row) => !row.current_snapshot_presence).length };
manifest.retained_snapshot_union = summary; writes.set('data/disa-artifact-manifest.json', manifest); writes.set('data/curated/reference-catalogs/publisher-inventories.json', proofs);
const registry = read('data/source-registry.json'); const hydration = read('data/artifact-hydration-manifest.json');
for (const [id, path] of [['artifact-disa-stig-library', 'data/stig-rules.json'], ['artifact-disa-srg-library', 'data/srg-requirements.json'], ['artifact-disa-stig-srg-cci-references', mapPath]]) {
  const artifact = registry.artifacts.find((row) => row.id === id); const bytes = Buffer.from(encode(writes.get(path)));
  artifact.sha256 = hash(bytes); artifact.byte_length = bytes.length; artifact.artifact_url = manifest.compilation_url; artifact.retrieved_at = manifest.retrieval_timestamp.slice(0, 10);
  artifact.metadata = { ...artifact.metadata, byte_evidence_kind: 'normalized_projection', byte_evidence_locator: path, retained_snapshots: ['July 2026', 'October 2026'], current_compilation_checksum: manifest.checksum,
    ...(writes.get(path).record_history ? { supporting_files: [{ ...writes.get(path).record_history, role: 'retained_native_editions' }] } : {}) };
  if (id.endsWith('cci-references')) artifact.relationship_count = next.relationships.length;
  else { artifact.record_count = writes.get(path).records.length; artifact.relationship_count = writes.get(path).records.reduce((count, row) => count + (row.metadata?.relationships || []).length, 0); }
  const receipt = hydration.results.find((row) => row.id === id); if (receipt) Object.assign(receipt, { sha256: artifact.sha256, byte_length: bytes.length, url: manifest.compilation_url, retrieved_at: artifact.retrieved_at });
}
const artifact = registry.artifacts.find((row) => row.id === 'artifact-disa-compilation-zip');
Object.assign(artifact, { name: 'DISA SRG/STIG Library Compilation (October 2026)', display_name: 'DISA SRG/STIG Library Compilation (October 2026)', version: 'October 2026', artifact_url: manifest.compilation_url, sha256: manifest.checksum, byte_length: manifest.byte_length, retrieved_at: manifest.retrieval_timestamp.slice(0, 10) });
const receipt = hydration.results.find((row) => row.id === artifact.id); if (receipt) Object.assign(receipt, { sha256: artifact.sha256, byte_length: artifact.byte_length, url: artifact.artifact_url, retrieved_at: artifact.retrieved_at });
for (const source of registry.publications.filter((row) => ['disa-stig-library', 'disa-srg-library', 'disa-stig-srg-cci-references'].includes(row.id))) {
  source.retrieved_at = manifest.retrieval_timestamp.slice(0, 10);
  source.metadata = { ...source.metadata, retained_snapshots: ['July 2026', 'October 2026'], current_compilation_url: manifest.compilation_url, version_scope: 'Existing aggregate registry label; individual native benchmark editions are recorded on each item and citation.' };
}
writes.set('data/source-registry.json', registry); writes.set('data/artifact-hydration-manifest.json', hydration);
// All assertions above complete before the first canonical write.
for (const [path, document] of writes) writeJsonAtomically(join(root, path), document);
writeFileSync(join(root, candidate, 'acceptance.json'), encode({ status: 'ACCEPTED_LOCAL', ...summary }));
console.log(JSON.stringify(summary, null, 2));
