import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertSearchInventory } from '../tools/lib/assurance-inventory.mjs';
import { readGeneratedCollection } from '../scripts/lib/generated-graph-artifacts.mjs';
import { createFederalGraphRuntime } from '../src/app/runtime.mjs';

// Complete expected-set recall, not the legacy any-one-expected hit test.
// Fixture relevance remains a separately reviewed meaning judgment.
test('assurance search: every reviewed expected identity appears within its top-k', () => {
  const librarySearch = readGeneratedCollection('.', 'library-search').library_search;
  const runtime = createFederalGraphRuntime({ sources: [], nodes: [], edges: [], evidence: [], findings: [], librarySearch });
  const benchmark = JSON.parse(readFileSync('tests/benchmarks/search-quality.json', 'utf8'));
  assertSearchInventory(benchmark);
  const failures = [];
  for (const fixture of benchmark.queries) {
    assert.equal(new Set(fixture.expected_ids).size, fixture.expected_ids.length, `${fixture.id}: duplicate expectations`);
    assert.ok(fixture.top_k >= fixture.expected_ids.length, `${fixture.id}: impossible recall target`);
    const ids = runtime.searchLibrary(fixture.query).slice(0, fixture.top_k).map(entry => entry.id);
    assert.equal(new Set(ids).size, ids.length, `${fixture.id}: duplicate returned identities`);
    const missing = fixture.expected_ids.filter(id => !ids.includes(id));
    if (missing.length || (!fixture.expected_ids.length && ids.length)) failures.push({ fixture: fixture.id, missing, actual: ids });
  }
  assert.deepEqual(failures, []);
});
