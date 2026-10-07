#!/usr/bin/env node
// verify:discovery — fail (never warn) when source discovery is incomplete or
// stale (spec §9): missing manifests, empty discovery, pagination truncation,
// unaccounted applicable sources, or stale fallback during a fresh-fetch run.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBaselineManifest } from './lib/nist-baseline-profiles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRESH = process.env.CONTROL_ATLAS_REQUIRE_FRESH_FETCH === '1';
const STALE_DAYS = 120; // a compilation/catalog older than this in fresh mode is stale fallback

const EXPECTED_MANIFESTS = [
  'data/disa-artifact-manifest.json',
  'data/olir-catalog-manifest.json',
  'data/artifact-hydration-manifest.json',
  'data/nara-cui-registry-manifest.json',
];

const errors = [];
const err = (m) => errors.push(m);

try {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data/nist-800-53b-profile-manifest.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(ROOT, 'data/controls-800-53.json'), 'utf8'));
  const reconciliation = verifyBaselineManifest(manifest, catalog);
  console.log(`PASS: NIST 800-53B - ${reconciliation.length} discovered profiles fully reconciled.`);
  if (FRESH && (!Number.isFinite(Date.parse(manifest.retrieved_at)) || Date.now() - Date.parse(manifest.retrieved_at) > STALE_DAYS * 86400000)) err('NIST baseline discovery is stale during required-fresh run');
} catch (error) { err(error.message); }

function daysOld(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

for (const rel of EXPECTED_MANIFESTS) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) {
    err(`missing discovery manifest: ${rel}`);
    continue;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(full, 'utf8'));
  } catch {
    err(`invalid JSON in ${rel}`);
    continue;
  }

  // Count discovered items across the known manifest shapes.
  let count = 0;
  if (Array.isArray(data.results)) count = data.results.length;
  else if (Array.isArray(data.artifacts)) count = data.artifacts.length;
  else if (Array.isArray(data.processed_items)) count = data.processed_items.length;
  else if (data.reconciliation?.inventory_details) count = data.reconciliation.inventory_details.length;
  else if (Array.isArray(data.searchResults)) count = data.searchResults.length;

  if (count === 0) err(`empty discovery in ${rel}`);
  else console.log(`PASS: ${rel} — ${count} discovered item(s).`);

  // Pagination truncation: if the manifest declares a total, discovered must meet it.
  const declaredTotal = data.total_entries ?? data.total ?? data.expected_total;
  if (Number.isInteger(declaredTotal) && count < declaredTotal) {
    err(`pagination truncation in ${rel}: discovered ${count} of ${declaredTotal} declared`);
  }

  // Stale fallback during a fresh run: the discovery evidence must be recent.
  if (FRESH) {
    const stamp = data.generated_at || data.retrieval_timestamp || data.retrieved_at;
    if (!stamp) err(`fresh-mode run but ${rel} has no retrieval timestamp (stale fallback)`);
    else if (daysOld(stamp) > STALE_DAYS) err(`fresh-mode run but ${rel} is ${Math.round(daysOld(stamp))}d old (stale fallback)`);
  }
}

// Unaccounted applicable sources: every graph-eligible publication that defines
// a catalog must have discovery evidence (an attested artifact or a manifest).
const regPath = join(ROOT, 'data/source-registry.json');
if (existsSync(regPath)) {
  const reg = JSON.parse(readFileSync(regPath, 'utf8'));
  const hydration = existsSync(join(ROOT, 'data/artifact-hydration-manifest.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'data/artifact-hydration-manifest.json'), 'utf8'))
    : { results: [] };
  const attested = new Set((hydration.results || []).filter((r) => r.status === 'OK').map((r) => r.id));
  for (const b of reg.catalog_source_bundles || []) {
    const hasPrimaryEvidence = (b.primary_artifact_ids || []).some((id) => attested.has(id));
    const hasDisclosedMappingInventory = b.expected_inventory?.primary_extraction_status === 'not_performed'
      && b.expected_inventory?.evidence_class === 'publisher_mapping_inventory'
      && (b.mapping_source_ids || []).length > 0
      && (b.mapping_source_ids || []).every((id) => attested.has(id));
    const hasEvidence = hasPrimaryEvidence || hasDisclosedMappingInventory;
    if (!hasEvidence) {
      err(`catalog ${b.catalog_id} has no attested primary artifact (unaccounted applicable source)`);
    }
  }
}

if (errors.length) {
  console.error(`FAIL: verify:discovery found ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('PASS: discovery verified.');
