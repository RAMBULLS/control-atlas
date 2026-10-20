// Smaller cohorts preserve each complete neighborhood while keeping unrelated
// records off a cold record's download path.
export const ATLAS_NEIGHBORHOOD_SHARD_COUNT = 2048;

export function atlasNeighborhoodShardId(
  nodeId,
  shardCount = ATLAS_NEIGHBORHOOD_SHARD_COUNT,
) {
  let hash = 0x811c9dc5;
  for (const character of String(nodeId)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % shardCount).toString(16).padStart(2, "0");
}

function compactNode(node, structuralChildren, descendantRecordCount) {
  return [
    node.id,
    node.node_type,
    node.metadata?.item_id || node.id,
    node.metadata?.title || node.label || node.id,
    node.metadata?.catalog_id || "",
    node.source_id || "",
    node.metadata?.family || "",
    node.parent_id || "",
    node.metadata?.description || "",
    (structuralChildren.get(node.id) || []).length,
    descendantRecordCount(node.id),
  ];
}

function compactEdge(edge) {
  return [
    edge.id,
    edge.source_node_id,
    edge.target_node_id,
    edge.relationship_type,
    edge.relationship_class,
    edge.provenance_class,
    edge.publication_status,
    edge.confidence,
    (edge.source_refs || []).map((reference) => [
      reference.source_id || "",
      reference.ref_type || "",
      reference.locator || "",
    ]),
  ];
}

export function buildAtlasNeighborhoodShards(
  graph,
  shardCount = ATLAS_NEIGHBORHOOD_SHARD_COUNT,
) {
  const ancestorGraph = buildAncestorGraph(graph.nodes, graph.edges);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const catalogRootByCatalogId = new Map(
    graph.nodes
      .filter((node) => node.node_type === "catalog" && node.metadata?.catalog_id)
      .map((node) => [node.metadata.catalog_id, node]),
  );
  const edgesByNode = new Map(graph.nodes.map((node) => [node.id, []]));
  const structuralChildren = new Map();

  for (const edge of graph.edges) {
    edgesByNode.get(edge.source_node_id)?.push(edge);
    if (edge.target_node_id !== edge.source_node_id) {
      edgesByNode.get(edge.target_node_id)?.push(edge);
    }
    if (
      edge.relationship_class === "structural" &&
      edge.publication_status === "published"
    ) {
      const children = structuralChildren.get(edge.source_node_id) || [];
      children.push(edge.target_node_id);
      structuralChildren.set(edge.source_node_id, children);
    }
  }

  const descendantMemo = new Map();
  const descendantRecordCount = (nodeId, visiting = new Set()) => {
    if (descendantMemo.has(nodeId)) return descendantMemo.get(nodeId);
    if (visiting.has(nodeId)) return 0;
    const children = structuralChildren.get(nodeId) || [];
    if (!children.length) return 1;
    const nextVisiting = new Set([...visiting, nodeId]);
    const count = children.reduce(
      (total, childId) => total + descendantRecordCount(childId, nextVisiting),
      0,
    );
    descendantMemo.set(nodeId, count);
    return count;
  };

  const shardRecords = new Map();
  for (const node of graph.nodes) {
    const edges = (edgesByNode.get(node.id) || []).map(compactEdge);
    const canonicalStructuralPath = ancestorChain(node.id, ancestorGraph).map(
      (link) => link.id,
    );
    const publisherStructuralPaths = ancestorChains(node.id, ancestorGraph).map(
      (path) => path.map((link) => link.id),
    );
    const catalogId = node.metadata?.catalog_id || "";
    const primaryAuthority = catalogRootByCatalogId.get(catalogId)?.metadata
      ?.primary_authority;
    // `issued_under` is deliberately secondary and never enters canonical
    // parenting. The displayed path composes exactly one curated authority hop
    // ahead of the unchanged canonical chain so record routes can explain why
    // a publication exists without changing who structurally owns the record.
    const structuralPath =
      primaryAuthority && nodeById.has(primaryAuthority)
        ? [primaryAuthority, ...canonicalStructuralPath]
        : canonicalStructuralPath;
    const structuralPaths = publisherStructuralPaths.map((path) => (
      primaryAuthority && nodeById.has(primaryAuthority)
        ? [primaryAuthority, ...path]
        : path
    ));
    const neighborhoodNodeIds = new Set([
      node.id,
      ...structuralPath,
      ...structuralPaths.flat(),
      ...edges.flatMap((edge) => [edge[1], edge[2]]),
    ]);
    const shardId = atlasNeighborhoodShardId(node.id, shardCount);
    const records = shardRecords.get(shardId) || {};
    records[node.id] = {
      center_node: node,
      nodes: [...neighborhoodNodeIds]
        .map((nodeId) => nodeById.get(nodeId))
        .filter(Boolean)
        .map((entry) => compactNode(entry, structuralChildren, descendantRecordCount)),
      edges,
      structural_path: structuralPath,
      structural_paths: structuralPaths.length ? structuralPaths : [structuralPath],
      published_connection_count: edges.filter(
        (edge) => edge[6] === "published",
      ).length,
      candidate_connection_count: edges.filter(
        (edge) => edge[6] !== "published",
      ).length,
    };
    shardRecords.set(shardId, records);
  }

  return [...shardRecords.entries()]
    .map(([shard_id, records]) => ({
      shard_id,
      record_count: Object.keys(records).length,
      records,
    }))
    .sort((left, right) => left.shard_id.localeCompare(right.shard_id));
}
import {
  ancestorChain,
  ancestorChains,
  buildAncestorGraph,
} from "./ancestor-path.mjs";
