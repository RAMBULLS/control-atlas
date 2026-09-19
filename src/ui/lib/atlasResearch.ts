import type { AtlasGraph, AtlasGraphSourceEdge } from "./atlasGraphModel";

/** A research trail retains every assertion; it never creates a transitive mapping. */
export type AtlasResearchHop = {
  from: string;
  to: string;
  traversal: "forward" | "reverse" | "undirected";
  edge: Readonly<AtlasGraphSourceEdge>;
};

export type AtlasResearchOptions = {
  /** Completeness of the supplied index, NOT completeness of publisher coverage. */
  inputCoverage: "complete" | "partial";
  direction?: "forward" | "either";
  includeHistorical?: boolean;
  allowedNodeIds?: ReadonlySet<string>;
  maxHops?: number;
  maxVisitedNodes?: number;
  maxExaminedEdges?: number;
  maxPaths?: number;
};

export type AtlasResearchResult = {
  status: "found" | "not_found_within_bounds" | "incomplete" | "invalid_selection";
  inputCoverage: "complete" | "partial";
  paths: AtlasResearchHop[][];
  visitedNodes: number;
  examinedEdges: number;
  limitedBy: "" | "node_budget" | "edge_budget";
  moreShortestPaths: boolean;
  bounds: { maxHops: number; maxVisitedNodes: number; maxExaminedEdges: number; maxPaths: number };
};

const INACTIVE = new Set(["historical", "retired", "deprecated", "superseded", "withdrawn", "archived", "sunset"]);
const RESEARCH_CLASSES = new Set(["correlation", "applicability"]);

function hasLocator(edge: AtlasGraphSourceEdge): boolean {
  if (typeof edge.source_artifact_id === "string" && edge.source_artifact_id
    && typeof edge.source_locator === "string" && edge.source_locator.trim()) return true;
  return Array.isArray(edge.source_refs) && edge.source_refs.some((ref) =>
    ref && typeof ref === "object"
    && typeof ref.source_id === "string" && ref.source_id.trim()
    && typeof ref.locator === "string" && ref.locator.trim());
}

/** Fail closed on editorial shortcuts, candidates, missing authority, and missing evidence. */
export function isAtlasResearchEdge(edge: AtlasGraphSourceEdge, includeHistorical = false): boolean {
  return edge.publication_status === "published"
    && edge.authority_class === "publisher"
    && edge.provenance_class !== "inferred"
    && edge.confidence !== "inferred"
    && RESEARCH_CLASSES.has(edge.relationship_class || "")
    && (includeHistorical || !INACTIVE.has(String(edge.lifecycle_status || edge.status || "")))
    && hasLocator(edge);
}

function bounded(value: number | undefined, fallback: number, ceiling: number, name: string): number {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < 1 || number > ceiling) {
    throw new Error(`${name} must be an integer from 1 to ${ceiling}.`);
  }
  return number;
}

function inScope(graph: AtlasGraph, id: string, options: Pick<AtlasResearchOptions, "includeHistorical" | "allowedNodeIds">): boolean {
  return graph.hasNode(id)
    && (!options.allowedNodeIds || options.allowedNodeIds.has(id))
    && (options.includeHistorical || !INACTIVE.has(String(graph.getNodeAttribute(id, "source").lifecycle_status || "")));
}

function step(graph: AtlasGraph, from: string, edgeId: string, options: Pick<AtlasResearchOptions, "direction" | "includeHistorical" | "allowedNodeIds">): AtlasResearchHop | null {
  const edge = graph.getEdgeAttribute(edgeId, "source");
  if (!isAtlasResearchEdge(edge, options.includeHistorical)) return null;
  const undirected = graph.isUndirected(edgeId);
  const reverse = edge.target_node_id === from && edge.source_node_id !== from;
  if (reverse && !undirected && options.direction !== "either") return null;
  const to = reverse ? edge.source_node_id : edge.target_node_id;
  if (to === from || !inScope(graph, to, options)) return null;
  return { from, to, traversal: undirected ? "undirected" : reverse ? "reverse" : "forward", edge };
}

export type AtlasNearestResult = AtlasResearchResult & {
  /** Depth of the nearest target(s), in hops. Zero when nothing was found. */
  depth: number;
  /** Every target reached at that depth, in stable id order. */
  endpoints: string[];
};

type SearchInput = { graph: AtlasGraph; from: string; isTarget: (id: string) => boolean; options: AtlasResearchOptions };

/**
 * Deterministic, bounded breadth-first search shared by point-to-point and nearest-target trails.
 * Parallel source assertions remain distinct. Reverse traversal is opt-in and labeled per hop.
 * An empty result is scoped to these bounds and this supplied index only.
 */
