import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { parseFedrampBaselineWorkbookSheets } from '../tools/importers/catalog-adapters-ext.mjs';
import { assertPublisherInventory } from '../scripts/lib/publisher-inventory.mjs';
import { assertPublisherVolume } from './helpers/publisher-volume.mjs';
import { buildFedramp2026FromBytes, normalizeFedramp2026 } from '../scripts/build-fedramp-2026-catalog.mjs';

const rules = JSON.parse(readFileSync('data/fedramp-2026-rules.json', 'utf8'));
const schema = JSON.parse(readFileSync('data/fedramp-2026-rules.schema.json', 'utf8'));
const transitions = JSON.parse(readFileSync('data/fedramp-transition-index.json', 'utf8'));
const artifacts = JSON.parse(readFileSync('data/official-artifact-registry.json', 'utf8'));
const catalog = JSON.parse(readFileSync('data/fedramp-2026-catalog.json', 'utf8'));
const sourceRegistry = JSON.parse(readFileSync('data/source-registry.json', 'utf8'));
const adapterRegistry = JSON.parse(readFileSync('data/profiles/source-adapter-registry.json', 'utf8'));

function rawRuleEntries(document) {
  return Object.entries(document.FRR).flatMap(([processId, process]) =>
    Object.entries(process.data).flatMap(([applicability, subsets]) =>
      Object.entries(subsets).flatMap(([subsetId, entries]) =>
        Object.entries(entries).map(([id, rule]) => ({
          id, rule, locator: `FRR.${processId}.data.${applicability}.${subsetId}.${id}`,
        })))));
}

test('every FedRAMP following-information bullet survives normalization literally', () => {
  const normalized = normalizeFedramp2026(rules);
  const byId = new Map(normalized.records.map((record) => [record.id, record]));
  const committed = new Map(catalog.records.map((record) => [record.id, record]));
  const bulletIds = [];
  for (const { id, rule, locator } of rawRuleEntries(rules)) {
    const expected = rule.following_information_bullets?.length ? rule.following_information_bullets : undefined;
    if (expected) bulletIds.push(id);
    for (const record of [byId.get(id), committed.get(id)]) {
      // Some publisher placeholders intentionally have no normalized record.
      if (!record) {
        assert.equal(expected, undefined, `${id} lost a published list`);
        continue;
      }
      assert.deepEqual(record.metadata.following_information_bullets, expected, id);
      assert.equal(record.source.locator, locator, id);
      assert.equal(record.source.version, rules.info.version, id);
      assert.equal(record.source.snapshot_date, rules.info.last_updated, id);
    }
  }
  assert.deepEqual(bulletIds.sort(), ['IEC-CSO-EFI', 'VER-EVA-EPA']);
  const labels = (id) => byId.get(id).metadata.following_information_bullets.map((bullet) => bullet.match(/^\*\*(N\d)\*\*/)?.[1]);
  assert.deepEqual(labels('VER-EVA-EPA'), ['N0', 'N1', 'N2', 'N3', 'N4', 'N5']);
  assert.deepEqual(labels('IEC-CSO-EFI'), ['N1', 'N2', 'N3', 'N4', 'N5']);
  assert.deepEqual(normalized.source_inventory, catalog.source_inventory);
  assert.equal(normalized.record_count, catalog.record_count);
  assert.deepEqual(normalized.records.map((record) => record.id), catalog.records.map((record) => record.id));
  assert.deepEqual(buildFedramp2026FromBytes(readFileSync('data/fedramp-2026-rules.json'), catalog).publisher_inventory, catalog.publisher_inventory);
});

test('every published FedRAMP following-information paragraph and note survives normalization', () => {
  const byId = new Map(catalog.records.map((record) => [record.id, record]));
  let discussions = 0;
  for (const { id, rule } of rawRuleEntries(rules)) {
    const record = byId.get(id);
    const expected = [rule.following_information || [], rule.notes || [], rule.note || []]
      .flat(Infinity).filter((value) => typeof value === 'string' && value.trim()).join('\n\n');
    if (record) assert.equal(record.discussion, expected, id);
    else assert.equal(expected, '', `${id} lost published discussion`);
    if (expected) discussions += 1;
  }
  assert.equal(catalog.records.filter((record) => record.discussion).length, discussions);
  assert.ok(discussions >= 108, 'retain the reviewed publisher discussion inventory');
});

