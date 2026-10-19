#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';
import { PROFILES } from './build-catalog-source-inventory.mjs';
import { cmmcInventory, raiInventory, fips199Inventory, fips200Inventory, rmfInventory, assessmentInventory, fedrampInventory, baselineProfileInventory, microsoftInventory, mobileInventory, iotInventory, nistZeroTrustInventory, dodZeroTrustInventory } from '../tools/importers/native-unit-inventories.mjs';
import { disaNativeInventories } from '../tools/importers/disa-native-inventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const acquisition = read('.local-agent/reference-export/inventory-acquisition.json');
const proofPath = 'data/curated/reference-catalogs/publisher-inventories.json';
const proofs = existsSync(join(ROOT, proofPath)) ? read(proofPath) : { schema_version: '1.0', boundary: 'Independent native publisher-unit identity inventories for explicitly declared catalog scopes and recorded editions; current publisher release freshness is separate.', catalogs: {} };
const results = []; const selected = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('--')));
function source(id) {
  const entry = acquisition.sources.find((value) => value.id === id);
  if (entry?.status !== 'ACQUIRED') throw new Error(`Missing acquired publisher input ${id}: ${entry?.reason || 'not recorded'}`);
  const bytes = readFileSync(join(ROOT, entry.path));
  assert.equal(bytes.length, entry.bytes, `${id} downloaded byte length`); assert.equal(hash(bytes), entry.sha256, `${id} downloaded checksum`);
  return { bytes, id, payload: () => JSON.parse(bytes), evidence: { source_id: id, url: entry.url, sha256: entry.sha256, byte_length: bytes.length, retrieved_at: entry.retrieved_at, evidence_kind: 'downloaded_publisher_bytes' } };
}
async function pdfText(entry) {
  const acquisitionPath = acquisition.sources.find((row) => row.id === entry.id).path;
  const cache = join(ROOT, `${acquisitionPath}.text.json`);
  if (existsSync(cache)) {
    const prior = JSON.parse(readFileSync(cache, 'utf8'));
    if (prior.source_sha256.replace(/^sha256:/, '') === entry.evidence.sha256.slice(7)) return prior.text;
    throw new Error(`PDF extraction cache differs from source bytes: ${entry.id}`);
  }
  const parser = new PDFParse({ data: new Uint8Array(entry.bytes) });
  try { const output = await parser.getText(); writeFileSync(cache, `${JSON.stringify({ source_sha256: entry.evidence.sha256, pages: output.pages.map((page) => ({ number: page.num, text: page.text })), text: output.text })}\n`); return output.text; }
  finally { await parser.destroy(); }
}
function compareInventory(id, inventory) {
  const profile = PROFILES[id]; const original = read(profile.file);
  const records = profile.select ? original.records.filter(profile.select) : original.records;
  const actual = new Set(records.map((record) => record.id)); const expected = new Set(inventory.record_ids);
  const missing = [...expected].filter((value) => !actual.has(value)); const extra = [...actual].filter((value) => !expected.has(value));
  const membershipDifferences = [];
  if (inventory.memberships && id === 'fedramp-rev5') for (const record of records) {
    const sourceIds = inventory.memberships[record.id] || [];
    const normalized = record.metadata?.controls || [];
    const missing = sourceIds.filter((value) => !normalized.includes(value)); const extra = normalized.filter((value) => !sourceIds.includes(value));
    if (missing.length || extra.length) membershipDifferences.push({ id: record.id, missing, extra });
  }
  if (inventory.memberships && id === 'nist-800-53b') {
    const controls = read('data/controls-800-53.json').records;
    for (const [baseline, ids] of Object.entries(inventory.memberships)) {
      const observed = controls.filter((record) => (record.metadata?.nist_800_53b_baselines || []).some((label) => new RegExp(`\\b${baseline} (?:IMPACT )?BASELINE$`).test(label))).map((record) => record.id);
      const missing = ids.filter((value) => !observed.includes(value)); const extra = observed.filter((value) => !ids.includes(value));
      if (missing.length || extra.length) membershipDifferences.push({ id: baseline, missing, extra });
    }
  }
  return { catalog_id: id, status: missing.length || extra.length || membershipDifferences.length ? 'MISMATCH' : 'RECONCILED', publisher_records: expected.size, normalized_records: actual.size, missing_ids: missing, extra_ids: extra, membership_differences: membershipDifferences };
}
async function audit(id, inputIds, parse) {
  if (selected.size && !selected.has(id)) return;
  try {
    const inputs = inputIds.map(source); const inventory = await parse(inputs);
    if (!inventory.record_count || new Set(inventory.record_ids).size !== inventory.record_count) throw new Error(`Invalid native identity inventory for ${id}`);
    const proof = { ...inventory, source_evidence: inputs.map((entry) => entry.evidence) };
    proofs.catalogs[id] = proof;
    const result = compareInventory(id, proof); results.push(result);
    console.log(`${id}: ${result.status}; publisher=${result.publisher_records}, normalized=${result.normalized_records}, missing=${result.missing_ids.length}, extra=${result.extra_ids.length}, membership_differences=${result.membership_differences.length}`);
  } catch (error) { results.push({ catalog_id: id, status: 'UNKNOWN', reason: error.message }); console.error(`${id}: UNKNOWN; ${error.message}`); }
}
await audit('cmmc-2', ['artifact-dod-cmmc-rule'], ([entry]) => cmmcInventory(entry.bytes.toString('utf8')));
await audit('dod-rai', ['artifact-dod-rai-toolkit'], ([entry]) => raiInventory(entry.bytes.toString('utf8')));
await audit('fedramp-rev5', ['artifact-fedramp-rev5'], ([entry]) => fedrampInventory(entry.bytes));
await audit('fips-199', ['artifact-nist-fips-199'], async ([entry]) => fips199Inventory(await pdfText(entry)));
await audit('fips-200', ['artifact-nist-fips-200'], async ([entry]) => fips200Inventory(await pdfText(entry)));
await audit('nist-800-37', ['artifact-nist-800-37-rev2'], async ([entry]) => rmfInventory(await pdfText(entry)));
await audit('nist-800-53a', ['artifact-nist-800-53'], ([entry]) => assessmentInventory(entry.payload()));
await audit('nist-800-53b', ['nist-80053b-low-profile', 'nist-80053b-moderate-profile', 'nist-80053b-high-profile', 'nist-80053b-privacy-profile'], (entries) => baselineProfileInventory(entries.map((entry) => ({ id: entry.id.match(/80053b-(.+)-profile/)[1].toUpperCase(), payload: entry.payload(), url: entry.evidence.url }))));
await audit('microsoft-zt-maturity', ['microsoft-zero-trust-maturity-questionnaire-v1-1'], ([entry]) => microsoftInventory(entry.bytes));
await audit('nist-mobile-threats', ['nist-mobile-threat-catalogue'], ([entry]) => mobileInventory(entry.payload()));
await audit('nist-iot-cybersecurity', ['nist-iot-requirements-80053-mapping-draft', 'nist-iot-requirements-csf11-mapping-draft'], (entries) => iotInventory(entries));
const nistInputs = acquisition.sources.filter((entry) => entry.catalog_ids?.includes('nist-zt') && entry.status === 'ACQUIRED').map((entry) => entry.id);
await audit('nist-zt', nistInputs, async (entries) => nistZeroTrustInventory({
  coreText: await pdfText(entries.find((entry) => entry.id === 'nist-sp-800-207')),
  cloudText: await pdfText(entries.find((entry) => entry.id === 'nist-sp-800-207a')),
  overviewHtml: entries.find((entry) => entry.id === 'nist-sp-1800-35').bytes.toString('utf8'),
  htmlSources: entries.filter((entry) => entry.id.startsWith('SP180035-')),
  mappingWorkbooks: entries.filter((entry) => /-mappings$/.test(entry.id)),
}));
if (!selected.size || selected.has('dod-zt')) {
  try {
    const paths = readdirSync(join(ROOT, 'data/curated/dod-zt/source-fragments')).filter((path) => path.endsWith('.json')).map((path) => `data/curated/dod-zt/source-fragments/${path}`);
    const captures = paths.map((path) => {
      const capture = read(path);
      for (const page of capture.pages) if (page.text_sha256 !== hash(Buffer.from(page.text))) throw new Error(`Retained publisher page text checksum differs: ${path}#${page.page}`);
      return capture;
    });
    const inventory = dodZeroTrustInventory(captures, read('data/curated/dod-zt/source-manifest.json').documents);
    inventory.capture_inputs = paths.map((path) => ({ path, sha256: hash(readFileSync(join(ROOT, path))), byte_length: readFileSync(join(ROOT, path)).length }));
    proofs.catalogs['dod-zt'] = inventory;
    const result = compareInventory('dod-zt', inventory); results.push(result); console.log(`dod-zt: ${result.status}; nativeIDs=${inventory.record_count}, missing=${result.missing_ids.length}, extra=${result.extra_ids.length}`);
  } catch (error) { results.push({ catalog_id: 'dod-zt', status: 'UNKNOWN', reason: error.message }); console.error(`dod-zt: UNKNOWN; ${error.message}`); }
}
if (!selected.size || selected.has('disa-stig') || selected.has('disa-srg')) {
  try {
    const disaManifest = read('data/disa-artifact-manifest.json');
    const inventories = await disaNativeInventories(ROOT, disaManifest, console.log);
    for (const [kind, inventory] of Object.entries(inventories)) {
      const id = `disa-${kind}`;
      if (disaManifest.retained_snapshot_union) {
        assert.deepEqual(inventory.record_ids, proofs.catalogs[id]?.current_snapshot?.record_ids, `${id}: current source inventory changed`);
        assert.equal(inventory.source_evidence[0].sha256, proofs.catalogs[id].current_snapshot.checksum);
      } else proofs.catalogs[id] = inventory;
      const retained = proofs.catalogs[id];
      const result = compareInventory(id, retained);
      result.current_snapshot_records = inventory.record_count;
      const normalized = read(PROFILES[id].file).records;
      const byId = new Map();
      for (const unit of retained.native_units) { const matches = byId.get(unit.id) || []; matches.push(unit); byId.set(unit.id, matches); }
      result.native_edition_mismatches = normalized.filter((record) => !(byId.get(record.id) || []).some((unit) => unit.benchmark_id === record.metadata?.benchmark_id && unit.edition === record.source?.version && unit.rule_id === record.rule_id)).map((record) => record.id);
      if (result.native_edition_mismatches.length) result.status = 'MISMATCH';
      results.push(result); console.log(`${id}: ${result.status}; nativeIDs=${inventory.record_count}, missing=${result.missing_ids.length}, extra=${result.extra_ids.length}, edition_mismatches=${result.native_edition_mismatches.length}`);
    }
  } catch (error) { for (const id of ['disa-stig','disa-srg']) results.push({ catalog_id: id, status: 'UNKNOWN', reason: error.message }); console.error(`DISA native inventory UNKNOWN: ${error.message}`); }
}

writeFileSync(join(ROOT, proofPath), `${JSON.stringify(proofs, null, 2)}\n`);
const receiptPath = join(ROOT, '.local-agent/reference-export/publisher-reconciliation.json');
const prior = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : { catalogs: [] };
const merged = new Map(prior.catalogs.map((row) => [row.catalog_id, row])); for (const row of results) merged.set(row.catalog_id, row);
writeFileSync(receiptPath, `${JSON.stringify({ purpose: proofs.boundary, catalogs: [...merged.values()] }, null, 2)}\n`);
if (results.some((row) => row.status !== 'RECONCILED')) process.exitCode = 1;
