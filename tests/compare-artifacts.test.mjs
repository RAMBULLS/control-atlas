import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildComparisonArtifacts } from '../scripts/lib/compare-artifacts.mjs';
import { isComparisonCapableEdge } from '../src/shared/compare-capability.mjs';
import { comparisonPairKey } from '../src/shared/compare-scope.mjs';
import { readGeneratedCollection } from '../scripts/lib/generated-graph-artifacts.mjs';

const node = (id, catalog) => ({ id, label: id, node_type: 'requirement', source_id: 'publisher', metadata: { catalog_id: catalog, item_id: id } });
const edge = (id) => ({ id: `edge:${id}`, source_node_id: 'a:1', target_node_id: `b:${id}`, relationship_type: 'maps_to', relationship_class: 'correlation', publication_status: 'published', source_refs: [{ source_id: 'publisher', locator: `official#${id}` }], evidence_ids: [`evidence:${id}`] });

test('Compare artifacts are deterministic and complete even across small chunk budgets', () => {
  const edges = Array.from({ length: 25 }, (_, i) => edge(String(i)));
  const graph = { sources: [{ id: 'publisher' }], nodes: [node('a:1', 'a'), ...edges.map((e) => node(e.target_node_id, 'b'))], edges, evidence: edges.map((e) => ({ id: e.evidence_ids[0], source_id: 'publisher', locator: e.source_refs[0].locator })) };
  const a = buildComparisonArtifacts(graph, 2048), b = buildComparisonArtifacts(graph, 2048);
  assert.deepEqual([...a.files], [...b.files]);
  const manifest = JSON.parse(a.files.get(a.manifest['a|b'].path));
  assert.ok(manifest.chunks.length > 1);
  assert.ok(manifest.chunks.every((chunk) => chunk.bytes <= 2048));
  const emitted = manifest.chunks.flatMap((chunk) => JSON.parse(a.files.get(chunk.path)).edges);
  assert.deepEqual(emitted.map((e) => e.id).sort(), edges.map((e) => e.id).sort());
  assert.equal(new Set(emitted.map((e) => e.id)).size, edges.length);
  assert.throws(() => buildComparisonArtifacts({ ...graph, evidence: [] }), /evidence missing/);
});

test('all generated Compare pairs reconcile to the admitted governed graph, including direction and evidence', () => {
  const generated = 'data/generated';
  const read = (path) => JSON.parse(readFileSync(`${generated}/${path}`, 'utf8'));
  const { comparison_pairs: pairs } = read('catalog-bootstrap.json').catalog_bootstrap;
  const nodes = readGeneratedCollection('.', 'nodes').nodes;
  const edges = readGeneratedCollection('.', 'edges').edges;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const expected = new Map();
  for (const e of edges) {
    if (!isComparisonCapableEdge(e) || !e.source_refs?.length) continue;
    const key = comparisonPairKey(byId.get(e.source_node_id)?.metadata?.catalog_id, byId.get(e.target_node_id)?.metadata?.catalog_id);
    if (!key) continue;
    const ids = expected.get(key) || new Set(); ids.add(e.id); expected.set(key, ids);
  }
  assert.deepEqual(Object.keys(pairs).sort(), [...expected.keys()].sort());
  for (const [key, entry] of Object.entries(pairs)) {
    const header = read(entry.path);
    const chunks = header.chunks.map((part) => read(part.path));
    const emitted = chunks.flatMap((chunk) => chunk.edges);
    assert.equal(emitted.length, header.edge_count, key);
    assert.deepEqual(new Set(emitted.map((edge) => edge.id)), expected.get(key), key);
    for (const chunk of chunks) {
      const evidence = new Set(chunk.evidence.map((item) => item.id));
      for (const edge of chunk.edges) for (const id of edge.evidence_ids || [`evidence:${edge.id.slice(5)}`]) assert.ok(evidence.has(id), edge.id);
      assert.ok(chunk.nodes.every((node) => !node.metadata.source_fragments && !node.metadata.implementation_sections), key);
    }
  }
  assert.equal(pairs['csf-2|nist-zt'].scope, 'implementation');
  assert.equal(pairs['dod-zt|nist-800-53'].scope, 'frameworks');
  assert.ok(!Object.keys(pairs).some((key) => key.includes('microsoft-zt-maturity')));
});
