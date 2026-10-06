#!/usr/bin/env node
// Phase 2 T2.1: the canonical publication-identity index. Groups every
// registry row (publications[] + artifacts[]) under the one canonical
// "publication"-kind identity it belongs to, so a downstream consumer can
// present ~47 landmarks instead of the 192 raw registry rows. Read-only over
// the registry; does not mutate source truth.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
import { generatedAt } from './lib/stable-generated-at.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'data/source-registry.json');
const CATALOG_INVENTORY = join(ROOT, 'data/generated/catalog-source-inventory.json');
const OUT = join(ROOT, 'data/generated/publication-identity-index.json');

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const catalogInventory = existsSync(CATALOG_INVENTORY)
  ? JSON.parse(readFileSync(CATALOG_INVENTORY, 'utf8'))
  : null;

const publications = registry.publications || [];
const artifacts = registry.artifacts || [];
const bundles = registry.catalog_source_bundles || [];

const canonicalPublications = publications.filter((pub) => pub.metadata?.identity_kind === 'publication');
const bundleByAnchor = new Map(bundles.map((bundle) => [bundle.publication_source_id, bundle]));

const identities = canonicalPublications.map((pub) => {
  const bundle = bundleByAnchor.get(pub.id) || null;

  const aliasPublications = publications.filter(
    (candidate) => candidate.metadata?.canonical_publication_id === pub.id,
  );
  const aliasIds = new Set(aliasPublications.map((alias) => alias.id));

  // Source materials: artifacts whose publication_source_id names this
  // identity directly, plus artifacts pointed at through an alias
  // (supplemental) identity so nothing attached to a duplicate is orphaned.
  const attachedArtifacts = artifacts.filter(
    (artifact) => artifact.publication_source_id === pub.id
      || aliasIds.has(artifact.publication_source_id),
  );

  const sourceMaterials = { primary: [], enrichment: [], reference: [], other: [] };
  const connectionEvidence = [];
  for (const artifact of attachedArtifacts) {
    if (artifact.source_role === 'mapping') {
      connectionEvidence.push(artifact.id);
    } else if (artifact.source_role === 'primary_data') {
      sourceMaterials.primary.push(artifact.id);
    } else if (artifact.source_role === 'enrichment') {
      sourceMaterials.enrichment.push(artifact.id);
    } else if (artifact.source_role === 'reference_only') {
      sourceMaterials.reference.push(artifact.id);
    } else {
      sourceMaterials.other.push(artifact.id);
    }
  }

  // Alias publications carry their own kind when no canonical artifact already
  // represents the same material. Mapping aliases are connection evidence;
  // other aliases are supplemental source materials.
  for (const alias of aliasPublications) {
    const hasCanonicalArtifact = attachedArtifacts.some(
      (artifact) => artifact.publication_source_id === alias.id,
    );
    if (alias.metadata?.identity_kind === 'mapping') {
      if (!hasCanonicalArtifact) connectionEvidence.push(alias.id);
    } else if (!hasCanonicalArtifact) {
      sourceMaterials.other.push(alias.id);
    }
  }

  const inventory = bundle ? catalogInventory?.catalogs?.[bundle.catalog_id] : null;
  // Count evidence travels with the counts so a public surface can say how far
  // the count is established (publisher inventory vs reviewed snapshot) and
  // name any publisher entries deliberately left out, with the recorded reason.
  const catalogCounts = inventory
    ? {
      discovered_records: inventory.discovered_records,
      normalized_records: inventory.normalized_records,
      evidence_class: inventory.evidence_class || null,
      excluded_records: inventory.excluded_records || 0,
      exclusions: (bundle.expected_inventory?.exclusions || [])
        .filter((entry) => Number.isInteger(entry?.count) && String(entry?.reason || '').trim())
        .map((entry) => ({ count: entry.count, reason: String(entry.reason).trim() })),
    }
    : null;

  return {
    id: pub.id,
    name: pub.display_name || pub.name,
    publisher: pub.owner || null,
    catalog_id: bundle?.catalog_id || null,
    alias_source_ids: [...aliasIds].sort(),
    source_materials: sourceMaterials,
    connection_evidence: [...new Set(connectionEvidence)].sort(),
    catalog_counts: catalogCounts,
  };
});

identities.sort((left, right) => left.id.localeCompare(right.id));

// Every publications[]/artifacts[] row must be reachable from exactly one
// identity: either it IS a canonical identity, or it is named as an alias or
// attached artifact of exactly one. Anything left over is an orphan the
// index failed to place — this must be empty for the index to be trustworthy.
const reachablePublicationIds = new Set(canonicalPublications.map((pub) => pub.id));
for (const identity of identities) for (const aliasId of identity.alias_source_ids) reachablePublicationIds.add(aliasId);
const orphanPublications = publications
  .filter((pub) => !reachablePublicationIds.has(pub.id))
  .map((pub) => pub.id);

const reachableArtifactIds = new Set(
  identities.flatMap((identity) => [
    ...identity.source_materials.primary,
    ...identity.source_materials.enrichment,
    ...identity.source_materials.reference,
    ...identity.source_materials.other,
    ...identity.connection_evidence,
  ]),
);
const orphanArtifacts = artifacts
  .filter((artifact) => !reachableArtifactIds.has(artifact.id))
  .map((artifact) => artifact.id);

const index = {
  schema_version: '1.0',
  generated_at: generatedAt(),
  identity_count: identities.length,
  identities,
  orphans: { publications: orphanPublications, artifacts: orphanArtifacts },
};

writeJsonAtomically(OUT, index);
console.log(`publication-identity-index: ${identities.length} canonical identities; ${orphanPublications.length} orphan publication(s); ${orphanArtifacts.length} orphan artifact(s).`);
if (orphanPublications.length) console.log(`  orphan publications: ${orphanPublications.join(', ')}`);
if (orphanArtifacts.length) console.log(`  orphan artifacts: ${orphanArtifacts.join(', ')}`);
