#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupeDisaRelationships } from './lib/disa-publication-reconciliation.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const proofs = read('data/curated/reference-catalogs/publisher-inventories.json').catalogs;
const acquisition = read('.local-agent/reference-export/inventory-acquisition.json');
const registry = read('data/source-registry.json'); const hydration = read('data/artifact-hydration-manifest.json');
const baselines = read('data/800-53b-baselines.json'); const controls = read('data/controls-800-53.json');
const baselineProof = proofs['nist-800-53b']; const originalArtifact = registry.artifacts.find((artifact) => artifact.id === 'artifact-nist-800-53b-baselines');
const byBaseline = new Map();
for (const unit of baselineProof.native_units) {
  const evidence = baselineProof.source_evidence.find((entry) => entry.url === unit.locator);
  const entry = acquisition.sources.find((entry) => entry.sha256 === evidence.sha256 && entry.url === evidence.url);
  const bytes = readFileSync(join(root, entry.path)); assert.equal(hash(bytes), evidence.sha256); assert.equal(bytes.length, evidence.byte_length);
  const profile = JSON.parse(bytes).profile;
  const selected = controls.records.filter((record) => (record.metadata?.nist_800_53b_baselines || []).some((label) => new RegExp(`\\b${unit.id} (?:IMPACT )?BASELINE$`).test(label))).map((record) => record.id).sort();
  assert.deepEqual(selected, baselineProof.memberships[unit.id], `Wrong native ${unit.id} membership`);
  const id = unit.id === 'MODERATE' ? originalArtifact.id : `artifact-nist-800-53b-${unit.id.toLowerCase()}-profile`;
  const prior = registry.artifacts.find((artifact) => artifact.id === id);
  const artifact = { ...(prior || originalArtifact), id, name: `NIST SP800-53B ${unit.id} OSCAL baseline profile`, display_name: `SP800-53B ${unit.id} profile`, version: profile.metadata.version,
    artifact_url: evidence.url, byte_length: bytes.length, sha256: evidence.sha256, retrieved_at: entry.retrieved_at.slice(0,10), record_count: 1, relationship_count: selected.length,
    metadata: { ...(prior?.metadata || {}), byte_evidence_kind: 'downloaded_publisher_bytes', native_baseline_id: unit.id } };
  if (prior) Object.assign(prior, artifact); else registry.artifacts.push(artifact);
  const receipt = { id, status: 'OK', http: 'verified-acquired-publisher-bytes', url: evidence.url, sha256: evidence.sha256, byte_length: bytes.length, record_count: 1, retrieved_at: artifact.retrieved_at };
  const oldReceipt = hydration.results.find((row) => row.id === id); if (oldReceipt) Object.assign(oldReceipt, receipt); else hydration.results.push(receipt);
  byBaseline.set(unit.id, { artifact, title: profile.metadata.title, edition: profile.metadata.version });
}
const bundle = registry.catalog_source_bundles.find((entry) => entry.catalog_id === 'nist-800-53b'); bundle.primary_artifact_ids = [...byBaseline.values()].map((entry) => entry.artifact.id).sort();
for (const baseline of baselines.records) {
  const entry = byBaseline.get(baseline.id); assert.ok(entry);
  baseline.source = { ...baseline.source, locator: entry.artifact.artifact_url, version: entry.edition };
  baseline.metadata = { ...baseline.metadata, primary_artifact_id: entry.artifact.id, publisher_baseline_title: entry.title };
}
let labelsCorrected = 0;
for (const control of controls.records) if (control.metadata?.nist_800_53b_baselines) control.metadata.nist_800_53b_baselines = control.metadata.nist_800_53b_baselines.map((label) => {
  const id = [...byBaseline.keys()].find((id) => new RegExp(`\\b${id} (?:IMPACT )?BASELINE$`).test(label)); assert.ok(id, 'Unsupported existing baseline label');
  const title = byBaseline.get(id).title; if (title !== label) labelsCorrected += 1; return title;
});

