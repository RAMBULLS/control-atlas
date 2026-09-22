import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildAtlasGraphModel,
  type AtlasGraphSourceEdge,
  type AtlasGraphSourceNode,
} from "../../src/ui/lib/atlasGraphModel";
import { buildAtlasSemanticProjections } from "../../src/ui/lib/atlasGraphProjection";
import {
  buildAtlasCatalogMemberships,
  type AtlasSourceRegistry,
} from "../../src/ui/lib/atlasPublisherHierarchy";
import type { AtlasSpine } from "../../src/ui/lib/atlasDrilldown";
import { buildAtlasTreeModel } from "../../src/ui/lib/atlasTreeModel";

const GENERATED = join("data", "generated");

type ShardedManifest = {
  generated_at: string;
  sharded_collection: { record_count: number; shards: Array<{ path: string }> };
};

function loadCollection<T>(manifestName: string, key: string) {
  const manifest = JSON.parse(
    readFileSync(join(GENERATED, manifestName), "utf8"),
  ) as ShardedManifest;
  const records = manifest.sharded_collection.shards.flatMap((shard) => {
    const artifact = JSON.parse(
      readFileSync(join(GENERATED, shard.path), "utf8"),
    ) as Record<string, T[]>;
    return artifact[key] || [];
  });
  return { generatedAt: manifest.generated_at, records };
}

/**
 * Built here from the same inputs the ship script uses, rather than read from
 * `data/generated/atlas-network.json`.
 *
 * That file is not produced by `build:data`, so no data-generation step
 * guarantees it — and at ~31 MiB it exceeds the 20 MiB per-file budget
 * `check:data-size` enforces, so everything that touches generated data
 * removes it. `build:site` does, and so does `tests/framework-data.test.mjs`,
 * which calls buildFrameworkData() at module load several suites earlier in
 * the same `npm test` chain. Reading the file made this suite fail on ENOENT
 * and take its seven subtests down with it, in CI's unit job as much as
 * locally. `nodes.json`, `edges.json` and `atlas-spine.json` are generated and
 * do survive, so this builds from those — the same composition
 * scripts/build-atlas-network-artifact.ts performs.
 */
const nodeCollection = loadCollection<AtlasGraphSourceNode>("nodes.json", "nodes");
const edgeCollection = loadCollection<AtlasGraphSourceEdge>("edges.json", "edges");
const spineArtifact = JSON.parse(
  readFileSync(join(GENERATED, "atlas-spine.json"), "utf8"),
) as { atlas_spine: AtlasSpine };
const registry = JSON.parse(
  readFileSync(join("data", "source-registry.json"), "utf8"),
) as AtlasSourceRegistry;

const artifact = buildAtlasSemanticProjections({
  graph: buildAtlasGraphModel({
    nodes: nodeCollection.records,
    edges: edgeCollection.records,
  }),
  model: buildAtlasTreeModel(spineArtifact.atlas_spine),
  generatedAt: nodeCollection.generatedAt,
  catalogMemberships: buildAtlasCatalogMemberships(registry),
});

const catalogOf = new Map(
  artifact.frameworks.nodes.map((node) => [node.id, node.publicationId]),
);
const shared = artifact.framework_shared_ground;
const between = (a: string, b: string) =>
  shared.find((edge) => {
    const pair = [catalogOf.get(edge.source), catalogOf.get(edge.target)].sort();
    return pair[0] === [a, b].sort()[0] && pair[1] === [a, b].sort()[1];
  });

test("the two zero trust catalogs meet on the controls they both select", () => {
  // Neither NIST nor DoD published a mapping between their zero trust
  // catalogs, so a map of published crosswalks alone draws them as unrelated.
  // They select 53 of the same 800-53 controls, which is the thing a
  // practitioner is looking for and the reason this derivation exists.
  const overlap = between("dod-zt", "nist-zt");
  assert.ok(overlap, "expected shared ground between dod-zt and nist-zt");
  assert.equal(overlap!.sharedCount, 53);
  assert.deepEqual(overlap!.viaPublicationIds, ["nist-800-53"]);
});

test("a derived overlap names the records it is made of", () => {
  const overlap = between("dod-zt", "nist-zt")!;
  assert.ok(overlap.sampleNodeIds.length > 0);
  for (const id of overlap.sampleNodeIds) {
    // Every claimed record must be followable back to a published location.
    assert.ok(artifact.record_locations[id], `${id} has no published location`);
    assert.equal(artifact.record_locations[id]!.publicationId, "nist-800-53");
  }
});

test("overlap strength is measured against the narrower framework", () => {
  // 53 of NIST ZT's 71 selected controls, not 53 of 800-53's 1,216.
  const overlap = between("dod-zt", "nist-zt")!;
  assert.ok(overlap.overlapRatio > 0.7, `ratio was ${overlap.overlapRatio}`);
  assert.ok(overlap.overlapRatio <= 1);
});

test("a published crosswalk is never restated as a derived overlap", () => {
  const published = new Set(
    artifact.frameworks.edges.map((edge) =>
      [catalogOf.get(edge.source), catalogOf.get(edge.target)].sort().join("|"),
    ),
  );
  for (const edge of shared) {
    const pair = [catalogOf.get(edge.source), catalogOf.get(edge.target)].sort().join("|");
    assert.ok(!published.has(pair), `${pair} is both published and derived`);
  }
});

test("derived overlaps are kept out of the published edge set", () => {
  // The two must never be counted together: one is what a publisher stated,
  // the other is what the records happen to say.
  const ids = new Set(artifact.frameworks.edges.map((edge) => edge.id));
  for (const edge of shared) assert.ok(!ids.has(edge.id));
  // Issue 279: FedRAMP control context now carries a real published edge to
  // the SP 800-53 control it annotates, which is a genuinely new
  // fedramp-2026 <-> nist-800-53 framework pairing (there was none before).
  assert.equal(artifact.frameworks.edges.length, 28);
});

test("coincidental single-record overlaps are not reported", () => {
  for (const edge of shared) assert.ok(edge.sharedCount >= 3);
});

test("every derived overlap joins two frameworks that are actually drawn", () => {
  const drawn = new Set(artifact.frameworks.nodes.map((node) => node.id));
  for (const edge of shared) {
    assert.ok(drawn.has(edge.source), `${edge.source} not drawn`);
    assert.ok(drawn.has(edge.target), `${edge.target} not drawn`);
    assert.notEqual(edge.source, edge.target);
  }
});

test("ATT&CK reaches the control catalogs it has no direct mapping to", () => {
  // MITRE publishes ATT&CK to D3FEND, and D3FEND carries a thin mapping into
  // 800-53; the overlap is how the threat side reaches compliance at all.
  const overlap = between("mitre-attack", "nist-800-53");
  assert.ok(overlap, "expected ATT&CK to reach 800-53 through shared records");
  assert.deepEqual(overlap!.viaPublicationIds, ["mitre-d3fend"]);
});
