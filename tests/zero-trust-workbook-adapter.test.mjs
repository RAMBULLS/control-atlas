import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('committed Zero Trust structured sources reconcile without synthetic records', () => {
  const manifest = JSON.parse(readFileSync('data/curated/nist-zt/structured-source-manifest.json', 'utf8'));
  assert.equal(manifest.reconciliation.workbooks_discovered, 5);
  assert.equal(manifest.reconciliation.workbooks_ingested, 5);
  assert.equal(manifest.reconciliation.workbooks_failed, 0);
  assert.equal(manifest.reconciliation.synthetic_records, 0);
  assert.ok(manifest.reconciliation.mapping_records > 1_000);
  assert.ok(manifest.reconciliation.questionnaire_records >= 50);
  assert.ok(manifest.sources.every((entry) => /^sha256:[a-f0-9]{64}$/.test(entry.sha256)));
  assert.ok(manifest.sources.every((entry) => entry.byte_length > 0 && entry.parsed_records > 0));
});

test('Zero Trust mappings and questions retain workbook cell provenance', () => {
  const mappings = JSON.parse(readFileSync('data/curated/nist-zt/mappings.json', 'utf8')).records;
  const questions = JSON.parse(readFileSync('data/curated/nist-zt/microsoft-questionnaire.json', 'utf8')).records;
  assert.ok(mappings.every((entry) => entry.target_id && entry.source_fragments.length >= 4));
  assert.ok(mappings.every((entry) => entry.source_fragments.every((fragment) => /^[A-Z]+\d+$/.test(fragment.cell))));
  assert.ok(questions.every((entry) => entry.question && entry.answer_options.length > 0));
  assert.ok(questions.every((entry) => entry.source_fragments.some((fragment) => fragment.field === 'question')));
});

test('supportive mapping parser preserves both directions, all properties and explicit compounds', async () => {
  const { relationDetails } = await import('../tools/importers/zero-trust-workbook-adapter.mjs');
  assert.equal(relationDetails('Supported by (integral to) CA-7').direction, 'component_supported_by_target');
  assert.equal(relationDetails('Is supported by (precedes) PR.AA-01').strength, 'precedes');
  assert.equal(relationDetails('Supports (example of) PR.AA-01').strength, 'example');
  assert.deepEqual(relationDetails('Supports (integral to) and Is supported by (precedes) DE.CM-1').relationship_clauses.map((c) => [c.relationship_type, c.property]), [
    ['supports', 'integral to'], ['supported_by', 'precedes'],
  ]);
  assert.equal(relationDetails('Equivalent DE.CM-1').direction, 'equivalent');
  for (const raw of ['PR.PS-01 (already listed)', 'Also maps to PR.PS-01 (same as previous row)', 'Unknown relation CA-7']) {
    assert.equal(relationDetails(raw).relationship_parse_status, 'unresolved');
    assert.deepEqual(relationDetails(raw).relationship_clauses, []);
  }
});

test('every retained workbook row agrees with the parser and retains original cell checksums', async () => {
  const { relationDetails } = await import('../tools/importers/zero-trust-workbook-adapter.mjs');
  const { createHash } = await import('node:crypto');
  const doc = JSON.parse(readFileSync('data/curated/nist-zt/mappings.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('data/curated/nist-zt/structured-source-manifest.json', 'utf8'));
  assert.equal(doc.records.length, manifest.reconciliation.mapping_records);
  assert.equal(new Set(doc.records.map((row) => row.id)).size, doc.records.length);
  for (const row of doc.records) {
    const expected = relationDetails(row.relationship);
    assert.equal(row.direction, expected.direction, row.locator);
    assert.equal(row.strength, expected.strength, row.locator);
    assert.deepEqual(row.relationship_clauses, expected.relationship_clauses, row.locator);
    for (const fragment of row.source_fragments) {
      const checksum = `sha256:${createHash('sha256').update(fragment.text).digest('hex')}`;
      assert.equal(fragment.checksum, checksum, `${row.id}: ${fragment.cell}`);
    }
  }
});

test('catalog normalization never defaults unresolved workbook shorthand to a support assertion', async () => {
  const { buildNistZeroTrustCatalog } = await import('../tools/importers/framework-adapters.mjs');
  const { relationDetails } = await import('../tools/importers/zero-trust-workbook-adapter.mjs');
  const mappings = JSON.parse(readFileSync('data/curated/nist-zt/mappings.json', 'utf8')).records;
  const doc = buildNistZeroTrustCatalog('2026-01-01', 'data/curated/nist-zt');
  const unresolved = doc.records.flatMap((record) => record.metadata?.unresolved_mappings || []);
  assert.deepEqual(unresolved.map((row) => row.id).sort(), mappings.filter((row) => relationDetails(row.relationship).direction === 'unresolved').map((row) => row.id).sort());
  const assertions = doc.records.flatMap((record) => record.metadata?.relationships || []);
  const byLocator = new Map();
  for (const assertion of assertions) for (const ref of assertion.publisher_assertions || []) {
    const types = byLocator.get(ref.locator) || new Set(); types.add(assertion.relationship_type); byLocator.set(ref.locator, types);
  }
  for (const row of mappings.filter((row) => /^Supported by\b/i.test(row.relationship))) {
    assert.ok(byLocator.get(row.locator)?.has('supported_by'), row.locator);
    assert.ok(!byLocator.get(row.locator)?.has('supports'), row.locator);
  }
  for (const row of unresolved) assert.ok(!byLocator.has(row.locator), row.locator);
});


test('record mapping targets retain properties and explicitly identify unresolved source cells', async () => {
  const { buildNistZeroTrustCatalog } = await import('../tools/importers/framework-adapters.mjs');
  const doc = buildNistZeroTrustCatalog('2026-01-01', 'data/curated/nist-zt');
  const targets = doc.records.flatMap((record) => record.metadata?.mapping_targets || []);
  const mappings = JSON.parse(readFileSync('data/curated/nist-zt/mappings.json', 'utf8')).records;
  assert.equal(targets.length, mappings.length);
  assert.equal(targets.filter((target) => target.relationship_parse_status === 'unresolved').length,
    mappings.filter((row) => row.direction === 'unresolved').length);
  assert.ok(targets.some((target) => target.relationship_clauses.some((clause) => clause.property === 'precedes')));
  assert.ok(targets.filter((target) => target.relationship_parse_status === 'unresolved')
    .every((target) => !target.relationship_clauses.length));
});
