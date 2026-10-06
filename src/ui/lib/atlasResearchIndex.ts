import { buildAtlasGraphModel, type AtlasGraph, type AtlasGraphSourceEdge, type AtlasGraphSourceNode } from "./atlasGraphModel";
import { findAtlasResearchPaths, findNearestResearchTargets, isAtlasResearchEdge, sharedAtlasNeighbors, type AtlasNearestResult, type AtlasResearchResult } from "./atlasResearch";

export const RESEARCH_INDEX_VERSION = 1;
export const RESEARCH_POLICY_VERSION = 1;
export const RESEARCH_MAX_BYTES = 96 * 1024 * 1024;

export type ResearchRecord = AtlasGraphSourceNode & {
  id: string;
  identity: { label: string; title: string; publication: string; catalogId: string; itemId: string };
};
export type ResearchIndex = {
  schemaVersion: number;
  policyVersion: number;
  generatedAt: string;
  sourceHashes: { nodes: string; edges: string };
  nodes: ResearchRecord[];
  edges: AtlasGraphSourceEdge[];
};
export type ResearchManifest = {
  schemaVersion: number;
  policyVersion: number;
  generatedAt: string;
  sha256: string;
  bytes: number;
  nodeCount: number;
  edgeCount: number;
  inputNodeCount: number;
  inputEdgeCount: number;
};
export type ResearchAnswer = {
  kind: "path" | "shared" | "upstream";
  result?: AtlasResearchResult | AtlasNearestResult;
  /** Records connected to some, but not every, pin (three or more pins). */
  some?: Array<{ nodeId: string; connections: Array<{ pinId: string; edgeIds: string[] }> }>;
  shared?: Array<{ nodeId: string; connections: Array<{ pinId: string; edgeIds: string[] }> }>;
  sharedTotal?: number;
  sharedOffset?: number;
  nodes: ResearchRecord[];
  edges: AtlasGraphSourceEdge[];
};

/** Digest, versions, and counts must all agree before any result is shown. */
export function validateResearchManifest(value: unknown): ResearchManifest {
  const m = value as ResearchManifest;
  if (!m || m.schemaVersion !== RESEARCH_INDEX_VERSION || m.policyVersion !== RESEARCH_POLICY_VERSION
    || !/^[a-f0-9]{64}$/.test(m.sha256 || "") || !Number.isSafeInteger(m.bytes)
    || m.bytes < 1 || m.bytes > RESEARCH_MAX_BYTES
    || ![m.nodeCount, m.edgeCount, m.inputNodeCount, m.inputEdgeCount].every(n => Number.isSafeInteger(n) && n >= 0)
    || m.nodeCount > 100000 || m.edgeCount > 250000 || m.nodeCount !== m.inputNodeCount || m.edgeCount > m.inputEdgeCount
    || !Number.isFinite(Date.parse(m.generatedAt))) throw new Error("Invalid research manifest.");
  return m;
}

export function validateResearchIndex(value: unknown, manifest: ResearchManifest): ResearchIndex {
  const index = value as ResearchIndex;
  if (!index || index.schemaVersion !== manifest.schemaVersion || index.policyVersion !== manifest.policyVersion
    || index.generatedAt !== manifest.generatedAt || !Array.isArray(index.nodes) || !Array.isArray(index.edges)
    || index.nodes.length !== manifest.nodeCount || index.edges.length !== manifest.edgeCount
    || !/^[a-f0-9]{64}$/.test(index.sourceHashes?.nodes || "") || !/^[a-f0-9]{64}$/.test(index.sourceHashes?.edges || "")) {
    throw new Error("Incomplete research data.");
  }
  for (const node of index.nodes) {
    if (!node.identity || !node.identity.label || !node.id || typeof node.identity.publication !== "string") {
      throw new Error("Invalid research record.");
    }
  }
  for (const edge of index.edges) if (!isAtlasResearchEdge(edge, true)) throw new Error("Unadmitted research connection.");
  return index;
}