function searchTrails({ graph, from, isTarget, options }: SearchInput): AtlasNearestResult {
  if (!["complete", "partial"].includes(options.inputCoverage)) throw new Error("inputCoverage must be declared.");
  if (options.direction && !["forward", "either"].includes(options.direction)) throw new Error("Invalid traversal direction.");
  const bounds = {
    maxHops: bounded(options.maxHops, 4, 6, "maxHops"),
    maxVisitedNodes: bounded(options.maxVisitedNodes, 5000, 50000, "maxVisitedNodes"),
    maxExaminedEdges: bounded(options.maxExaminedEdges, 25000, 250000, "maxExaminedEdges"),
    maxPaths: bounded(options.maxPaths, 3, 8, "maxPaths"),
  };
  const result: AtlasNearestResult = {
    status: "not_found_within_bounds", inputCoverage: options.inputCoverage, paths: [],
    visitedNodes: 0, examinedEdges: 0, limitedBy: "", moreShortestPaths: false, bounds, depth: 0, endpoints: [],
  };
  if (!inScope(graph, from, options)) return { ...result, status: "invalid_selection" };
  const queue = [from];
  const distance = new Map([[from, 0]]);
  const parents = new Map<string, AtlasResearchHop[]>();
  let shortest = Infinity;
  search: for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const depth = distance.get(id)!;
    if (depth >= shortest || depth >= bounds.maxHops) continue;
    // Stable ordering does not depend on ingestion order or layout coordinates.
    for (const edgeId of graph.edges(id).sort()) {
      if (result.examinedEdges >= bounds.maxExaminedEdges) {
        result.limitedBy = "edge_budget";
        break search;
      }
      result.examinedEdges += 1;
      const hop = step(graph, id, edgeId, options);
      if (!hop) continue;
      const nextDepth = depth + 1;
      const known = distance.get(hop.to);
      if (known !== undefined && known < nextDepth) continue;
      if (known === undefined) {
        if (distance.size >= bounds.maxVisitedNodes) {
          result.limitedBy = "node_budget";
          break search;
        }
        distance.set(hop.to, nextDepth);
        queue.push(hop.to);
        parents.set(hop.to, []);
      }
      parents.get(hop.to)!.push(hop);
      if (isTarget(hop.to) && nextDepth < shortest) shortest = nextDepth;
    }
  }
  result.visitedNodes = distance.size;
  if (shortest < Infinity) {
    result.depth = shortest;
    result.endpoints = [...distance].filter(([id, d]) => d === shortest && id !== from && isTarget(id)).map(([id]) => id).sort();
    const collect = (id: string, suffix: AtlasResearchHop[]) => {
      if (result.paths.length > bounds.maxPaths) return;
      if (id === from) { result.paths.push(suffix); return; }
      for (const hop of parents.get(id) || []) collect(hop.from, [hop, ...suffix]);
    };
    for (const endpoint of result.endpoints) collect(endpoint, []);
    result.moreShortestPaths = result.paths.length > bounds.maxPaths;
    result.paths = result.paths.slice(0, bounds.maxPaths);
    result.status = "found";
  } else if (result.limitedBy || options.inputCoverage === "partial") {
    result.status = "incomplete";
  }
  return result;
}

export function findAtlasResearchPaths(
  graph: AtlasGraph,
  from: string,
  to: string,
  options: AtlasResearchOptions,
): AtlasResearchResult {
  if (from === to || !inScope(graph, from, options) || !inScope(graph, to, options)) {
    const bounds = searchTrails({ graph, from: "", isTarget: () => false, options }).bounds;
    return { status: "invalid_selection", inputCoverage: options.inputCoverage, paths: [], visitedNodes: 0, examinedEdges: 0, limitedBy: "", moreShortestPaths: false, bounds };
  }
  const { depth: _depth, endpoints: _endpoints, ...result } = searchTrails({ graph, from, isTarget: (id) => id === to, options });
  return result;
}

/**
 * The nearest records that satisfy the target test, following recorded connections outward from one
 * record. The caller decides what counts as a target (for example, records in a set of
 * publications); no publication or control is named here.
 */
export function findNearestResearchTargets(
  graph: AtlasGraph,
  from: string,
  isTarget: (id: string) => boolean,
  options: AtlasResearchOptions,
): AtlasNearestResult {
  return searchTrails({ graph, from, isTarget: (id) => id !== from && isTarget(id), options });
}

/**
 * Neighbors shared by every distinct pin. These are shared published links,
 * not shared requirements or proof that two programs are equivalent.
 */
export function sharedAtlasNeighbors(
  graph: AtlasGraph,
  pinIds: readonly string[],
  options: Pick<AtlasResearchOptions, "includeHistorical" | "allowedNodeIds"> & { minPins?: number } = {},
): Array<{ nodeId: string; connections: Array<{ pinId: string; edgeIds: string[] }> }> {
  const pins = [...new Set(pinIds)];
  if (pins.length > 6) throw new Error("At most six pins are supported.");
  for (const pin of pins) if (!inScope(graph, pin, options)) throw new Error(`Unknown pin or pin outside scope: ${pin}`);
  if (pins.length < 2) return [];
  const candidates = new Map<string, Map<string, string[]>>();
  for (const pinId of pins) {
    for (const edgeId of graph.edges(pinId).sort()) {
      const hop = step(graph, pinId, edgeId, { ...options, direction: "either" });
      if (!hop || pins.includes(hop.to)) continue;
      if (!candidates.has(hop.to)) candidates.set(hop.to, new Map());
      const byPin = candidates.get(hop.to)!;
      byPin.set(pinId, [...(byPin.get(pinId) || []), edgeId]);
    }
  }
  const minPins = Math.min(pins.length, Math.max(2, options.minPins ?? pins.length));
  return [...candidates].filter(([, byPin]) => byPin.size >= minPins)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nodeId, byPin]) => ({
      nodeId, connections: pins.filter((pinId) => byPin.has(pinId)).map((pinId) => ({ pinId, edgeIds: byPin.get(pinId)! })),
    }));
}
