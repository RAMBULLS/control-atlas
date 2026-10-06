import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveLayoutMode,
  topologyFingerprint,
} from "../src/ui/lib/graphLayoutCore.mjs";

test("topologyFingerprint is stable for the same graph", () => {
  const fingerprint = topologyFingerprint(
    "center",
    ["b", "a", "c"],
    ["e2", "e1"],
  );
  assert.equal(fingerprint, "center|a,b,c|e1,e2");
});

test("resolveLayoutMode uses incremental layout for cluster expand", () => {
  const prev = topologyFingerprint("center", ["center", "cluster:disa-ccis"], ["e1"]);
  const prevIds = new Set(["center", "cluster:disa-ccis"]);
  const nextIds = new Set([
    "center",
    "disa-cci:1",
    "disa-cci:2",
    "disa-cci:3",
  ]);
  const next = topologyFingerprint("center", [...nextIds], ["e1", "e2", "e3"]);

  assert.equal(resolveLayoutMode(prev, next, prevIds, nextIds), "incremental");
});

test("resolveLayoutMode uses full layout for center changes", () => {
  const prev = topologyFingerprint("center-a", ["center-a", "n1"], ["e1"]);
  const next = topologyFingerprint("center-b", ["center-b", "n2"], ["e2"]);
  const prevIds = new Set(["center-a", "n1"]);
  const nextIds = new Set(["center-b", "n2"]);

  assert.equal(resolveLayoutMode(prev, next, prevIds, nextIds), "full");
});

test("resolveLayoutMode skips layout when topology is unchanged", () => {
  const fingerprint = topologyFingerprint("center", ["center", "n1"], ["e1"]);
  const ids = new Set(["center", "n1"]);
  assert.equal(resolveLayoutMode(fingerprint, fingerprint, ids, ids), "none");
});

test("graph layout source keeps required React Flow and ELK contract", () => {
  const graphLayout = readFileSync("src/ui/lib/graphLayout.ts", "utf8");
  const relationshipGraph = readFileSync(
    "src/ui/components/RelationshipGraph.tsx",
    "utf8",
  );
  const territoryPage = readFileSync("src/ui/pages/AtlasTerritoryPage.tsx", "utf8");
  const relationshipExplorer = readFileSync(
    "src/ui/components/RelationshipExplorer.tsx",
    "utf8",
  );

  assert.match(graphLayout, /topologyFingerprint/);
  assert.match(graphLayout, /truncateCanvasLabel/);
  assert.match(relationshipGraph, /from "@xyflow\/react"/);
  // ELK stays the deterministic layout engine, but must not join the initial
  // application bundle. Relationship views load it only when the user opens a
  // bounded graph.
  assert.match(relationshipGraph, /import\("elkjs\/lib\/elk\.bundled\.js"\)/);
  assert.match(relationshipGraph, /elk\s*\.\s*layout/);
  assert.match(relationshipGraph, /<ReactFlow/);
  assert.match(relationshipGraph, /<MiniMap/);
  assert.match(relationshipGraph, /<Controls/);
  assert.match(relationshipGraph, /Arranging/);
  assert.match(relationshipGraph, /nodesDraggable=\{false\}/);
  assert.match(relationshipGraph, /panOnScroll=\{false\}/);
  assert.match(relationshipGraph, /zoomOnScroll/);
  assert.match(
    relationshipGraph,
    /lastArrangedKeyRef\.current === arrangementKey/,
  );
  assert.match(relationshipGraph, /setLayoutRevision/);
  // The Atlas is the territory sheet; it carries no ReactFlow/ELK dependency
  // at all. RelationshipExplorer still owns the lazy-loaded force-graph contract.
  assert.match(relationshipExplorer, /import\("\.\/RelationshipGraph"\)/);
  assert.doesNotMatch(territoryPage, /elkjs|@xyflow\/react|<ReactFlow/);
});
