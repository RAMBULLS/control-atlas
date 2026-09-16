import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { atlasNeighborhoodShardId } from "../../src/app/atlas-neighborhood.mjs";
import type { AtlasSpine } from "../../src/ui/lib/atlasDrilldown";
import {
  atlasDisplayTrace,
  buildAtlasTreeModel,
  canonicalAtlasPath,
  extendDisplayedAuthorityTrace,
} from "../../src/ui/lib/atlasTreeModel";
import {
  preserveTreeIdentityWithOverlay,
  rankAtlasMappingOverlay,
} from "../../src/ui/lib/atlasTreeOverlay";
import type {
  AtlasNeighborhoodEdge,
  AtlasNeighborhoodNode,
  AtlasNeighborhoodRecord,
} from "../../src/ui/lib/runtimeLoader";
import { canonicalizeHashLocation } from "../../src/ui/lib/routeIdentity";
import { parseViewState, serializeViewState } from "../../src/ui/lib/viewState";

const spine = JSON.parse(
  readFileSync(new URL("../../data/generated/atlas-spine.json", import.meta.url), "utf8"),
).atlas_spine as AtlasSpine;
const model = buildAtlasTreeModel(spine);

function neighborhood(nodeId: string): AtlasNeighborhoodRecord {
  const shardId = atlasNeighborhoodShardId(nodeId);
  const artifact = JSON.parse(readFileSync(
    new URL(`../../data/generated/atlas-neighborhood/${shardId}.json`, import.meta.url), "utf8",
  )).atlas_neighborhood_shard;
  const record = artifact.records[nodeId];
  const nodes = record.nodes.map((node: string[]) => ({
    id: node[0], node_type: node[1], source_id: node[5],
    metadata: { item_id: node[2], title: node[3], catalog_id: node[4], family: node[6], description: node[8] },
  })) satisfies AtlasNeighborhoodNode[];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = record.edges.map((edge: unknown[]) => ({
    id: edge[0], source_node_id: edge[1], target_node_id: edge[2], relationship_type: edge[3],
    relationship_class: edge[4], provenance_class: edge[5], publication_status: edge[6], confidence: edge[7],
    source_refs: (edge[8] as string[][]).map(([source_id, ref_type, locator]) => ({ source_id, ref_type, locator })),
  })) as AtlasNeighborhoodEdge[];
  const center = nodeById.get(nodeId)!;
  const structural_path = (record.structural_path || []).flatMap((id: string) => {
    const node = nodeById.get(id);
    if (!node) return [];
    return [{
      id,
      label: node.metadata?.title || id,
      node_type: node.node_type || "",
      origin: node.node_type === "statute" || node.node_type === "regulation" || node.node_type === "policy_directive"
        ? "authority" as const
        : node.node_type === "trunk" || node.node_type === "limb"
          ? "organizing" as const
          : "structural" as const,
    }];
  });
  return { center_node: center, nodes, edges, structural_path, published_connection_count: record.published_connection_count, candidate_connection_count: record.candidate_connection_count };
}

test("authority trace follows the declared parent chain while canonical ancestry stays authority-free", () => {
  const canonical = canonicalAtlasPath(model, "disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG");
  assert.deepEqual(canonical.map((node) => node.id).slice(0, 3), [
    "atlas:TRUNK", "atlas:LIMB-IMPLEMENTATION", "disa-stig:CATALOG",
  ]);
  assert.ok(canonical.every((node) => node.level !== "authority"));
  const trace = atlasDisplayTrace(model, "disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG");
  assert.deepEqual(trace.map((hop) => hop.id).slice(0, 2), [
    "authority:DODD-5144.02", "authority:DODI-8500.01",
  ]);
  assert.equal(JSON.stringify(trace), JSON.stringify(extendDisplayedAuthorityTrace(model, trace)));
});

test("the record rail and Atlas trace use the same full authority hop sequence", () => {
  const record = neighborhood("disa-stig:V-271431");
  const displayedRail = extendDisplayedAuthorityTrace(model, record.structural_path);
  const expected = [
    ...atlasDisplayTrace(model, "disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG"),
    record.structural_path.at(-1)!,
  ];
  assert.deepEqual(displayedRail.map((hop) => hop.id), expected.map((hop) => hop.id));
});

test("CCI-000366 ranks 24 highlights plus one Compare summary chip without mutating tree identity", () => {
  const overlay = rankAtlasMappingOverlay(neighborhood("disa-cci:CCI-000366"));
  assert.equal(overlay.highlights.length, 24);
  assert.equal(overlay.overflowCount, 5_500);
  assert.equal(overlay.summaryChip?.destination, "compare");
  const nodes = [{ id: "atlas:TRUNK" }];
  const edges = [{ id: "tree:trunk-area" }];
  const decorated = preserveTreeIdentityWithOverlay(nodes, edges, overlay);
  assert.strictEqual(decorated.nodes, nodes);
  assert.strictEqual(decorated.edges, edges);
  assert.equal(decorated.highlightedIds.size, 0);
});

test("a median mapped node yields one highlight and no summary chip", () => {
  const overlay = rankAtlasMappingOverlay(neighborhood("disa-cci:CCI-000079"));
  assert.equal(overlay.highlights.length, 1);
  assert.equal(overlay.summaryChip, null);
});

test("overlay ranking prefers publisher-declared, then confidence, then lexical ID", () => {
  const ids = ["center", "publisher-z", "publisher-a", "publisher-moderate", "derived-direct"];
  const nodes = ids.map((id) => ({ id, metadata: { title: id } }));
  const edge = (
    target_node_id: string,
    provenance_class: string,
    confidence: string,
  ): AtlasNeighborhoodEdge => ({
    id: `edge:${target_node_id}`,
    source_node_id: "center",
    target_node_id,
    relationship_type: "maps_to",
    relationship_class: "correlation",
    provenance_class,
    publication_status: "published",
    confidence,
  });
  const overlay = rankAtlasMappingOverlay({
    center_node: nodes[0],
    nodes,
    edges: [
      edge("derived-direct", "control_atlas_derived", "direct"),
      edge("publisher-moderate", "federal_published", "moderate"),
      edge("publisher-z", "federal_published", "high"),
      edge("publisher-a", "federal_published", "high"),
    ],
  });
  assert.deepEqual(overlay.highlights.map((entry) => entry.node.id), [
    "publisher-a", "publisher-z", "publisher-moderate", "derived-direct",
  ]);
});

test("atlasBenchmark survives parse, serialization, and canonical route handling", () => {
  const benchmarkId = "disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG";
  const parsed = parseViewState(`?view=atlas-map&atlasFramework=disa-stig&atlasBenchmark=${benchmarkId}`);
  assert.equal(parsed.view, "atlas-map");
  if (parsed.view !== "atlas-map") return;
  assert.equal(parsed.atlasBenchmark, benchmarkId);
  assert.match(serializeViewState(parsed), /atlasBenchmark=disa-stig%3ABENCHMARK-ORACLE-LINUX-9-STIG/);
  const canonical = canonicalizeHashLocation(`#/atlas?atlasFramework=disa-stig&atlasBenchmark=${benchmarkId}`);
  assert.match(canonical.canonicalPath, /atlasBenchmark=disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG/);
  assert.equal(canonical.requiresReplace, false);
});
