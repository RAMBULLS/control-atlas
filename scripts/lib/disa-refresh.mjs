import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourceUnitInventory } from '../../tools/importers/native-unit-inventories.mjs';
import { preserveDisaRecordHistory, preserveDisaConnectionIds } from './disa-publication-reconciliation.mjs';

const distinct = (rows) => [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()];
export const disaInventoryChecksum = (html) => `sha256:${createHash('sha256').update(html).digest('hex')}`;

/** Weekly discovery; a changed index or new publisher quarter requires content acquisition. */
export function disaContentDue(manifest, html, now = new Date()) {
  const prior = new Date(manifest?.retrieval_timestamp);
  if (!manifest?.discovery_content_checksum || !Number.isFinite(prior.getTime())) return true;
  if (prior.getUTCFullYear() !== now.getUTCFullYear() || Math.floor(prior.getUTCMonth() / 3) !== Math.floor(now.getUTCMonth() / 3)) return true;
  return manifest.discovery_content_checksum !== disaInventoryChecksum(html);
}

const pair = (row) => JSON.stringify([row.source_catalog, row.source_id, row.target_id]);
const signature = (unit) => JSON.stringify([unit.source_url, unit.source_checksum, unit.locator, unit.edition, unit.rule_id, unit.benchmark_id]);
export function verifyDisaSnapshot(result, inventories, cciIds) {
  const pairs = new Map();
  for (const kind of ['stig', 'srg']) {
    const inventory = inventories[kind];
    const byId = new Map();
    for (const unit of inventory.native_units) { const units = byId.get(unit.id) || []; units.push(unit); byId.set(unit.id, units); }
    assert.deepEqual(result[kind].records.map((row) => row.id).sort(), inventory.record_ids.slice().sort(), `${kind}: native inventory identity mismatch`);
    for (const record of result[kind].records) assert.ok(byId.get(record.id)?.some((unit) => unit.benchmark_id === record.metadata.benchmark_id && unit.edition === record.source.version && unit.rule_id === record.rule_id), 'Wrong native DISA edition');
    for (const unit of inventory.native_units) for (const cci of unit.cci_ids || []) {
      assert.ok(cciIds.has(cci), `Missing canonical CCI endpoint: ${cci}`);
      const key = pair({ source_catalog: `disa-${kind}`, source_id: unit.id, target_id: cci });
      const citations = pairs.get(key) || new Set(); citations.add(signature(unit)); pairs.set(key, citations);
    }
  }
  assert.equal(new Set(result.relationships.relationships.map(pair)).size, result.relationships.relationships.length, 'Duplicate native connections');
  assert.deepEqual(result.relationships.relationships.map(pair).sort(), [...pairs.keys()].sort(), 'Missing or fabricated native CCI assertion');
  for (const row of result.relationships.relationships) {
    assert.equal(row.target_catalog, 'disa-cci'); assert.equal(row.relationship_type, 'references');
    const citations = row.source_citations.map((citation) => JSON.stringify([citation.source_url, citation.checksum, citation.source_locator, citation.source_version, citation.native_rule_id, citation.benchmark_id]));
    assert.deepEqual([...new Set(citations)].sort(), [...pairs.get(pair(row))].sort(), 'Lost or altered native citation');
  }
}

export function mergeDisaSnapshot(previous, current, proofs, native, manifest) {
  const nextProofs = { ...proofs, catalogs: { ...proofs.catalogs } };
  const result = { ...current };
  for (const kind of ['stig', 'srg']) {
    result[kind] = { ...current[kind], records: preserveDisaRecordHistory(previous[kind].records, current[kind].records) };
    const old = proofs.catalogs[`disa-${kind}`]; const fresh = native[kind];
    assert.ok(old, 'Existing DISA publisher proof is required');
    const units = distinct([...old.native_units, ...fresh.native_units]);
    const proof = { ...sourceUnitInventory(units, 'Union of independently verified publisher snapshots. Current identities are listed separately; prior native editions and citations remain retained without inferred retirement.', distinct([...old.exclusions, ...fresh.exclusions])),
      source_evidence: distinct([...old.source_evidence, ...fresh.source_evidence]), native_files: distinct([...old.native_files, ...fresh.native_files]),
      current_snapshot: { compilation_url: manifest.compilation_url, checksum: manifest.checksum, record_count: fresh.record_count, record_ids: fresh.record_ids }, native_occurrences: units.length };
    assert.deepEqual(result[kind].records.map((row) => row.id).sort(), proof.record_ids.slice().sort(), 'Native current/historical identities must reconcile');
    nextProofs.catalogs[`disa-${kind}`] = proof;
  }
  result.relationships = { ...current.relationships, relationships: preserveDisaConnectionIds(previous.relationships.relationships, current.relationships.relationships) };
  return { result, proofs: nextProofs };
}
