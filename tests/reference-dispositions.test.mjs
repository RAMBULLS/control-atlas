import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveRedundantPublisherReference, rejectInvalidPublisherIdentifier } from '../tools/importers/reference-dispositions.mjs';
import { parseRegistryMarkingIdentity } from '../scripts/fetch-nara-cui-registry.mjs';

const row = (id, number, extra = {}) => ({ id, locator: `official.xlsx#sheet=One&row=${number}`, mapping_kind: 'csf_2', collaborator: 'Publisher', architecture_component: 'PEP', product: 'Product', target_id: 'PR.PS-01', relationship_parse_status: 'explicit', source_fragments: [{ source_key: 'publisher-workbook' }], ...extra });
test('redundant notes point to all earlier native assertions without choosing a direction', () => {
  const first = row('first', 2, { relationship: 'Supports (integral to)' });
  const second = row('second', 3, { relationship: 'Is supported by (precedes)' });
  const duplicate = row('duplicate', 4, { relationship: 'PR.PS-01 (already listed)', relationship_parse_status: 'unresolved' });
  assert.deepEqual(resolveRedundantPublisherReference(duplicate, [first, second, duplicate]).mapping_ids, ['first', 'second']);
  assert.equal(resolveRedundantPublisherReference(duplicate, [row('different', 2, { product: 'Other' }), duplicate]), null);
  assert.equal(resolveRedundantPublisherReference({ ...duplicate, relationship: 'unclear' }, [first]), null);
});
test('same-as-previous requires the exact earlier row and edition/context', () => {
  const duplicate = row('dup', 4, { relationship: 'Also maps to PR.PS-01 (same as previous row)', relationship_parse_status: 'unresolved' });
  assert.equal(resolveRedundantPublisherReference(duplicate, [row('far', 2)]), null);
  assert.equal(resolveRedundantPublisherReference(duplicate, [row('wrong-edition', 3, { mapping_kind: 'csf_1_1' })]), null);
  assert.deepEqual(resolveRedundantPublisherReference(duplicate, [row('previous', 3)]).mapping_ids, ['previous']);
});
test('all six retained workbook shorthand notes have source-linked duplicate dispositions', () => {
  const mappings = JSON.parse(readFileSync('data/curated/nist-zt/mappings.json')).records;
  const notes = mappings.filter((entry) => entry.relationship_parse_status === 'unresolved');
  assert.equal(notes.length, 6);
  for (const note of notes) assert.ok(resolveRedundantPublisherReference(note, mappings)?.mapping_ids.length, note.id);
});
test('invalid publisher identifiers are rejected without guessed corrections', () => {
  const mapping = { target_catalog: 'nist-csf-1.1', target_id: 'PT.PT-1', source_locator: 'official.xlsx#row=4' };
  const ids = new Set(['PR.PT-1']);
  assert.throws(() => rejectInvalidPublisherIdentifier(mapping, ids), /complete attested/);
  const rejection = rejectInvalidPublisherIdentifier(mapping, ids, { source_sha256: `sha256:${createHash('sha256').update(JSON.stringify([...ids])).digest('hex')}`, record_ids: [...ids], source_url: 'https://www.nist.gov/' });
  assert.equal(rejection.status, 'rejected_invalid_publisher_identifier');
  assert.equal(rejection.replacement_id, undefined);
  assert.equal(rejectInvalidPublisherIdentifier({ ...mapping, target_id: 'PR.PT-1' }, ids), null);
});
test('NARA marking-table identity preserves a listed category despite a broken detail URL', () => {
  const html = '<table><tr><td><a href="/cui/registry/category-detail/cui/registry/category-detail/privileged-safety-info">Privileged Safety Information</a></td><td></td><td>CUI</td><td>PSI</td><td>Defense</td></tr></table>';
  const item = parseRegistryMarkingIdentity(html, 'privileged-safety-info');
  assert.equal(item.title, 'Privileged Safety Information'); assert.equal(item.category_marking, 'PSI'); assert.equal(item.designation, 'CUI-BASIC');
  assert.deepEqual(item.authorities, []); assert.equal(item.last_modified, null);
  assert.throws(() => parseRegistryMarkingIdentity('<table></table>', 'missing'), /0 identities/);
});
