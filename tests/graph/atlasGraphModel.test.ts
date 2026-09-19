import assert from "node:assert/strict";
import test from "node:test";

// Research traversal is part of the required graph gate.
import "./atlasResearch.test";

import {
  buildAtlasGraphModel,
  type AtlasGraphModelInput,
} from "../../src/ui/lib/atlasGraphModel";

const input: AtlasGraphModelInput = {
  nodes: [
    {
      id: "framework:b",
      node_type: "catalog",
      label: "Framework B",
      source_id: "official-b",
      metadata: {
        catalog_id: "framework-b",
        mandate: "authoritative-b",
        structural_descendant_record_count: 24,
      },
    },
    {
      id: "framework:a",
      node_type: "catalog",
      label: "Framework A",
      source_id: "official-a",
      metadata: {
        catalog_id: "framework-a",
        mandate: "authoritative-a",
      },
    },
  ],
  edges: [
    {
      id: "edge:parallel-2",
      source_node_id: "framework:a",
      target_node_id: "framework:b",
      relationship_type: "maps_to",
      relationship_class: "correlation",
      direction: "directed",
      authority_class: "publisher",
    },
    {
      id: "edge:parallel-1",
      source_node_id: "framework:a",
      target_node_id: "framework:b",
      relationship_type: "contains",
      relationship_class: "structural",
      directed: true,
      authority_class: "publisher",
    },
    {
      id: "edge:undirected",
      source_node_id: "framework:b",
      target_node_id: "framework:a",
      relationship_type: "equivalent_to",
      relationship_class: "correlation",
      direction: "undirected",
      authority_class: "publisher",
    },
  ],
};

test("semantic projection preserves canonical IDs, direction, and parallel edges", () => {
  const graph = buildAtlasGraphModel(input);

  assert.equal(graph.type, "mixed");
  assert.equal(graph.multi, true);
  assert.deepEqual(graph.nodes(), ["framework:a", "framework:b"]);
  assert.deepEqual(graph.edges(), [
    "edge:parallel-1",
    "edge:parallel-2",
    "edge:undirected",
  ]);
  assert.equal(graph.directedSize, 2);
  assert.equal(graph.undirectedSize, 1);
  assert.equal(graph.isDirected("edge:parallel-1"), true);
  assert.equal(graph.isUndirected("edge:undirected"), true);
  assert.deepEqual(
    graph.getEdgeAttribute("edge:parallel-2", "source"),
    input.edges[0],
  );
});

test("display metadata is separate from unchanged authoritative source data", () => {
  const graph = buildAtlasGraphModel(input);
  const attributes = graph.getNodeAttributes("framework:b");

  assert.equal(attributes.display.descendantRecordCount, 24);
  assert.equal(attributes.display.label, "Framework B");
  assert.equal(
    (attributes.source.metadata as Record<string, unknown>).mandate,
    "authoritative-b",
  );
  assert.equal("computedCommunity" in attributes.source, false);
  assert.deepEqual(attributes.source, input.nodes[0]);
});

test("semantic projection rejects dangling endpoints instead of inventing nodes", () => {
  assert.throws(
    () => buildAtlasGraphModel({
      nodes: input.nodes,
      edges: [{
        id: "edge:dangling",
        source_node_id: "framework:a",
        target_node_id: "framework:missing",
      }],
    }),
    /missing target node framework:missing/,
  );
});
