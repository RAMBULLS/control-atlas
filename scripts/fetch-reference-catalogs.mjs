#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictConditionalFetch } from './lib/strict-conditional-fetch.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
import { REFERENCE_CATALOG_SOURCES, referenceSha256, parseCsf11Core, parseCriticalSoftware } from '../tools/importers/reference-catalog-adapter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawRoot = join(ROOT, '.local-agent/reference-export/raw');
const manifestPath = join(ROOT, 'data/curated/reference-catalogs/source-manifest.json');
const prior = (() => { try { return JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { return {}; } })();
const manifest = { schema_version: '1.0', sources: [], catalogs: {} };
const registry = JSON.parse(readFileSync(join(ROOT, 'data/source-registry.json'), 'utf8'));
const hydration = JSON.parse(readFileSync(join(ROOT, 'data/artifact-hydration-manifest.json'), 'utf8'));
const upsert = (items, item, key = 'id') => { const i = items.findIndex((v) => v[key] === item[key]); if (i < 0) items.push(item); else items[i] = { ...items[i], ...item }; };
mkdirSync(rawRoot, { recursive: true });
for (const source of REFERENCE_CATALOG_SOURCES) {
  let bytes;
  if (process.argv.includes('--from-cache')) bytes = readFileSync(join(rawRoot, source.raw));
  else {
    const response = await strictConditionalFetch(source.url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${source.id}: official download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) throw new Error(`${source.id}: download exceeds 4 MiB bound`);
    writeFileSync(join(rawRoot, source.raw), bytes);
  }
  const sha256 = referenceSha256(bytes);
  const retrievedAt = prior.sources?.find((p) => p.id === source.id && p.sha256 === sha256)?.retrieved_at || new Date().toISOString();
  const parsed = source.id === 'nist-csf-1.1' ? await parseCsf11Core(bytes, source) : parseCriticalSoftware(bytes, source);
  if (source.id === 'nist-csf-1.1' ? parsed.inventory.functions !== 5 || parsed.inventory.categories !== 23 || parsed.inventory.records !== 108 : parsed.inventory.objectives !== 5 || parsed.inventory.records !== 20) {
    throw new Error(`${source.id}: official inventory changed; reconcile the source edition before admission`);
  }
  const records = parsed.records.map((record) => ({ ...record, source: { key: source.id, snapshot_date: retrievedAt, version: source.version, locator: record.locator },
    metadata: { ...record.metadata, primary_artifact_id: `artifact-${source.id}`, publication_date: source.publicationDate },
    ...(source.lifecycle === 'superseded' ? { status: 'superseded' } : {}),
  }));
  writeJsonAtomically(join(ROOT, 'data', source.file), { schema_version: '1.0', source_key: source.id, records });
  const captured = { id: source.id, url: source.url, sha256, byte_length: bytes.length, retrieved_at: retrievedAt, parser: source.parser, ...parsed.inventory };
  manifest.sources.push(captured); manifest.catalogs[source.inventoryKey] = parsed.inventory;
  const publication = { id: source.id, name: source.name, display_name: source.name, display_group: 'NIST', owner: 'NIST', authority_class: 'publisher', provenance_class: 'federal_published',
    mandate_basis: [], version: source.version, retrieved_at: retrievedAt, retrieval_method: 'official_structured_export', artifact_url: source.url, catalog_browse_url: source.landing,
    access_status: 'public', license_or_use: 'NIST Public Access and Copyright Notice', lifecycle_status: source.lifecycle, eligibility_status: source.lifecycle === 'active' ? 'eligible' : 'limited',
    federal_referenced_by: [], graph_eligible: true, metadata: { frameworks: [source.id], parser: source.parser, identity_kind: 'publication' } };
  upsert(registry.publications, publication);
  upsert(registry.artifacts, { id: `artifact-${source.id}`, publication_source_id: source.id, name: source.name, display_name: source.name,
    source_role: 'primary_data', authority_class: 'publisher', format: source.format, version: source.version, lifecycle_status: source.lifecycle,
    retrieval_method: 'official_structured_export', retrieved_at: retrievedAt, artifact_url: source.url, byte_length: bytes.length, sha256, parser: source.parser, parser_version: '1.0.0',
    record_count: records.length, relationship_count: 0, license_or_use: publication.license_or_use });
  upsert(registry.catalog_source_bundles, { catalog_id: source.id, publication_source_id: source.id, primary_artifact_ids: [`artifact-${source.id}`], enrichment_artifact_ids: [], mapping_source_ids: [], assessment_source_ids: [], automation_source_ids: [], reconciliation_source_ids: [],
    expected_inventory: { basis: 'Complete official publisher table parsed with native identifiers and hierarchy.', evidence_class: 'publisher_inventory', evidence_locator: `data/curated/reference-catalogs/source-manifest.json#catalogs.${source.inventoryKey}.records`, imported_evidence_locator: `data/generated/catalog-source-inventory.json#catalogs.${source.id}.normalized_records`, exclusions: [] } }, 'catalog_id');
  upsert(hydration.results, { id: `artifact-${source.id}`, status: 'OK', http: 200, url: source.url, sha256, byte_length: bytes.length, record_count: records.length, retrieved_at: retrievedAt });
  console.log(`${source.id}: ${records.length} records, ${bytes.length} bytes, ${sha256}`);
}
writeJsonAtomically(manifestPath, manifest);
for (const key of ['publications', 'artifacts']) registry[key].sort((a, b) => a.id.localeCompare(b.id));
registry.catalog_source_bundles.sort((a, b) => a.catalog_id.localeCompare(b.catalog_id));
writeJsonAtomically(join(ROOT, 'data/source-registry.json'), registry);
writeJsonAtomically(join(ROOT, 'data/artifact-hydration-manifest.json'), hydration);