test('FedRAMP lists retain whitespace and punctuation and stay absent on sparse rules', () => {
  const input = structuredClone(rules);
  const entries = rawRuleEntries(input);
  const ver = entries.find((entry) => entry.id === 'VER-EVA-EPA').rule;
  const iec = entries.find((entry) => entry.id === 'IEC-CSO-EFI').rule;
  ver.following_information_bullets = ['  **N1**: Exact, "quoted" text.  ', '**N2**: Second; unchanged.'];
  iec.following_information_bullets = [];
  const records = normalizeFedramp2026(input).records;
  assert.deepEqual(records.find((record) => record.id === 'VER-EVA-EPA').metadata.following_information_bullets, ver.following_information_bullets);
  assert.equal(Object.hasOwn(records.find((record) => record.id === 'IEC-CSO-EFI').metadata, 'following_information_bullets'), false);
  assert.equal(Object.hasOwn(records.find((record) => record.id === 'AFC-CSO-ACK').metadata, 'following_information_bullets'), false);
});

test('official FedRAMP 2026 rules validate against the official schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(rules), true, JSON.stringify(validate.errors));
  assert.ok(typeof rules.info.version === 'string' && rules.info.version.trim());
  assert.match(rules.info.last_updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isFinite(Date.parse(rules.info.last_updated)));
  assert.equal(transitions.source.version, rules.info.version);
  assert.equal(transitions.source.last_updated, rules.info.last_updated);
});

test('process status labels match the publisher and do not label the whole ruleset placeholder', () => {
  const expected = Object.entries(rules.FRR).map(([process_id, process]) => ({ process_id, status: process.info?.status || 'unknown' })).sort((a, b) => a.process_id.localeCompare(b.process_id));
  assert.deepEqual(transitions.process_statuses.map(({ process_id, status }) => ({ process_id, status })), expected);
  assert.ok(expected.some((process) => process.status !== 'placeholder'));
});

test('every curated legacy transition resolves to current rules and an action', () => {
  const resolvedRules = new Map(transitions.resolved_rules.map((rule) => [rule.rule_id, rule]));
  assert.equal(transitions.legacy_mappings.length, 10);
  assert.equal(resolvedRules.size, 28);
  for (const mapping of transitions.legacy_mappings) {
    assert.ok(mapping.summary.trim(), `${mapping.legacy_artifact_id} needs a summary`);
    assert.ok(mapping.action.trim(), `${mapping.legacy_artifact_id} needs a next action`);
    assert.ok(mapping.path_scope.includes('20x'), `${mapping.legacy_artifact_id} needs a 20x path`);
    assert.ok(mapping.path_scope.includes('rev5'), `${mapping.legacy_artifact_id} needs a Rev5 path`);
    assert.ok(mapping.current_artifact_ids.length > 0, `${mapping.legacy_artifact_id} needs current artifacts`);
    assert.ok(mapping.rule_ids.length > 0, `${mapping.legacy_artifact_id} needs governing rules`);
    for (const ruleId of mapping.rule_ids) {
      assert.ok(resolvedRules.has(ruleId), `${mapping.legacy_artifact_id} references unresolved ${ruleId}`);
    }
  }
});

test('legacy package semantics are tied to the current FedRAMP model', () => {
  const byLegacyId = new Map(
    transitions.legacy_mappings.map((mapping) => [mapping.legacy_artifact_id, mapping]),
  );
  assert.ok(byLegacyId.get('fedramp-legacy-ssp').rule_ids.includes('CPO-CSO-OVR'));
  assert.match(byLegacyId.get('fedramp-legacy-ssp').summary, /replaces the historical Rev5 SSP/i);
  assert.ok(byLegacyId.get('fedramp-legacy-sap').rule_ids.includes('IVV-IAS-SUM'));
  assert.ok(byLegacyId.get('fedramp-legacy-sar').rule_ids.includes('IVV-IAS-SUM'));
  assert.match(byLegacyId.get('fedramp-legacy-sap').summary, /does not require a separate SAP or SAR/i);
  assert.match(byLegacyId.get('fedramp-legacy-poam').summary, /not automatically an agency POA&M/i);
  assert.ok(byLegacyId.get('fedramp-legacy-integrated-inventory').rule_ids.includes('MAS-CSO-IIR'));
  assert.ok(byLegacyId.get('fedramp-legacy-conmon-deliverables').rule_ids.includes('CCM-OCR-AVL'));
});

