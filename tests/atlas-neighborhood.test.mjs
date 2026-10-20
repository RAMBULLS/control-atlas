import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  atlasNeighborhoodShardId,
  buildAtlasNeighborhoodShards,
} from "../src/app/atlas-neighborhood.mjs";
import {
  ancestorChain,
  buildAncestorGraph,
} from "../src/app/ancestor-path.mjs";
import { readGeneratedCollection } from "../scripts/lib/generated-graph-artifacts.mjs";

test("Atlas neighborhood sharding is deterministic and preserves canonical edges", () => {
  const graph = {
    nodes: [
      { id: "a", node_type: "control", label: "A", metadata: { item_id: "A", title: "Alpha", description: "Alpha's official description." } },
      { id: "b", node_type: "control", label: "B", metadata: { item_id: "B", title: "Beta", description: "Beta's official description." } },
      { id: "c", node_type: "control", label: "C", metadata: { item_id: "C", title: "Gamma" } },
    ],
    edges: [
      {
        id: "edge:published",
        source_node_id: "a",
        target_node_id: "b",
        relationship_type: "maps_to",
        provenance_class: "federal_published",
        publication_status: "published",
        confidence: "direct",
        source_refs: [{ source_id: "source-a", ref_type: "primary", locator: "row-1" }],
      },
      {
        id: "edge:candidate",
        source_node_id: "a",
        target_node_id: "c",
        relationship_type: "related_to",
        provenance_class: "inferred",
        publication_status: "candidate",
        confidence: "low",
        source_refs: [],
      },
    ],
  };

  const first = buildAtlasNeighborhoodShards(graph, 8);
  const second = buildAtlasNeighborhoodShards(graph, 8);
  assert.deepEqual(first, second);
  const finer = buildAtlasNeighborhoodShards(graph, 2048);
  const records = (shards) => Object.fromEntries(shards.flatMap(shard => Object.entries(shard.records)));
  assert.deepEqual(records(finer), records(first), "finer shards preserve every complete record and edge");
  assert.equal(finer.reduce((count, shard) => count + shard.record_count, 0), graph.nodes.length);
  for (const shard of finer) {
    for (const id of Object.keys(shard.records)) {
      assert.equal(shard.shard_id, atlasNeighborhoodShardId(id, 2048));
    }
  }
  const record = first
    .find((shard) => shard.shard_id === atlasNeighborhoodShardId("a", 8))
    .records.a;
  assert.equal(record.published_connection_count, 1);
  assert.equal(record.candidate_connection_count, 1);
  assert.deepEqual(record.center_node, graph.nodes[0]);
  assert.deepEqual(record.nodes.map((node) => node[0]), ["a", "b", "c"]);
  assert.equal(
    record.nodes.find((node) => node[0] === "b")[8],
    "Beta's official description.",
    "counterpart descriptions must survive compact neighborhood transport",
  );
  assert.equal(record.nodes.find((node) => node[0] === "a")[9], 0);
  assert.equal(record.nodes.find((node) => node[0] === "a")[10], 1);
  assert.deepEqual(record.structural_path, ["a"]);
  assert.deepEqual(record.edges.map((edge) => edge[0]), ["edge:published", "edge:candidate"]);

  const zeroRecord = first
    .find((shard) => shard.shard_id === atlasNeighborhoodShardId("c", 8))
    .records.c;
  assert.equal(zeroRecord.published_connection_count, 0);
  assert.equal(zeroRecord.candidate_connection_count, 1);
});

test("Atlas neighborhood records carry the canonical structural path for cold deep links", () => {
  const graph = {
    nodes: [
      { id: "x:root", node_type: "catalog", label: "Catalog", metadata: { catalog_id: "x" } },
      { id: "x:family", node_type: "family", label: "Family", metadata: { catalog_id: "x" } },
      { id: "x:item", node_type: "control", label: "Item", metadata: { catalog_id: "x" } },
    ],
    edges: [
      {
        id: "root-family",
        source_node_id: "x:root",
        target_node_id: "x:family",
        relationship_type: "contains",
        relationship_class: "structural",
        publication_status: "published",
        source_refs: [],
      },
      {
        id: "family-item",
        source_node_id: "x:family",
        target_node_id: "x:item",
        relationship_type: "contains",
        relationship_class: "structural",
        publication_status: "published",
        source_refs: [],
      },
    ],
  };
  const shards = buildAtlasNeighborhoodShards(graph, 8);
  const record = shards
    .find((shard) => shard.shard_id === atlasNeighborhoodShardId("x:item", 8))
    .records["x:item"];
  assert.deepEqual(record.structural_path, [
    "x:root",
    "x:family",
    "x:item",
  ]);
});

