import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { atlasNeighborhoodShardId } from "../../src/app/atlas-neighborhood.mjs";
import type { AtlasSpine } from "../../src/ui/lib/atlasSpine";
import {
  atlasDisplayTrace,
  buildAtlasTreeModel,
  canonicalAtlasPath,
  extendDisplayedAuthorityTrace,
} from "../../src/ui/lib/atlasTreeModel";
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

test("a saved benchmark link opens that benchmark record on the territory sheet", () => {
  const benchmarkId = "disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG";
  const canonical = canonicalizeHashLocation(`#/atlas?atlasFramework=disa-stig&atlasBenchmark=${benchmarkId}`);
  assert.equal(canonical.canonicalPath, `/atlas/${benchmarkId}?atlasFramework=disa-stig`);
  assert.equal(canonical.requiresReplace, true);
  const parsed = parseViewState(`?view=atlas-map&node=${benchmarkId}`);
  assert.equal(parsed.view === "atlas-map" && parsed.node, benchmarkId);
  assert.match(serializeViewState(parsed), /node=disa-stig%3ABENCHMARK-ORACLE-LINUX-9-STIG/);
});