const disa = read('data/disa-artifact-manifest.json'); const map = read('maps/stig-srg-to-cci.json');
const evidenceByUrl = new Map(proofs['disa-stig'].source_evidence.map((entry) => [entry.url, entry]));
const native = new Map();
for (const kind of ['stig','srg']) for (const unit of proofs[`disa-${kind}`].native_units) for (const cci of unit.cci_ids) {
  const key = `${kind}:${unit.id}:${cci}`; const rows = native.get(key) || []; rows.push(unit); native.set(key, rows);
}
assert.equal(native.size, map.relationships.length, 'Native DISA connection count changed; do not infer or append mappings');
let citations = 0; let multiple = 0;
map.relationships = map.relationships.map((relationship) => {
  const units = native.get(`${relationship.source_catalog.replace('disa-','')}:${relationship.source_id}:${relationship.target_id}`); assert.ok(units?.length, 'Recorded relationship lacks native source');
  const first = units.findIndex((unit) => unit.locator === relationship.source_locator); assert.ok(first >= 0, `Existing primary locator absent: ${relationship.source_locator}`);
  const ordered = [units[first], ...units.filter((_, index) => index !== first)];
  const seeds = ordered.map((unit) => ({ ...relationship, source_locator: unit.locator, source_url: unit.source_url, source_version: unit.edition,
    source_checksum: evidenceByUrl.get(unit.source_url).sha256, native_rule_id: unit.rule_id, benchmark_id: unit.benchmark_id }));
  const merged = dedupeDisaRelationships(seeds); assert.equal(merged.length, 1); assert.equal(merged[0].source_locator, relationship.source_locator);
  citations += merged[0].source_citations.length; if (merged[0].source_citations.length > 1) multiple += 1; return merged[0];
});
const nativeFiles = proofs['disa-stig'].native_files;
for (const pkg of disa.reconciliation.standalone_packages) pkg.xccdf_files = nativeFiles.filter((file) => file.source_url === `${disa.discovery_source}${pkg.filename}`).length;
disa.reconciliation.compilation_ingested_files = nativeFiles.filter((file) => file.source_url === disa.compilation_url).length;
disa.reconciliation.standalone_ingested_files = disa.reconciliation.standalone_packages.reduce((sum, pkg) => sum + pkg.xccdf_files, 0);
disa.reconciliation.ingested_files = nativeFiles.length;
disa.reconciliation.publisher_citation_occurrences = citations;
assert.equal(disa.reconciliation.compilation_ingested_files + disa.reconciliation.standalone_ingested_files, nativeFiles.length);

const writes = new Map([['data/800-53b-baselines.json',baselines],['data/controls-800-53.json',controls],['maps/stig-srg-to-cci.json',map],['data/disa-artifact-manifest.json',disa]]);
for (const [id, path] of [['artifact-disa-stig-library','data/stig-rules.json'],['artifact-disa-srg-library','data/srg-requirements.json'],['artifact-disa-stig-srg-cci-references','maps/stig-srg-to-cci.json']]) {
  const artifact = registry.artifacts.find((entry) => entry.id === id);
  const bytes = writes.has(path) ? Buffer.from(encode(writes.get(path))) : readFileSync(join(root,path));
  artifact.sha256 = hash(bytes); artifact.byte_length = bytes.length; artifact.origin = 'publisher_normalized';
  artifact.metadata = { ...(artifact.metadata || {}), byte_evidence_kind: 'normalized_projection', byte_evidence_locator: path, upstream_format: 'xccdf', serialized_format: 'normalized_json', upstream_inventory: 'data/disa-artifact-manifest.json' };
  const receipt = hydration.results.find((entry) => entry.id === id); if (receipt) Object.assign(receipt,{sha256:artifact.sha256,byte_length:bytes.length,attestation:'Checksum identifies the normalized local projection; upstream archive byte evidence is separately verified by the DISA source manifest and publisher-unit inventory.'});
}
writes.set('data/source-registry.json',registry); writes.set('data/artifact-hydration-manifest.json',hydration);
for (const [path, document] of writes) writeFileSync(join(root,path),encode(document));
console.log(JSON.stringify({baseline_profiles:4,baseline_memberships:baselineProof.native_units.reduce((n,u)=>n+u.member_count,0),baseline_labels_corrected:labelsCorrected,disa_connections:map.relationships.length,disa_citations:citations,disa_connections_with_multiple_citations:multiple,disa_xccdf_files:nativeFiles.length,connections_added:0},null,2));