test("Atlas neighborhood records preserve every publisher structural membership path", () => {
  const graph = {
    nodes: [
      { id: "attack:catalog", node_type: "catalog", label: "ATT&CK", metadata: { catalog_id: "attack" } },
      { id: "attack:tactic-a", node_type: "tactic", label: "Tactic A", metadata: { catalog_id: "attack" } },
      { id: "attack:tactic-b", node_type: "tactic", label: "Tactic B", metadata: { catalog_id: "attack" } },
      { id: "attack:T1000", node_type: "attack_technique", label: "Technique", metadata: { catalog_id: "attack" } },
    ],
    edges: [
      { id: "catalog-a", source_node_id: "attack:catalog", target_node_id: "attack:tactic-a", relationship_type: "contains", relationship_class: "structural", publication_status: "published", source_refs: [] },
      { id: "catalog-b", source_node_id: "attack:catalog", target_node_id: "attack:tactic-b", relationship_type: "contains", relationship_class: "structural", publication_status: "published", source_refs: [] },
      { id: "a-technique", source_node_id: "attack:tactic-a", target_node_id: "attack:T1000", relationship_type: "contains", relationship_class: "structural", publication_status: "published", source_refs: [] },
      { id: "b-technique", source_node_id: "attack:tactic-b", target_node_id: "attack:T1000", relationship_type: "contains", relationship_class: "structural", publication_status: "published", source_refs: [] },
    ],
  };
  const record = buildAtlasNeighborhoodShards(graph, 8)
    .find((shard) => shard.shard_id === atlasNeighborhoodShardId("attack:T1000", 8))
    .records["attack:T1000"];
  assert.deepEqual(record.structural_paths, [
    ["attack:catalog", "attack:tactic-a", "attack:T1000"],
    ["attack:catalog", "attack:tactic-b", "attack:T1000"],
  ]);
});

test("displayed structural paths compose one authority hop without changing canonical ancestry", () => {
  const graph = {
    nodes: [
      {
        id: "authority:EO-EXAMPLE",
        node_type: "policy_directive",
        label: "Executive Order Example",
        metadata: { title: "Executive Order Example" },
      },
      {
        id: "atlas:TRUNK",
        node_type: "trunk",
        label: "Cybersecurity",
      },
      {
        id: "atlas:LIMB-TEST",
        node_type: "limb",
        label: "Test",
      },
      {
        id: "x:CATALOG",
        node_type: "catalog",
        label: "Catalog",
        metadata: {
          catalog_id: "x",
          primary_authority: "authority:EO-EXAMPLE",
        },
      },
      {
        id: "x:item",
        node_type: "control",
        label: "Item",
        metadata: { catalog_id: "x" },
      },
    ],
    edges: [
      {
        id: "trunk-limb",
        source_node_id: "atlas:TRUNK",
        target_node_id: "atlas:LIMB-TEST",
        relationship_type: "organizes",
        relationship_class: "organizing",
        publication_status: "editorial",
        source_refs: [],
      },
      {
        id: "limb-catalog",
        source_node_id: "atlas:LIMB-TEST",
        target_node_id: "x:CATALOG",
        relationship_type: "organizes",
        relationship_class: "organizing",
        publication_status: "editorial",
        source_refs: [],
      },
      {
        id: "catalog-item",
        source_node_id: "x:CATALOG",
        target_node_id: "x:item",
        relationship_type: "contains",
        relationship_class: "structural",
        publication_status: "published",
        source_refs: [],
      },
      {
        id: "catalog-authority",
        source_node_id: "x:CATALOG",
        target_node_id: "authority:EO-EXAMPLE",
        relationship_type: "issued_under",
        relationship_class: "organizing",
        publication_status: "published",
        source_refs: [
          { source_id: "official-example", ref_type: "primary", locator: "section-1" },
        ],
      },
    ],
  };

  const canonicalGraph = buildAncestorGraph(graph.nodes, graph.edges);
  assert.deepEqual(
    ancestorChain("x:item", canonicalGraph).map((link) => link.id),
    ["atlas:TRUNK", "atlas:LIMB-TEST", "x:CATALOG", "x:item"],
  );

  const shards = buildAtlasNeighborhoodShards(graph, 8);
  const record = shards
    .find((shard) => shard.shard_id === atlasNeighborhoodShardId("x:item", 8))
    .records["x:item"];
  assert.deepEqual(record.structural_path, [
    "authority:EO-EXAMPLE",
    "atlas:TRUNK",
    "atlas:LIMB-TEST",
    "x:CATALOG",
    "x:item",
  ]);
  assert.ok(
    record.nodes.some((node) => node[0] === "authority:EO-EXAMPLE"),
    "the composed authority hop must travel with the neighborhood shard",
  );
});

