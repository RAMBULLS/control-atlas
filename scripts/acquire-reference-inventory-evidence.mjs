#!/usr/bin/env node
// Acquire official evidence for the existing reference-inventory boundaries.
// This command does not normalize records or change the canonical graph.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictConditionalFetch } from './lib/strict-conditional-fetch.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
import { classifyAcquiredSource, evaluateSourceRecovery, rediscoverSourceLocation } from './lib/source-recovery.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const output = join(root, '.local-agent/reference-export/raw/inventories');
const receiptPath = join(root, '.local-agent/reference-export/inventory-acquisition.json');
const registry = read('data/source-registry.json');
const wanted = new Set(['cmmc-2', 'cui-policy', 'dod-rai', 'fedramp-rev5', 'fips-199', 'fips-200', 'nist-800-37', 'nist-800-53a', 'nist-800-53b']);
const selected = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const requireFresh = process.argv.includes('--require-fresh') || process.env.CONTROL_ATLAS_REQUIRE_FRESH_FETCH === '1';
const eligible = (source) => !selected.length || selected.some((id) => id === source.id || source.catalog_ids.includes(id));
const sources = new Map();
const add = (entry) => sources.set(entry.id, entry);
for (const bundle of registry.catalog_source_bundles.filter((bundle) => wanted.has(bundle.catalog_id))) {
  for (const id of bundle.primary_artifact_ids) {
    const artifact = registry.artifacts.find((entry) => entry.id === id);
    const entry = sources.get(id) || { id, url: artifact.artifact_url, catalog_ids: [], registered_sha256: artifact.sha256, registered_bytes: artifact.byte_length };
    entry.catalog_ids.push(bundle.catalog_id); add(entry);
  }
}
for (const entry of read('data/curated/nist-structured-catalogs/source-manifest.json').sources) {
  add({ id: entry.source_key, url: entry.url, catalog_ids: entry.source_key.includes('mobile') ? ['nist-mobile-threats'] : ['nist-iot-cybersecurity'], registered_sha256: entry.sha256, registered_bytes: entry.byte_length });
}
for (const entry of read('data/curated/nist-zt/structured-source-manifest.json').sources) {
  add({ id: entry.source_key, url: entry.url, catalog_ids: entry.source_key.startsWith('microsoft') ? ['microsoft-zt-maturity'] : ['nist-zt'], registered_sha256: entry.sha256, registered_bytes: entry.byte_length });
}
for (const entry of read('data/curated/nist-zt/nist-source-manifest.json').sources) {
  add({ id: entry.source_key, url: entry.artifact_url || entry.url, catalog_ids: ['nist-zt'], registered_sha256: entry.sha256, registered_bytes: entry.byte_length });
}
for (const entry of read('data/curated/dod-zt/source-manifest.json').documents) {
  add({ id: entry.source_key, url: entry.source_recovery?.accepted_url || entry.source_url, catalog_ids: ['dod-zt'], registered_sha256: entry.checksum, registered_bytes: entry.byte_length,
    ...(entry.source_recovery ? { source_recovery: entry.source_recovery } : {}) });
}
add({ id: 'nara-category-list', url: 'https://www.archives.gov/cui/registry/category-list', catalog_ids: ['cui-policy'] });
add({ id: 'nara-category-markings', url: 'https://www.archives.gov/cui/registry/category-marking-list', catalog_ids: ['cui-policy'] });
for (const baseline of ['LOW', 'MODERATE', 'HIGH', 'PRIVACY']) {
  add({ id: `nist-80053b-${baseline.toLowerCase()}-profile`, url: `https://raw.githubusercontent.com/usnistgov/oscal-content/v1.5.0/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_${baseline}-baseline_profile.json`, catalog_ids: ['nist-800-53b'] });
}
const disa = read('data/disa-artifact-manifest.json');
add({ id: 'disa-current-download-directory', url: disa.discovery_source, catalog_ids: ['disa-discovery'] });
for (const pkg of disa.reconciliation.standalone_packages) if (!existsSync(join(root, 'tmp/disa-cache/standalone', pkg.filename))) {
  add({ id: `disa-package-${pkg.filename.replace(/\.zip$/i, '')}`, url: `${disa.discovery_source}${pkg.filename}`, catalog_ids: [`disa-${pkg.kind}`], registered_sha256: pkg.checksum, registered_bytes: null });
}
const currentDisaPath = join(root, '.local-agent/reference-export/disa-current-publications.json');
if (existsSync(currentDisaPath)) for (const pkg of JSON.parse(readFileSync(currentDisaPath, 'utf8')).reconciliation.standaloneNeeded) {
  if (existsSync(join(root, 'tmp/disa-cache/standalone', pkg.filename))) continue;
  add({ id: `disa-current-${pkg.filename.replace(/\.zip$/i, '')}`, url: `${disa.discovery_source}${pkg.filename}`, catalog_ids: ['disa-current-missing'] });
}
mkdirSync(output, { recursive: true });
const prior = existsSync(receiptPath) ? read('.local-agent/reference-export/inventory-acquisition.json') : { sources: [] };
const results = new Map(prior.sources.map((entry) => [entry.id, entry]));
// Count retained candidates and last-good binaries too, not only the latest receipt.
let acquiredBytes = readdirSync(output, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.bin')).reduce((n, entry) => n + statSync(join(output, entry.name)).size, 0);
const inventoryRequests = new Map();
async function fetchBytes(url, maximum) {
  const response = await strictConditionalFetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); length += bytes.length;
    if (length > maximum) throw new Error('Source evidence exceeds its bounded acquisition allowance');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
const fetchRecoveryBytes = (url, maximum) => {
  if (maximum !== 512 * 1024) return fetchBytes(url, maximum);
  if (!inventoryRequests.has(url)) inventoryRequests.set(url, fetchBytes(url, maximum));
  return inventoryRequests.get(url);
};
function saveEvidence(id, bytes) {
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const path = `.local-agent/reference-export/raw/inventories/${id}.${sha256.slice(7)}.bin`;
  if (existsSync(join(root, path))) {
    if (`sha256:${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}` !== sha256) throw new Error('Content-addressed source evidence differs from its checksum');
  } else {
    if (acquiredBytes + bytes.length > 128 * 1024 * 1024) throw new Error('Source evidence exceeds its bounded acquisition allowance');
    writeFileSync(join(root, path), bytes); acquiredBytes += bytes.length;
  }
  return { path, sha256 };
}
for (const source of sources.values()) {
  if (!eligible(source)) continue;
  const previous = results.get(source.id);
  if (!requireFresh && previous?.status === 'ACQUIRED' && existsSync(join(root, previous.path))) {
    const bytes = readFileSync(join(root, previous.path));
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== previous.sha256) throw new Error(`${source.id}: saved evidence changed`);
    console.log(`REUSE ${source.id}: ${bytes.length} verified bytes`); continue;
  }
  try {
    let url = previous?.recovery?.status === 'verified_relocation' ? previous.recovery.accepted_url : source.url;
    let bytes; let recovery;
    try { bytes = await fetchBytes(url, 32 * 1024 * 1024); }
    catch (initialError) {
      const inventory = source.source_recovery?.inventory_url;
      if (!inventory || !source.registered_sha256 || !source.registered_bytes) throw initialError;
      try {
        const result = await rediscoverSourceLocation({ id: source.id, url: source.url, sha256: source.registered_sha256, bytes: source.registered_bytes }, inventory, fetchRecoveryBytes, url);
        const savedInventory = saveEvidence(`${source.id}-recovery-inventory`, result.inventoryBytes);
        recovery = { ...result.recovery, inventory_evidence: { ...result.recovery.inventory_evidence, path: savedInventory.path } };
        if (!result.bytes) { initialError.recovery = recovery; throw initialError; }
        bytes = result.bytes; url = recovery.accepted_url || recovery.candidate_url;
      } catch (recoveryError) {
        if (!recoveryError.recovery) recoveryError.recovery = { status: 'rediscovery_failed', reason: recoveryError.message, original_failure: initialError.message, retain_last_good: true, lifecycle_currentness: 'UNKNOWN' };
        throw recoveryError;
      }
    }
    const { path, sha256 } = saveEvidence(source.id, bytes);
    const disposition = classifyAcquiredSource(source, previous, { sha256, bytes: bytes.length });
    results.set(source.id, { ...source, ...disposition, url, path, sha256, bytes: bytes.length, ...(recovery ? { recovery } : {}),
      registered_bytes_match: source.registered_sha256 ? sha256 === source.registered_sha256 && bytes.length === source.registered_bytes : null,
      retrieved_at: new Date().toISOString() });
    console.log(`${disposition.status} ${source.id}: ${bytes.length} bytes; registered bytes ${source.registered_sha256 ? sha256 === source.registered_sha256 ? 'MATCH' : 'DIFFER' : 'not declared'}`);
  } catch (error) {
    const http = Number(error.message.match(/^HTTP (\d{3})$/)?.[1]);
    const recovery = error.recovery || (source.registered_sha256 && source.registered_bytes && http ? evaluateSourceRecovery({ id: source.id, sha256: source.registered_sha256, bytes: source.registered_bytes }, { http_status: http }) : null);
    const lastGood = previous?.status === 'ACQUIRED' ? { path: previous.path, sha256: previous.sha256, bytes: previous.bytes, url: previous.url, retrieved_at: previous.retrieved_at } : previous?.last_good;
    results.set(source.id, { ...source, status: 'UNKNOWN', reason: error.message, ...(lastGood ? { last_good: lastGood } : {}), ...(recovery ? { recovery } : {}) });
    console.error(`UNKNOWN ${source.id}: ${error.message}`);
  }
  writeJsonAtomically(receiptPath, { purpose: 'Official source inventory evidence; acquisition is not completeness proof.', sources: [...results.values()] });
}
if ([...results.values()].some((entry) => ['UNKNOWN', 'CANDIDATE_CHANGED_BYTES'].includes(entry.status) && sources.has(entry.id) && eligible(sources.get(entry.id)))) process.exitCode = 1;
