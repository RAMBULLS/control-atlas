import assert from "node:assert/strict";
import test from "node:test";
import { AtlasResearchEngine, type ResearchIndex } from "../../src/ui/lib/atlasResearchIndex";
import { isAtlasResearchEdge } from "../../src/ui/lib/atlasResearch";
import { catalogDisplayNameFor, catalogProfileFor } from "../../src/ui/lib/catalogProfiles";
import { recordIdentityPresentationFor } from "../../src/ui/lib/recordTitle";
import { readGeneratedCollection } from "../../scripts/lib/generated-graph-artifacts.mjs";

// The same projection the build applies to the accepted corpus, so these are real-corpus results.
const nodes = readGeneratedCollection(process.cwd(), "nodes").nodes;
const edges = readGeneratedCollection(process.cwd(), "edges").edges;
const index: ResearchIndex = {
  schemaVersion: 1, policyVersion: 1, generatedAt: "test", sourceHashes: { nodes: "a".repeat(64), edges: "b".repeat(64) },
  nodes: nodes.map((node: any) => {
    const md = node.metadata || {}; const catalogId = md.catalog_id || "";
    const identity = recordIdentityPresentationFor({ publisher: "", catalogId, publicationName: catalogDisplayNameFor(catalogId), family: md.family || "",
      itemId: md.item_id || node.label || "", title: md.title || "", objectType: node.node_type || "", metadata: md });
    return { id: node.id, node_type: node.node_type, source_id: node.source_id, lifecycle_status: node.lifecycle_status,
      metadata: { catalog_id: catalogId, item_id: md.item_id }, identity: { label: identity.stableIdIsGenerated ? identity.primary : md.publisher_item_id || md.item_id || identity.primary,
        title: identity.secondary || "", publication: catalogDisplayNameFor(catalogId), catalogId, itemId: md.item_id || "" } };
  }),
  edges: edges.filter((e: any) => isAtlasResearchEdge(e, true)),
} as ResearchIndex;
const engine = new AtlasResearchEngine(index);
const catalogOf = (id: string) => engine.byId.get(id)?.identity.catalogId || "";
// The publications that count as control catalogs come from governed publication kinds, never from the search code.
const controlCatalogs = [...new Set(index.nodes.map((n) => n.identity.catalogId))].filter((c) => c && catalogProfileFor(c).publicationKind === "Control catalog");
const START = "disa-stig:V-205646";

test("upstream from a STIG rule reaches the nearest control-catalog records through recorded connections", () => {
  assert.ok(engine.byId.has(START), "the flagship record exists in the accepted corpus");
  assert.ok(controlCatalogs.includes("nist-800-53"));
  const answer = engine.upstream(START, controlCatalogs, 4);
  assert.equal(answer.result?.status, "found");
  const result = answer.result as any;
  assert.ok(result.endpoints.length >= 1 && result.depth >= 1 && result.depth <= 4);
  for (const path of result.paths) {
    assert.equal(path.length, result.depth, "every reported path is a shortest path");
    assert.equal(path[0].from, START);
    path.slice(1).forEach((hop: any, i: number) => assert.equal(hop.from, path[i].to, "hops chain end to start"));
    assert.ok(controlCatalogs.includes(catalogOf(path[path.length - 1].to)));
    for (const hop of path) assert.equal(isAtlasResearchEdge(hop.edge, true), true, "every hop is a published connection");
  }
});

test("the flagship journey passes through the CCI and reaches an accepted NIST control", () => {
  const answer = engine.upstream(START, ["nist-800-53"], 4);
  const path = (answer.result as any).paths[0] as any[];
  assert.ok(path.length >= 2, "a STIG rule does not connect to 800-53 directly");
  const catalogs = [START, ...path.map((h) => h.to)].map(catalogOf);
  assert.equal(catalogs[0], "disa-stig");
  assert.ok(catalogs.includes("disa-cci"), `expected a CCI step, got ${catalogs.join(" > ")}`);
  assert.equal(catalogs[catalogs.length - 1], "nist-800-53");
  assert.equal(path.every((h) => h.traversal === "forward"), true, "upstream follows recorded direction");
});

test("upstream from a record that already sits in a control catalog finds its nearest other control-catalog records, never itself", () => {
  const record = index.nodes.find((n) => n.identity.catalogId === "nist-800-53" && engine.degree(n.id) > 0)!;
  const answer = engine.upstream(record.id, controlCatalogs, 4);
  const endpoints = (answer.result as any).endpoints as string[];
  assert.ok(!endpoints.includes(record.id));
});

test("no target reachable is reported as not found within bounds, and an unknown record as an invalid selection", () => {
  assert.equal(engine.upstream(START, ["no-such-publication"], 3).result?.status, "not_found_within_bounds");
  assert.equal(engine.upstream("missing:record", controlCatalogs, 3).result?.status, "invalid_selection");
});

test("shared ground for records reports all, some, and an honest zero", () => {
  const cci = index.nodes.filter((n) => n.identity.catalogId === "disa-cci").slice(0, 60).map((n) => n.id);
  const nist = index.nodes.filter((n) => n.identity.catalogId === "nist-800-53" && engine.degree(n.id) > 2).slice(0, 3);
  assert.ok(nist.length >= 2);
  const two = engine.shared([nist[0].id, nist[1].id]);
  assert.ok((two.sharedTotal || 0) >= (two.shared || []).length);
  assert.deepEqual(two.some, [], "two pins have no partial sharing");
  const isolated = [START, cci[0]];
  const answer = engine.shared(isolated);
  for (const row of answer.shared || []) assert.equal(row.connections.length, 2);
  const three = engine.shared([...nist.map((n) => n.id), START].slice(0, 3));
  for (const row of three.shared || []) assert.equal(row.connections.length, 3);
  for (const row of three.some || []) assert.ok(row.connections.length >= 2 && row.connections.length < 3);
});

test("a dense hub has a large published degree, so its relationships must be revealed progressively", () => {
  const top = Math.max(...index.nodes.filter((n) => n.identity.catalogId === "nist-800-53").map((n) => engine.degree(n.id)));
  assert.ok(top >= 20, `expected a dense 800-53 hub record, found max degree ${top}`);
});
