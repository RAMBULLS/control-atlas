import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRegistryInventory, assertSearchInventory } from '../tools/lib/assurance-inventory.mjs';
const search = () => ({ queries: [{ id: 'exact', query: 'AC-2', top_k: 1, expected_ids: ['nist-800-53:AC-2'] }, { id: 'negative', query: 'banana bread recipe', top_k: 5, expected_ids: [], expect_no_results: true }] });
test('search inventory accepts explicit positive and intentional negative scopes', () => assert.doesNotThrow(() => assertSearchInventory(search())));
for (const [name, mutate] of [
  ['empty', b => { b.queries = []; }],
  ['duplicate', b => b.queries.push(b.queries[0])],
  ['fractional top-k', b => { b.queries[0].top_k = 1.5; }],
  ['zero top-k', b => { b.queries[0].top_k = 0; }],
  ['implicit empty expectation', b => { delete b.queries[1].expect_no_results; }],
  ['duplicate expected ID', b => b.queries[0].expected_ids.push(b.queries[0].expected_ids[0])],
]) test(`search inventory rejects ${name}`, () => { const b = search(); mutate(b); assert.throws(() => assertSearchInventory(b)); });
test('standalone browser inventory rejects zero or duplicate templates and guides', () => {
  const templates = Array.from({ length: 10 }, (_, i) => ({ template_id: `id${i}`, name: `name${i}`, supported_formats: ['xlsx'] }));
  const guides = Array.from({ length: 11 }, (_, i) => ({ id: `guide${i}` }));
  assert.doesNotThrow(() => assertRegistryInventory(templates, guides));
  assert.throws(() => assertRegistryInventory([], guides));
  assert.throws(() => assertRegistryInventory(templates, []));
  assert.throws(() => assertRegistryInventory([...templates.slice(0, 9), templates[0]], guides));
  assert.throws(() => assertRegistryInventory(templates, [...guides.slice(0, 10), guides[0]]));
});