/** Kept in the worker: neither full evidence data nor graph construction blocks UI input. */
export class AtlasResearchEngine {
  readonly graph: AtlasGraph;
  readonly byId: Map<string, ResearchRecord>;
  private readonly searchRows: Array<{ node: ResearchRecord; words: string; identifier: string }>;
  constructor(index: ResearchIndex) {
    this.graph = buildAtlasGraphModel(index);
    this.byId = new Map(index.nodes.map(node => [node.id, node]));
    this.searchRows = index.nodes.map(node => ({
      node,
      identifier: `${node.identity.itemId}`.toLowerCase(),
      words: [node.id, node.identity.label, node.identity.title, node.identity.publication,
        node.metadata?.stig_id, node.metadata?.rule_id].join(" ").toLowerCase(),
    }));
  }
  search(query: string): { records: ResearchRecord[]; total: number } {
    const q = query.trim().toLowerCase().slice(0, 200);
    if (q.length < 2) return { records: [], total: 0 };
    const terms = q.split(/\s+/);
    const rows = this.searchRows.filter(row => terms.every(term => row.words.includes(term)));
    rows.sort((a, b) => Number(b.node.id.toLowerCase() === q || b.identifier === q)
      - Number(a.node.id.toLowerCase() === q || a.identifier === q) || a.node.id.localeCompare(b.node.id));
    return { records: rows.slice(0, 8).map(row => row.node), total: rows.length };
  }
  records(ids: string[]): ResearchRecord[] { return ids.flatMap(id => this.byId.has(id) ? [this.byId.get(id)!] : []); }
  path(from: string, to: string, direction: "forward" | "either", maxHops: number): ResearchAnswer {
    const result = findAtlasResearchPaths(this.graph, from, to, { inputCoverage: "complete", direction, maxHops });
    const edges = [...new Map(result.paths.flatMap(path => path.map(hop => [hop.edge.id, hop.edge] as const))).values()];
    const ids = [...new Set([from, to, ...edges.flatMap(edge => [edge.source_node_id, edge.target_node_id])])];
    return { kind: "path", result, nodes: this.records(ids), edges };
  }
  /** The nearest records in the given publications, following recorded connections outward. */
  upstream(from: string, catalogs: string[], maxHops: number): ResearchAnswer {
    const wanted = new Set(catalogs);
    const result = findNearestResearchTargets(this.graph, from, id => wanted.has(this.byId.get(id)?.identity.catalogId || ""), { inputCoverage: "complete", direction: "forward", maxHops });
    const edges = [...new Map(result.paths.flatMap(path => path.map(hop => [hop.edge.id, hop.edge] as const))).values()];
    const ids = [...new Set([from, ...result.endpoints, ...edges.flatMap(edge => [edge.source_node_id, edge.target_node_id])])];
    return { kind: "upstream", result, nodes: this.records(ids), edges };
  }
  /** Published connections a record has in this index. */
  degree(id: string): number { return this.graph.hasNode(id) ? this.graph.degree(id) : 0; }
  shared(pins: string[], offset = 0): ResearchAnswer {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error("Invalid results page.");
    const rows = sharedAtlasNeighbors(this.graph, pins, { minPins: 2 });
    const all = rows.filter(row => row.connections.length === new Set(pins).size);
    const some = new Set(pins).size > 2 ? rows.filter(row => row.connections.length < new Set(pins).size).slice(0, 40) : [];
    const shared = all.slice(offset, offset + 40);
    const edgeIds = [...new Set([...shared, ...some].flatMap(row => row.connections.flatMap(connection => connection.edgeIds)))];
    return { kind: "shared", shared, some, sharedTotal: all.length, sharedOffset: offset,
      nodes: this.records([...pins, ...shared.map(row => row.nodeId), ...some.map(row => row.nodeId)]),
      edges: edgeIds.map(id => this.graph.getEdgeAttribute(id, "source")) };
  }
}
