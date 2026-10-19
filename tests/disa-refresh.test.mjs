import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { disaContentDue, disaInventoryChecksum, verifyDisaSnapshot, mergeDisaSnapshot } from '../scripts/lib/disa-refresh.mjs';
import { preserveDisaConnectionIds, preserveDisaRecordHistory } from '../scripts/lib/disa-publication-reconciliation.mjs';
import { disaInventoryCheckedToday, hydrateArtifacts, loadHydrationResolutions } from '../scripts/hydrate-artifacts.mjs';

const html = '<a href="U_SRG-STIG_Library_October_2026.zip">October</a>';
test('artifact hydration uses the accepted compilation URL and attests actual local bytes without changing archive retrieval dates', async () => {
  mkdirSync('.local', { recursive: true }); const root = mkdtempSync('.local/disa-hydration-test-');
  const put = (path, document) => writeFileSync(join(root, path), JSON.stringify(document));
  try {
    mkdirSync(join(root, 'data')); const url = 'https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/U_SRG-STIG_Library_October_2026.zip';
    const retrieved = '2026-10-07'; const id = 'artifact-disa-stig-library'; const document = { records: [{ id: 'V-001' }] };
    const { createHash } = await import('node:crypto'); const bytes = Buffer.from(JSON.stringify(document));
    put('data/stig-rules.json', document);
    put('data/source-registry.json', { artifacts: [{ id, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, byte_length: 1, retrieved_at: retrieved }] });
    put('data/disa-artifact-manifest.json', { compilation_url: url, artifact_url: url });
    const resolutions = loadHydrationResolutions(root).filter((row) => row.id === id);
    assert.equal(resolutions[0].url, url);
    await hydrateArtifacts({ root, only: id, resolutions, fetchImpl: () => { throw Error('Local projections must not download a binary archive'); } });
    const artifact = JSON.parse(readFileSync(join(root, 'data/source-registry.json'))).artifacts[0];
    assert.equal(artifact.artifact_url, url); assert.equal(artifact.byte_length, bytes.length); assert.equal(artifact.retrieved_at, retrieved);
    const receipt = JSON.parse(readFileSync(join(root, 'data/artifact-hydration-manifest.json'))).results[0];
    assert.equal(receipt.http, 'local'); assert.equal(receipt.retrieved_at, retrieved);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('changed publisher text within the same named edition retains both captures while retrieval-date changes alone do not duplicate history', () => {
  const old = { id: 'V-001', check_text: 'Prior native text', source: { version: 'V1R1', snapshot_date: '2026-10-01' }, metadata: { benchmark_id: 'one' } };
  const fresh = { ...old, check_text: 'Corrected native text', source: { ...old.source, snapshot_date: '2026-10-18' } };
  const merged = preserveDisaRecordHistory([old], [fresh]);
  assert.equal(merged[0].metadata.previous_editions[0].check_text, old.check_text);
  assert.equal(merged[0].check_text, fresh.check_text);
  assert.deepEqual(preserveDisaRecordHistory(merged, [{ ...fresh, source: { ...fresh.source, snapshot_date: '2026-10-19' } }])[0].metadata.previous_editions, merged[0].metadata.previous_editions);
});
test('hydration accepts only a current matching inventory check and never upgrades old archive bytes to fresh retrieval', () => {
  const manifest = { retrieval_timestamp: '2026-10-07T00:00:00Z', discovery_content_checksum: disaInventoryChecksum(html) };
  manifest.inventory_check = { checked_at: '2026-10-18T00:00:00Z', content_checksum: manifest.discovery_content_checksum, retained_content_retrieved_at: manifest.retrieval_timestamp, status: 'no_declared_inventory_change', check_tier: 'publisher_directory_inventory', publisher_bytes_retrieved: false };
  assert.equal(disaInventoryCheckedToday(manifest, '2026-10-18'), true);
  assert.equal(disaInventoryCheckedToday(manifest, '2026-10-19'), false);
  for (const change of [{ publisher_bytes_retrieved: true }, { content_checksum: `sha256:${'b'.repeat(64)}` }, { retained_content_retrieved_at: '2026-10-08' }, { status: 'failed' }]) assert.equal(disaInventoryCheckedToday({ ...manifest, inventory_check: { ...manifest.inventory_check, ...change } }, '2026-10-18'), false);
  assert.equal(disaInventoryCheckedToday({ ...manifest, inventory_check: { ...manifest.inventory_check, checked_at: '2027-01-01T00:00:00Z' } }, '2027-01-01'), false);
});
test('returning publisher records clear only Atlas absence warnings and retain native warnings and IDs', () => {
  const row = { source_catalog: 'disa-stig', source_id: 'V-001', target_catalog: 'disa-cci', target_id: 'CCI-000001', relationship_type: 'references', source_locator: 'native.xml#V-001' };
  const absent = preserveDisaConnectionIds([row], []);
  const returned = preserveDisaConnectionIds(absent, [row]);
  assert.equal(returned[0].warning, undefined);
  assert.equal(returned[0].atlas_connection_id, absent[0].atlas_connection_id);
  assert.equal(preserveDisaConnectionIds([{ ...row, warning: 'Native publisher qualifier' }], [row])[0].warning, 'Native publisher qualifier');
  const record = { id: 'V-001', metadata: { source_warnings: ['Native publisher qualifier'] } };
  const historical = preserveDisaRecordHistory([record], []);
  const restored = preserveDisaRecordHistory(historical, historical);
  assert.deepEqual(restored[0].metadata.source_warnings, ['Native publisher qualifier']);
  assert.equal(restored[0].metadata.current_snapshot_presence, true);
});
test('weekly discovery acquires changed inventories and quarterly content without pretending old bytes were freshly downloaded', () => {
  const accepted = { retrieval_timestamp: '2026-10-07T00:00:00Z', discovery_content_checksum: disaInventoryChecksum(html) };
  assert.equal(disaContentDue(accepted, html, new Date('2026-10-18T00:00:00Z')), false);
  assert.equal(disaContentDue(accepted, `${html}new file`, new Date('2026-10-18T00:00:00Z')), true);
  assert.equal(disaContentDue(accepted, html, new Date('2027-01-01T00:00:00Z')), true);
  assert.equal(disaContentDue({}, html), true);
});

function fixture() {
  const inventories = {}; const current = { relationships: { relationships: [] } };
  for (const kind of ['stig', 'srg']) {
    const id = kind === 'stig' ? 'V-001' : 'V-002';
    const unit = { id, benchmark_id: `benchmark-${kind}`, edition: 'V2R1', rule_id: `SV-${id}`, locator: `${kind}.xml#${id}`, source_url: 'https://dl.dod.cyber.mil/example.zip', source_checksum: `sha256:${'a'.repeat(64)}`, cci_ids: ['CCI-000001'] };
    inventories[kind] = { record_ids: [id], record_count: 1, native_units: [unit], source_evidence: [], native_files: [], exclusions: [] };
    current[kind] = { records: [{ id, rule_id: unit.rule_id, source: { version: unit.edition }, metadata: { benchmark_id: unit.benchmark_id } }] };
    current.relationships.relationships.push({ source_catalog: `disa-${kind}`, source_id: id, target_catalog: 'disa-cci', target_id: 'CCI-000001', relationship_type: 'references', source_locator: unit.locator,
      source_citations: [{ source_url: unit.source_url, checksum: unit.source_checksum, source_locator: unit.locator, source_version: unit.edition, native_rule_id: unit.rule_id, benchmark_id: unit.benchmark_id }] });
  }
  return { current, inventories };
}

test('fresh normalization must match independent native identities, editions, assertions and every citation', () => {
  const { current, inventories } = fixture();
  verifyDisaSnapshot(current, inventories, new Set(['CCI-000001']));
  const wrongEdition = structuredClone(current); wrongEdition.stig.records[0].source.version = 'V1R1';
  assert.throws(() => verifyDisaSnapshot(wrongEdition, inventories, new Set(['CCI-000001'])), /Wrong native DISA edition/);
  const lost = structuredClone(current); lost.relationships.relationships[0].source_citations = [];
  assert.throws(() => verifyDisaSnapshot(lost, inventories, new Set(['CCI-000001'])), /Lost or altered native citation/);
  assert.throws(() => verifyDisaSnapshot(current, inventories, new Set()), /Missing canonical CCI/);
  const fabricated = structuredClone(current); fabricated.relationships.relationships[0].relationship_type = 'supports';
  assert.throws(() => verifyDisaSnapshot(fabricated, inventories, new Set(['CCI-000001'])), /references/);
});

test('normal refresh preserves prior records, complete old editions, connection IDs and citations across repeat refreshes', () => {
  const { current, inventories } = fixture();
  const previous = structuredClone(current);
  previous.stig.records[0].source.version = 'V1R1';
  previous.stig.records.push({ id: 'V-OLD', source: { version: 'V1R1' }, metadata: { benchmark_id: 'old' } });
  previous.relationships.relationships.forEach((row, index) => { row.atlas_connection_id = `edge:stig-srg-to-cci:${index + 50}`; });
  const proofs = { catalogs: {} };
  for (const kind of ['stig', 'srg']) proofs.catalogs[`disa-${kind}`] = structuredClone(inventories[kind]);
  proofs.catalogs['disa-stig'].native_units.push({ id: 'V-OLD' });
  const manifest = { compilation_url: 'https://dl.dod.cyber.mil/example.zip', checksum: `sha256:${'a'.repeat(64)}` };
  const merged = mergeDisaSnapshot(previous, current, proofs, inventories, manifest);
  assert.equal(merged.result.stig.records.find((row) => row.id === 'V-OLD').metadata.current_snapshot_presence, false);
  assert.equal(merged.result.stig.records.find((row) => row.id === 'V-001').metadata.previous_editions[0].source.version, 'V1R1');
  for (const row of previous.relationships.relationships) assert.equal(merged.result.relationships.relationships.find((entry) => entry.source_id === row.source_id).atlas_connection_id, row.atlas_connection_id);
  const repeated = mergeDisaSnapshot(merged.result, current, merged.proofs, inventories, manifest);
  assert.deepEqual(repeated.result, merged.result);
});
