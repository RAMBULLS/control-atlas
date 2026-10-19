#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNistZeroTrustCatalog, buildNistIoTRequirementCatalog } from '../tools/importers/framework-adapters.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
import { iotMappingDisposition } from '../tools/importers/nist-structured-catalog-adapter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const iot = read('data/curated/nist-structured-catalogs/iot-requirements.json');
for (const record of iot.records) Object.assign(record, iotMappingDisposition(record));
writeJsonAtomically(join(root, 'data/curated/nist-structured-catalogs/iot-requirements.json'), iot);
const manifest = read('data/curated/nist-structured-catalogs/source-manifest.json');
manifest.reconciliation.iot.graph_eligible_csf11_relationships = iot.records.reduce((n, record) => n + record.relationships.filter((edge) => edge.target_catalog === 'nist-csf-1.1').length, 0);
manifest.reconciliation.iot.published_csf11_relationships = iot.records.reduce((n, record) => n + record.publisher_mappings.filter((edge) => edge.target_catalog === 'nist-csf-1.1').length, 0);
manifest.reconciliation.iot.unresolved_mapping_assertions = iot.records.reduce((n, record) => n + (record.unresolved_mappings || []).length, 0);
writeJsonAtomically(join(root, 'data/curated/nist-structured-catalogs/source-manifest.json'), manifest);
const registry = read('data/source-registry.json');
const csfArtifact = registry.artifacts.find((artifact) => artifact.id === 'artifact-nist-iot-requirements-csf11-mapping-draft');
csfArtifact.relationship_count = manifest.reconciliation.iot.published_csf11_relationships;
writeJsonAtomically(join(root, 'data/source-registry.json'), registry);
for (const [file, curated, build] of [
  ['nist-zt.json', 'nist-zt', buildNistZeroTrustCatalog],
  ['nist-iot-cybersecurity.json', 'nist-structured-catalogs', buildNistIoTRequirementCatalog],
]) {
  const existing = read(`data/${file}`);
  const snapshot = existing.records[0].source.snapshot_date;
  const result = build(snapshot, join(root, 'data/curated', curated));
  const originalById = new Map(existing.records.map((record) => [record.id, record]));
  // Preserve per-record retrieval identity; only derived relationship fields change.
  for (const record of result.records) record.source = originalById.get(record.id)?.source || record.source;
  writeJsonAtomically(join(root, 'data', file), result);
  console.log(`${file}: ${result.records.length} records; ${result.records.reduce((n, record) => n + (record.metadata?.relationships?.length || 0), 0)} relationship assertions`);
}
