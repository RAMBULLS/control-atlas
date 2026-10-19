#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomically } from './lib/write-json-atomically.mjs';
import { REFERENCE_CATALOG_SOURCES } from '../tools/importers/reference-catalog-adapter.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const adapters = read('data/profiles/source-adapter-registry.json');
if (!adapters.adapters.some((entry) => entry.adapter_id === 'nist-reference-catalogs')) {
  adapters.adapters.push({
    adapter_id: 'nist-reference-catalogs', adapter_version: '1.0.0',
    catalog_ids: REFERENCE_CATALOG_SOURCES.map((source) => source.id),
    accepted_source_types: ['spreadsheet', 'html'],
    produced_profile_ids: ['record.requirement', 'record.category', 'record.function'],
    field_transformations: ['Preserve native identifiers, captured source text, source fragments, edition and publisher hierarchy from the official Core workbook and security-measure table.'],
    relationship_rules: ['Publisher containment only; informative-reference prose is retained as supporting content. No inferred crosswalks.'],
    fixture_set: 'tests/reference-catalogs.test.mjs', failure_policy: 'fail_closed',
    source_policy: 'Verify actual downloaded bytes and complete identifier inventories. Keep CSF 1.1 separate from CSF 2.0 and retain unmapped critical-software measures.',
  });
}
writeJsonAtomically(join(root, 'data/profiles/source-adapter-registry.json'), adapters);
const spine = read('data/curated/tree-spine.json');
spine.catalogLimbs['nist-csf-1.1'] = 'atlas:LIMB-COMPLIANCE';
spine.catalogLimbs['nist-critical-software'] = 'atlas:LIMB-IMPLEMENTATION';
writeJsonAtomically(join(root, 'data/curated/tree-spine.json'), spine);
const authority = read('data/curated/authority-spine.json');
for (const source of REFERENCE_CATALOG_SOURCES) {
  if (authority.publications.some((entry) => entry.catalog_id === source.id)) continue;
  authority.publications.push({ catalog_id: source.id, mandate: 'issued_without_federal_mandate', primary_authority: null, also_required_by: [],
    publication_type: source.id === 'nist-csf-1.1' ? 'Historical outcome framework' : 'Security-measure guidance',
    mandate_note: 'This reference catalog records the cited NIST publication. It does not independently establish a current mandate or determine applicability to an organization.',
    source_refs: [{ source_id: source.id, ref_type: 'primary', locator: source.landing }] });
}
writeJsonAtomically(join(root, 'data/curated/authority-spine.json'), authority);
const reviews = read('data/source-review-manifest.json');
reviews.review_policy.statement = 'Automated source comparison and AI-assisted engineering review are accepted without a human-review prerequisite. Dispositions require source-linked evidence, separate currentness checks and explicit limits; parser or count reconciliation alone is not whole-corpus semantic proof.';
for (const source of REFERENCE_CATALOG_SOURCES) {
  reviews.catalogs = reviews.catalogs.filter((entry) => entry.catalog_id !== source.id);
  const records = read(`data/${source.file}`).records;
  reviews.catalogs.push({
    catalog_id: source.id, reviewed_at: '2026-10-18', semantic_content_review: 'reviewed_no_known_mismatch',
    locator_only_review: 'none', upstream_currentness_review: source.lifecycle === 'superseded' ? 'superseded' : 'current_as_checked',
    representative_samples: [records[0], records[Math.floor(records.length / 2)], records.at(-1)].map((record) => ({ record_id: record.id,
      review_note: `AI-assisted comparison with official publisher content and automated source-text, identifier and hierarchy reconciliation. Source: ${record.locator}` })),
    official_sources: [{ url: source.landing, supports: 'Official publication identity and catalog download or security-measure table.' }],
    rationale: 'Official source bytes and source-linked content are compared with the normalized identifiers, captured text and publisher hierarchy. Automated regression checks retain the full inventory; the stated semantic samples do not establish unrelated catalog coverage.',
    follow_up: null,
  });
}
reviews.catalogs.sort((a, b) => a.catalog_id.localeCompare(b.catalog_id));
writeJsonAtomically(join(root, 'data/source-review-manifest.json'), reviews);
const contract = read('data/source-refresh-contract.json');
if (!contract.other_remote_adapters.some((entry) => entry.script === 'fetch-reference-catalogs.mjs')) {
  contract.other_remote_adapters.push({ script: 'fetch-reference-catalogs.mjs', source_ids: REFERENCE_CATALOG_SOURCES.map((source) => source.id), cadence: 'on_demand', conditional_policy: 'strict' });
}
writeJsonAtomically(join(root, 'data/source-refresh-contract.json'), contract);
console.log('Reference catalog source, editorial navigation and evidence-based automated review contracts synchronized.');
