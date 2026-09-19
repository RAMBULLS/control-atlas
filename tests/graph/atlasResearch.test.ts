import assert from "node:assert/strict";
import test from "node:test";
import { buildAtlasGraphModel, type AtlasGraphSourceEdge } from "../../src/ui/lib/atlasGraphModel";
import { findAtlasResearchPaths, sharedAtlasNeighbors } from "../../src/ui/lib/atlasResearch";

function edge(id: string, from: string, to: string, patch: Partial<AtlasGraphSourceEdge> = {}) {
  return {
    id, source_node_id: from, target_node_id: to, relationship_type: "references",
    relationship_class: "correlation", publication_status: "published", status: "active",
    authority_class: "publisher", provenance_class: "federal_published", confidence: "direct",
    source_refs: [{ source_id: "fixture-publication", locator: `fixture#${id}` }], ...patch,
  };
}
function graph(edges = [edge("a-b", "a", "b"), edge("b-c", "b", "c")]) {
  return buildAtlasGraphModel({ nodes: ["a", "b", "c", "d"].map((id) => ({ id })), edges });
}
const complete = { inputCoverage: "complete" as const };

test("a research path preserves both original assertions and their direction", () => {
  const g = graph();
  const before = JSON.stringify(g.export());
  const result = findAtlasResearchPaths(g, "a", "c", complete);
  assert.equal(result.status, "found");
  assert.deepEqual(result.paths[0].map((hop) => hop.edge.id), ["a-b", "b-c"]);
  assert.ok(result.paths[0].every((hop) => hop.traversal === "forward"));
  assert.equal(result.paths[0][0].edge.source_refs[0].locator, "fixture#a-b");
  assert.equal(JSON.stringify(g.export()), before, "pathfinding must not add a transitive a→c mapping");
});

test("reverse research traversal is explicit and never reverses the source assertion", () => {
  assert.equal(findAtlasResearchPaths(graph(), "c", "a", complete).status, "not_found_within_bounds");
  const result = findAtlasResearchPaths(graph(), "c", "a", { ...complete, direction: "either" });
  assert.equal(result.status, "found");
  assert.ok(result.paths[0].every((hop) => hop.traversal === "reverse"));
  assert.equal(result.paths[0][0].from, "c");
  assert.equal(result.paths[0][0].edge.source_node_id, "b");
  assert.equal(result.paths[0][0].edge.target_node_id, "c");
});

test("undirected published assertions work in both directions without a false reverse label", () => {
  const result = findAtlasResearchPaths(graph([edge("u", "b", "a", { direction: "undirected" })]), "a", "b", complete);
  assert.equal(result.paths[0][0].traversal, "undirected");
});

for (const [reason, patch] of [
  ["editorial organization", { relationship_class: "organizing" }],
  ["publisher containment shortcut", { relationship_class: "structural" }],
  ["candidate", { publication_status: "candidate" }],
  ["unreviewed", { publication_status: undefined }],
  ["inference", { provenance_class: "inferred" }],
  ["unknown authority", { authority_class: undefined }],
  ["missing evidence", { source_refs: [] }],
  ["retired assertion", { status: "retired" }],
] as const) {
  test(`paths exclude ${reason}`, () => {
    const result = findAtlasResearchPaths(graph([edge("shortcut", "a", "c", patch)]), "a", "c", complete);
    assert.equal(result.status, "not_found_within_bounds");
    assert.deepEqual(result.paths, []);
  });
}

test("historical paths require explicit opt-in and keep the original lifecycle", () => {
  const result = findAtlasResearchPaths(graph([edge("old", "a", "c", { status: "retired" })]), "a", "c", { ...complete, includeHistorical: true });
  assert.equal(result.paths[0][0].edge.status, "retired");
});

test("parallel assertions and equal shortest alternatives are deterministic", () => {
  const edges = [edge("ab2", "a", "b"), edge("bc", "b", "c"), edge("ab1", "a", "b"), edge("ad", "a", "d"), edge("dc", "d", "c")];
  const first = findAtlasResearchPaths(graph(edges), "a", "c", complete);
  const second = findAtlasResearchPaths(graph([...edges].reverse()), "a", "c", complete);
  assert.deepEqual(first, second);
  assert.deepEqual(first.paths.map((path) => path.map((hop) => hop.edge.id)), [["ab1", "bc"], ["ab2", "bc"], ["ad", "dc"]]);
});

test("cycles and self-loops do not repeat nodes in a returned path", () => {
  const result = findAtlasResearchPaths(graph([edge("aa", "a", "a"), edge("ab", "a", "b"), edge("ba", "b", "a"), edge("bc", "b", "c")]), "a", "c", complete);
  assert.equal(result.paths.length, 1);
  assert.equal(result.paths[0].length, 2);
});