test('all official legacy files and current schema rule connections are available', () => {
  assert.ok(transitions.legacy_assets.length >= 27, 'retain the reviewed minimum official legacy inventory');
  assert.equal(new Set(transitions.legacy_assets.map((asset) => asset.url)).size, transitions.legacy_assets.length);
  for (const asset of transitions.legacy_assets) {
    assert.match(asset.url, /^https:\/\/www\.fedramp\.gov\/legacy\/assets\//);
    assert.match(asset.url, /\.(?:docx|xlsx|pdf|zip)$/i);
  }
  for (const [artifactId, ruleIds] of Object.entries(transitions.current_artifact_rules)) {
    assert.ok(
      artifacts.artifacts.some((artifact) => artifact.artifact_id === artifactId),
      `missing current artifact ${artifactId}`,
    );
    for (const ruleId of ruleIds) {
      assert.ok(
        transitions.resolved_rules.some((rule) => rule.rule_id === ruleId),
        `${artifactId} references unresolved ${ruleId}`,
      );
    }
  }
});

test('FedRAMP baseline workbook parser preserves program-specific membership', () => {
  const sheets = [
    ['Low Baseline', [null, null, 'AC-1'], [null, null, 'AC-2 (1)']],
    ['Moderate Baseline', [null, null, 'AU-2']],
    ['High Baseline', [null, null, 'SC-7 (3)']],
    ['LI-SaaS Baseline', [null, 'IA-2 (1)']],
  ].map(([sheet, ...data]) => ({ sheet, data }));
  assert.deepEqual(parseFedrampBaselineWorkbookSheets(sheets), {
    LOW: ['AC-1', 'AC-2.1'],
    MODERATE: ['AU-2'],
    HIGH: ['SC-7.3'],
    'LI-SAAS': ['IA-2.1'],
  });
});

test('current FedRAMP rules and historical Rev. 5 remain distinct source families', () => {
  assert.equal(catalog.source_version, rules.info.version);
  assertPublisherVolume('fedramp-2026', 'data/fedramp-2026-catalog.json', catalog.record_count);
  const inventory = assertPublisherInventory('fedramp-2026', rules, catalog.records);
  const excluded = new Set(inventory.excluded.map((entry) => entry.id));
  const rawCounts = { control_context: 0, definitions: Object.keys(rules.FRD.data.all).length, rules: 0, key_security_indicators: 0 };
  for (const [family, controls] of Object.entries(rules.CTL)) for (const id of Object.keys(controls)) {
    if (!excluded.has(`CTL.${family}.${id}`)) rawCounts.control_context += 1;
  }
  for (const [process, value] of Object.entries(rules.FRR)) for (const [applicability, subsets] of Object.entries(value.data)) for (const [subset, entries] of Object.entries(subsets)) for (const id of Object.keys(entries)) {
    if (!excluded.has(`FRR.${process}.data.${applicability}.${subset}.${id}`)) rawCounts.rules += 1;
  }
  for (const [group, value] of Object.entries(rules.KSI)) for (const id of Object.keys(value.indicators)) {
    if (!excluded.has(`KSI.${group}.indicators.${id}`)) rawCounts.key_security_indicators += 1;
  }
  assert.deepEqual(catalog.source_inventory, {
    ...rawCounts,
    total: inventory.eligible_count,
  });
  assert.deepEqual(
    [...new Set(catalog.records.map((record) => record.type))].sort(),
    ['control_context', 'definition', 'key_security_indicator', 'rule'],
  );
  const current = sourceRegistry.publications.find((entry) => entry.id === 'fedramp-2026-rules');
  const historical = sourceRegistry.publications.find((entry) => entry.id === 'fedramp-rev5');
  assert.equal(current.lifecycle_status, 'active');
  assert.equal(current.graph_eligible, true);
  assert.equal(historical.lifecycle_status, 'historical');
  const currentBundle = sourceRegistry.catalog_source_bundles.find((entry) => entry.catalog_id === 'fedramp-2026');
  const historicalBundle = sourceRegistry.catalog_source_bundles.find((entry) => entry.catalog_id === 'fedramp-rev5');
  assert.deepEqual(currentBundle.primary_artifact_ids, ['artifact-fedramp-2026-rules']);
  assert.ok(!historicalBundle.enrichment_artifact_ids.includes('artifact-fedramp-2026-rules'));
  const currentAdapter = adapterRegistry.adapters.find((entry) => entry.adapter_id === 'fedramp-consolidated-rules-json');
  assert.deepEqual(currentAdapter.catalog_ids, ['fedramp-2026']);
  assert.deepEqual(currentAdapter.produced_profile_ids, [
    'record.control_context',
    'record.definition',
    'record.key_security_indicator',
    'record.rule',
  ]);
});