test("generated Atlas shards contain only incident canonical edges", () => {
  const canonicalEdges = new Map(
    readGeneratedCollection(".", "edges").edges.map((edge) => [edge.id, edge]),
  );
  const incidentEdges = new Map();
  for (const edge of canonicalEdges.values()) {
    for (const id of new Set([edge.source_node_id, edge.target_node_id])) {
      const ids = incidentEdges.get(id) || [];
      ids.push(edge.id);
      incidentEdges.set(id, ids);
    }
  }
  const canonicalNodes = readGeneratedCollection(".", "nodes").nodes;
  const canonicalNodeById = new Map(
    canonicalNodes.map((node) => [node.id, node]),
  );
  const canonicalNodeIds = new Set(canonicalNodeById.keys());
  const shardDir = "data/generated/atlas-neighborhood";
  const shardedNodeIds = new Set();
  let recordCount = 0;
  for (const filename of readdirSync(shardDir)) {
    const artifact = JSON.parse(readFileSync(join(shardDir, filename), "utf8"));
    for (const [nodeId, record] of Object.entries(artifact.atlas_neighborhood_shard.records)) {
      recordCount += 1;
      shardedNodeIds.add(nodeId);
      assert.equal(artifact.atlas_neighborhood_shard.shard_id, atlasNeighborhoodShardId(nodeId));
      assert.deepEqual(record.edges.map(edge => edge[0]).sort(), (incidentEdges.get(nodeId) || []).sort(), `${nodeId} keeps every incident relationship`);
      // ancestor_path is attached to the shard copy on purpose: it is how the
      // record page draws the chain to the trunk without loading the graph. It
      // is stripped from nodes.json to stay inside the 20 MiB artifact budget,
      // so compare the record identity separately from that navigation aid.
      const { ancestor_path: shardAncestorPath, ...shardCenterNode } =
        record.center_node;
      assert.deepEqual(
        shardCenterNode,
        canonicalNodeById.get(nodeId),
        `${nodeId} center node must be canonical`,
      );
      if (shardAncestorPath) {
        assert.equal(
          shardAncestorPath[0].id,
          "atlas:TRUNK",
          `${nodeId} ancestor path must start at the trunk`,
        );
        for (const link of shardAncestorPath) {
          assert.ok(
            canonicalNodeIds.has(link.id),
            `${link.id} in ${nodeId} ancestor path must be a canonical node`,
          );
        }
      }
      for (const compactNode of record.nodes) {
        assert.ok(
          canonicalNodeIds.has(compactNode[0]),
          `${compactNode[0]} neighborhood node must be canonical`,
        );
      }
      for (const compactEdge of record.edges) {
        const [edgeId, sourceNodeId, targetNodeId] = compactEdge;
        assert.ok(canonicalEdges.has(edgeId), `${edgeId} must be canonical`);
        assert.ok(
          sourceNodeId === nodeId || targetNodeId === nodeId,
          `${edgeId} must touch ${nodeId}`,
        );
      }
    }
  }
  // Stronger than the previous hardcoded `recordCount === 11_486`: assert the
  // invariant that literal was standing in for — the shards cover EXACTLY the
  // canonical node set, with no missing and no orphaned shard records. A magic
  // number silently had to be bumped on every legitimate data change (it broke
  // when the GRC tier nodes were added) while never actually proving coverage.
  assert.equal(recordCount, canonicalNodeIds.size);
  const missing = [...canonicalNodeIds].filter((id) => !shardedNodeIds.has(id));
  const orphaned = [...shardedNodeIds].filter((id) => !canonicalNodeIds.has(id));
  assert.deepEqual(missing, [], "every canonical node needs a shard record");
  assert.deepEqual(orphaned, [], "no shard record may reference a dropped node");
});

test("generated AC-2.1 display path adds authority while canonical ancestry does not", () => {
  const nodeId = "nist-800-53:AC-2.1";
  const shardId = atlasNeighborhoodShardId(nodeId);
  const artifact = JSON.parse(
    readFileSync(`data/generated/atlas-neighborhood/${shardId}.json`, "utf8"),
  );
  const record = artifact.atlas_neighborhood_shard.records[nodeId];
  assert.ok(record, `missing generated neighborhood record for ${nodeId}`);
  assert.equal(record.structural_path[0], "authority:USC-40-11331");
  assert.deepEqual(record.structural_path.slice(-4), [
    "nist-800-53:CATALOG",
    "nist-800-53:FAMILY-AC",
    "nist-800-53:AC-2",
    "nist-800-53:AC-2.1",
  ]);
  assert.equal(record.center_node.ancestor_path[0].id, "atlas:TRUNK");
  assert.equal(
    record.center_node.ancestor_path.some((link) => link.id.startsWith("authority:")),
    false,
  );
});