test("incomplete input is not represented as proof of no connection", () => {
  const result = findAtlasResearchPaths(graph(), "d", "c", { inputCoverage: "partial" });
  assert.equal(result.status, "incomplete");
  assert.equal(result.inputCoverage, "partial");
  assert.deepEqual(result.paths, []);
});

test("a found path can be valid while input coverage remains partial", () => {
  const result = findAtlasResearchPaths(graph(), "a", "c", { inputCoverage: "partial" });
  assert.equal(result.status, "found");
  assert.equal(result.inputCoverage, "partial");
});

test("depth and work bounds remain explicit rather than reporting universal absence", () => {
  const shallow = findAtlasResearchPaths(graph(), "a", "c", { ...complete, maxHops: 1 });
  assert.equal(shallow.status, "not_found_within_bounds");
  assert.equal(shallow.bounds.maxHops, 1);
  const limited = findAtlasResearchPaths(graph(), "a", "c", { ...complete, maxExaminedEdges: 1 });
  assert.equal(limited.status, "incomplete");
  assert.equal(limited.limitedBy, "edge_budget");
  assert.equal(limited.examinedEdges, 1);
});

test("missing or identical endpoints are not claimed as a meaningful connection", () => {
  assert.equal(findAtlasResearchPaths(graph(), "missing", "c", complete).status, "invalid_selection");
  assert.equal(findAtlasResearchPaths(graph(), "a", "a", complete).status, "invalid_selection");
});

test("invalid bounds and undeclared coverage fail closed", () => {
  for (const maxHops of [0, -1, 7, NaN, Infinity, 1.5]) {
    assert.throws(() => findAtlasResearchPaths(graph(), "a", "c", { ...complete, maxHops }), /maxHops/);
  }
  assert.throws(() => findAtlasResearchPaths(graph(), "a", "c", {} as any), /inputCoverage/);
});

test("scope restrictions are honored for endpoints and intermediate records", () => {
  const allowedNodeIds = new Set(["a", "c"]);
  assert.equal(findAtlasResearchPaths(graph(), "a", "c", { ...complete, allowedNodeIds }).status, "not_found_within_bounds");
  assert.equal(findAtlasResearchPaths(graph(), "a", "b", { ...complete, allowedNodeIds }).status, "invalid_selection");
});

test("shared neighbors count unique pins, not duplicate parallel edges", () => {
  const result = sharedAtlasNeighbors(graph([edge("ab1", "a", "b"), edge("ab2", "a", "b"), edge("cb", "c", "b")]), ["a", "a", "c"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].nodeId, "b");
  assert.deepEqual(result[0].connections.map((entry) => [entry.pinId, entry.edgeIds]), [["a", ["ab1", "ab2"]], ["c", ["cb"]]]);
});

test("shared neighbors exclude editorial/candidate bridges and require real pins", () => {
  assert.deepEqual(sharedAtlasNeighbors(graph([edge("ab", "a", "b"), edge("cb", "c", "b", { publication_status: "candidate" })]), ["a", "c"]), []);
  assert.throws(() => sharedAtlasNeighbors(graph(), ["a", "missing"]), /Unknown pin/);
  assert.deepEqual(sharedAtlasNeighbors(graph(), ["a"]), []);
});

test("the accepted corpus resolves V-205646 through its real CCI reference with exact evidence", async () => {
  const { readGeneratedCollection } = await import("../../scripts/lib/generated-graph-artifacts.mjs");
  const nodes = readGeneratedCollection(process.cwd(), "nodes")?.nodes;
  const edges = readGeneratedCollection(process.cwd(), "edges")?.edges;
  assert.ok(nodes?.length && edges?.length, "Generate the accepted corpus before the graph suite.");
  const start = "disa-stig:V-205646";
  const cci = "disa-cci:CCI-000185";
  const upstream = edges.find((entry) => entry.source_node_id === cci
    && entry.target_node_id.startsWith("nist-800-53:") && entry.relationship_type === "maps_to");
  assert.ok(upstream, "The endpoint must come from accepted publisher references, not an assumed control.");
  const result = findAtlasResearchPaths(buildAtlasGraphModel({ nodes, edges }), start, upstream.target_node_id, { ...complete, maxHops: 2 });
  assert.equal(result.status, "found");
  assert.equal(result.paths[0].length, 2);
  assert.equal(result.paths[0][0].to, cci);
  assert.equal(result.paths[0][1].to, upstream.target_node_id);
  for (const hop of result.paths[0]) {
    assert.deepEqual(hop.edge, edges.find((entry) => entry.id === hop.edge.id));
    assert.equal(hop.traversal, "forward");
  }
});
