#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverOfficialRelocations, evaluateSourceRecovery } from './lib/source-recovery.mjs';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const manifest = read('data/curated/dod-zt/source-manifest.json');
const receipt = read('.local-agent/reference-export/dod-zt-current-access.json');
const registry = read('data/source-registry.json'); const hydration = read('data/artifact-hydration-manifest.json');
const acquisition = read('.local-agent/reference-export/inventory-acquisition.json');
const relocations = discoverOfficialRelocations({ links: receipt.documents.map((entry) => ({ title: entry.title, url: entry.url })) }, receipt.library,
  manifest.documents.map((entry) => ({ id: entry.source_key, url: entry.source_url })));
for (const entry of receipt.documents) {
  const document = manifest.documents.find((row) => row.source_key === entry.id); assert.ok(document);
  const bytes = readFileSync(join(root, entry.path)); assert.equal(sha(bytes), document.checksum); assert.equal(bytes.length, document.byte_length);
  const recovery = evaluateSourceRecovery({ id: entry.id, url: document.source_url, sha256: document.checksum, bytes: document.byte_length, lifecycle: registry.publications.find((row) => row.id === entry.id)?.lifecycle_status },
    { url: entry.url, sha256: sha(bytes), bytes: bytes.length, discovery: relocations.find((row) => row.source_id === entry.id) });
  assert.equal(recovery.status, 'verified_relocation');
  document.source_recovery = { ...recovery, prior_url: document.source_url, retrieved_at: entry.retrieved_at, discovery_method: entry.discovery_method, acquisition_method: entry.acquisition_method };
  for (const source of [...registry.publications, ...registry.artifacts].filter((row) => row.id === entry.id || row.id === `artifact-${entry.id}`)) {
    source.artifact_url = recovery.accepted_url; source.retrieved_at = entry.retrieved_at.slice(0, 10);
    source.metadata = { ...source.metadata, source_recovery: document.source_recovery };
  }
  const prior = acquisition.sources.find((row) => row.id === entry.id); assert.ok(prior);
  Object.assign(prior, { status: 'ACQUIRED', path: entry.path, url: entry.url, sha256: sha(bytes), bytes: bytes.length, registered_bytes_match: true, retrieved_at: entry.retrieved_at, source_recovery: document.source_recovery }); delete prior.reason;
  const attestation = hydration.results.find((row) => row.id === `artifact-${entry.id}`);
  if (attestation) Object.assign(attestation, { url: entry.url, retrieved_at: entry.retrieved_at.slice(0, 10), sha256: sha(bytes), byte_length: bytes.length });
}
const archive = read('.local-agent/reference-export/overlays-archive-comparison.json');
assert.equal(archive.pages, 383); assert.equal(archive.exact_page_text_matches, archive.pages); assert.deepEqual(archive.different_pages, []);
const bytes = readFileSync(join(root, '.local-agent/reference-export/raw/inventories/dod-zt-overlays-2024-current.bin'));
assert.equal(sha(bytes), archive.source.sha256); assert.equal(bytes.length, archive.source.byte_length);
const overlays = manifest.documents.find((row) => row.source_key === 'dod-zt-overlays-2024');
overlays.source_recovery = { status: 'archive_content_verified', retain_last_good: true, lifecycle_currentness: 'UNKNOWN',
  official_access_observations: [{ url: overlays.source_url, status: 404 }, { url: 'https://dowcio.war.gov/Portals/0/Documents/Library/ZeroTrustOverlays-2024Feb.pdf', status: 404 }],
  archival_corroboration: { url: archive.source.url, sha256: sha(bytes), byte_length: bytes.length, pages: archive.pages, exact_page_text_matches: archive.exact_page_text_matches,
    retained_capture_sha256: sha(readFileSync(join(root, 'data/curated/dod-zt/source-fragments/overlays.json'))), acquisition_kind: 'public_archival_mirror', publisher_currentness: 'UNKNOWN', reason: 'All383extractedpage texts match the retained official capture exactly. Archive PDF is6byteslonger with a different checksum; original official byte identity is preserved separately. No deprecation or replacement is inferred.' } };
const artifact = registry.artifacts.find((row) => row.id === 'artifact-dod-zt-overlays-2024'); artifact.metadata = { ...artifact.metadata, source_recovery: overlays.source_recovery };
const review = read('data/source-review-manifest.json'); const profile = review.catalogs.find((row) => row.catalog_id === 'dod-zt');
if (profile) { profile.upstream_currentness_review = 'blocked'; profile.follow_up = 'Seven official PDFs freshly byte-verified from the current CIO library. Overlay original and migrated URLs return browser404; a383-page public archive exactly corroborates retained text, but publisher replacement/withdrawal/currentness remains UNKNOWN.'; }
for (const [path, value] of [['data/curated/dod-zt/source-manifest.json', manifest], ['data/source-registry.json', registry], ['data/artifact-hydration-manifest.json', hydration], ['data/source-review-manifest.json', review], ['.local-agent/reference-export/inventory-acquisition.json', acquisition]]) writeJsonAtomically(join(root, path), value);
console.log(JSON.stringify({ verified_official_relocations: receipt.documents.length, archive_pages_exactly_corroborated: archive.exact_page_text_matches, canonical_items_changed: 0, canonical_relationships_changed: 0, official_overlay_lifecycle: 'UNKNOWN' }));
