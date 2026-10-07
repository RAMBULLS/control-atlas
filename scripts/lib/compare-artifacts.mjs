import { createHash } from "node:crypto";
import { comparisonPairKey, comparisonScopeForNodes } from "../../src/shared/compare-scope.mjs";
import { isBaselineSelection, isComparisonCapableEdge, mappingSourceIdsForEdge } from "../../src/shared/compare-capability.mjs";

// A transport budget, not a result cap. Every published relationship is retained.
// Chunking + the loader's bounded concurrency limit transfer/parse bursts.
export const COMPARE_CHUNK_BYTES = 512 * 1024;
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 20);
const sortById = (values) => values.sort((a, b) => a.id.localeCompare(b.id));

function compactNode(node) {
  const metadata = node.metadata || {};
  return {
    id: node.id, node_type: node.node_type, label: node.label, source_id: node.source_id,
    metadata: { catalog_id: metadata.catalog_id, item_id: metadata.item_id,
      title: metadata.title, taxonomy_tags: metadata.taxonomy_tags || [] },
  };
}

/** A disposable read model of the governed graph, never a second mapping registry. */
export function buildComparisonArtifacts(graph, budget = COMPARE_CHUNK_BYTES) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const evidence = new Map(graph.evidence.map((item) => [item.id, item]));
  const sourceIds = new Set(graph.sources.map((source) => source.id));
  const groups = new Map();
  const baselines = new Map();
  const items = new Map();
  for (const edge of graph.edges) {
    if (edge.publication_status === "published" && edge.relationship_type === "selects" &&
      ["baseline", "baseline_profile"].includes(nodes.get(edge.source_node_id)?.node_type) && !nodes.has(edge.target_node_id)) {
      throw new Error(`Baseline control missing: ${edge.id}`);
    }
    if (isBaselineSelection(edge, nodes.get(edge.source_node_id), nodes.get(edge.target_node_id))) {
      const refs = mappingSourceIdsForEdge(edge);
      if (!refs.length || refs.some((id) => !sourceIds.has(id))) throw new Error(`Baseline source missing: ${edge.id}`);
      const values = baselines.get(edge.source_node_id) || [];
      values.push(edge);
      baselines.set(edge.source_node_id, values);
    }
    if (!isComparisonCapableEdge(edge)) continue;
    const from = nodes.get(edge.source_node_id);
    const to = nodes.get(edge.target_node_id);
    const a = from?.metadata?.catalog_id;
    const b = to?.metadata?.catalog_id;
    const key = comparisonPairKey(a, b);
    if (!key) continue;
    const refs = mappingSourceIdsForEdge(edge);
    if (!refs.length || refs.some((id) => !sourceIds.has(id))) continue;
    const values = groups.get(key) || [];
    values.push(edge);
    groups.set(key, values);
    for (const [catalog, node, target] of [[a, from, b], [b, to, a]]) {
      const byItem = items.get(catalog) || new Map();
      const targets = byItem.get(node.id) || new Set();
      targets.add(target);
      byItem.set(node.id, targets);
      items.set(catalog, byItem);
    }
  }
  const files = new Map();
  const manifest = {};
  const itemManifest = {};
  const baselineManifest = {};
  const emit = (name, value) => {
    const text = JSON.stringify(value);
    const path = `compare-data/${name}.${digest(text)}.json`;
    files.set(path, text + "\n");
    return { path, bytes: Buffer.byteLength(text) + 1 };
  };
  for (const [key, edges] of [...groups, ...baselines].sort(([a], [b]) => a.localeCompare(b))) {
    const baseline = baselines.has(key) ? nodes.get(key) : null;
    const pair = baseline ? [key] : key.split("|");
    const filename = baseline ? `baseline-${digest(key)}` : pair.join('--');
    const allNodes = new Set(edges.flatMap((edge) => [edge.source_node_id, edge.target_node_id]));
    const scope = baseline ? "baselines" : comparisonScopeForNodes([...allNodes].map((id) => nodes.get(id)));
    const chunks = [];
    let chunkNodes = new Map(), chunkEvidence = new Map(), chunkEdges = [], estimatedBytes = 128;
    const flush = () => {
      if (!chunkEdges.length) return;
      const file = emit(`${filename}-${chunks.length}`, {
        pair, scope, nodes: sortById([...chunkNodes.values()]), edges: chunkEdges,
        evidence: sortById([...chunkEvidence.values()]),
      });
      if (file.bytes > budget) throw new Error(`Compare chunk exceeds transport budget: ${file.path}`);
      chunks.push({ ...file, edge_count: chunkEdges.length });
      chunkNodes = new Map(); chunkEvidence = new Map(); chunkEdges = []; estimatedBytes = 128;
    };
    for (const edge of sortById(edges)) {
      const edgeEvidence = (edge.evidence_ids || [`evidence:${edge.id.slice(5)}`]).map((id) => evidence.get(id));
      if (edgeEvidence.some((item) => !item)) throw new Error(`Compare evidence missing: ${edge.id}`);
      if (baseline && (!edgeEvidence.length || edgeEvidence.some((item) => !item.locator || !mappingSourceIdsForEdge(edge).includes(item.source_id)))) {
        throw new Error(`Baseline selection evidence missing: ${edge.id}`);
      }
      const edgeNodes = [nodes.get(edge.source_node_id), nodes.get(edge.target_node_id)].map(compactNode);
      // Conservative estimate includes duplicate endpoints and evidence. Actual
      // serialized size is checked at flush, not inferred from a record count.
      const bytes = Buffer.byteLength(JSON.stringify(edge)) + edgeNodes.reduce((sum, node) => sum + Buffer.byteLength(JSON.stringify(node)) + 2, 0)
        + edgeEvidence.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)) + 2, 0) + 4;
      if (bytes + 128 > budget) throw new Error(`A single mapping exceeds the Compare transport budget: ${edge.id}`);
      if (estimatedBytes + bytes > budget) flush();
      chunkEdges.push(edge);
      for (const node of edgeNodes) chunkNodes.set(node.id, node);
      for (const item of edgeEvidence) chunkEvidence.set(item.id, item);
      estimatedBytes += bytes;
    }
    flush();
    const header = { schema_version: 1, pair, scope, edge_count: edges.length, node_count: allNodes.size, chunks };
    const entry = { scope, edge_count: edges.length, ...emit(`${filename}-index`, header) };
    if (baseline) {
      const source = graph.sources.find((source) => source.id === baseline.source_id);
      if (!source) throw new Error(`Baseline publication missing: ${key}`);
      baselineManifest[key] = { ...entry, name: baseline.metadata?.title || baseline.label,
        source_id: source.id, publication: source.display_name || source.name,
        version: source.version || "", lifecycle_status: source.lifecycle_status || "" };
    } else manifest[key] = entry;
  }
  for (const [catalog, byItem] of [...items].sort(([a], [b]) => a.localeCompare(b))) {
    itemManifest[catalog] = emit(`items-${catalog}`, {
      catalog, items: Object.fromEntries([...byItem].sort(([a], [b]) => a.localeCompare(b))
        .map(([id, targets]) => [id, [...targets].sort()])),
    }).path;
  }
  return { manifest, itemManifest, baselineManifest, files };
}
