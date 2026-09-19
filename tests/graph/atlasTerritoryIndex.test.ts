import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import treeSpine from "../../data/curated/tree-spine.json";
import geometry from "../../data/curated/atlas-territory-geography.json";
import { isAtlasResearchEdge } from "../../src/ui/lib/atlasResearch";
import {
  TERRITORY_INDEX_MAX_BYTES, buildTerritoryIndex, validateTerritoryIndex, validateTerritoryManifest, type TerritoryBuildInput,
} from "../../src/ui/lib/atlasTerritoryIndex";
import { readGeneratedCollection } from "../../scripts/lib/generated-graph-artifacts.mjs";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const catalogIds = [...Object.keys(treeSpine.catalogLimbs), ...treeSpine.syntheticCatalogs.map((c) => c.catalog_id)];
const nodes = readGeneratedCollection(process.cwd(), "nodes").nodes;
const edges = readGeneratedCollection(process.cwd(), "edges").edges;
const input: TerritoryBuildInput = {
  generatedAt: read("data/generated/edges.json").generated_at, geometryVersion: geometry.version, catalogIds,
  identities: read("data/generated/publication-identity-index.json").identities, sources: read("data/source-registry.json").sources, nodes, edges,
};
const { index, admittedEdgeCount } = buildTerritoryIndex(input);
const routeOf = (a: string, b: string) => index.routes.find((r) => r.key === (a < b ? `${a}|${b}` : `${b}|${a}`));
const neighbors = (id: string) => new Set(index.routes.filter((r) => r.a === id || r.b === id).map((r) => (r.a === id ? r.b : r.a)));

test("every mapped publication appears once with its name, publisher, kind and area", () => {
  assert.equal(index.publications.length, catalogIds.length);
  assert.equal(new Set(index.publications.map((p) => p.id)).size, catalogIds.length);
  for (const p of index.publications) {
    assert.ok(p.name && p.publisher && p.kind && p.area.startsWith("atlas:LIMB-"), p.id);
    assert.equal(/…|\.\.\.$/.test(p.name), false, `${p.id} name must not be truncated`);
  }
  assert.equal(index.geometryVersion, geometry.version);
});

test("routes come only from published connections admitted by the research policy", () => {
  assert.equal(admittedEdgeCount, edges.filter((e: any) => isAtlasResearchEdge(e, false)).length);
  const total = index.routes.reduce((n, r) => n + r.total, 0);
  assert.ok(total > 0 && total <= admittedEdgeCount, "route counts must not exceed the admitted connections");
  for (const r of index.routes) {
    assert.equal(r.total, r.aToB + r.bToA, r.key);
    assert.ok(r.a < r.b && r.key === `${r.a}|${r.b}`);
    assert.ok(r.sample.edgeId && r.sample.locator, `${r.key} needs sample evidence with a locator`);
    assert.ok(r.types.length > 0);
    const sample: any = edges.find((e: any) => e.id === r.sample.edgeId);
    assert.ok(sample && isAtlasResearchEdge(sample, false), `${r.key} sample must itself be a published connection`);
  }
});

test("neighbouring territories and shared publishers never create a route", () => {
  const withRoute = new Set(index.routes.map((r) => r.key));
  const byArea = new Map<string, string[]>();
  for (const p of index.publications) byArea.set(p.area, [...(byArea.get(p.area) || []), p.id]);
  const unconnectedPairs = [...byArea.values()].flatMap((ids) => ids.flatMap((a, i) => ids.slice(i + 1).map((b) => (a < b ? `${a}|${b}` : `${b}|${a}`))))
    .filter((k) => !withRoute.has(k));
  assert.ok(unconnectedPairs.length > 0, "publications in one territory are not automatically connected");
});

test("a dense hub is dense in the data, so the map must reveal its routes progressively", () => {
  const hub = neighbors("nist-800-53");
  assert.ok(hub.size >= 5, `expected SP 800-53 to be a hub, found ${hub.size} routes`);
});

test("honest zero: CMMC and FedRAMP share no published neighbour publication", () => {
  const shared = [...neighbors("cmmc-2")].filter((id) => neighbors("fedramp-rev5").has(id));
  assert.equal(routeOf("cmmc-2", "fedramp-rev5"), undefined, "no direct published route is recorded between these two");
  assert.deepEqual(shared, [], "an honest answer is none, not a guess");
});

test("authority and other publications are listed separately from the map landmarks", () => {
  const mapped = new Set(index.publications.map((p) => p.id));
  assert.ok(index.authority.length > 0 && index.authority.every((a) => a.id.startsWith("authority-")));
  assert.equal(index.other.length, 2, "two publications have no map position yet");
  for (const o of [...index.authority, ...index.other]) assert.equal(mapped.has(o.id), false);
});

test("the index is small, deterministic and validates against its manifest", () => {
  const again = buildTerritoryIndex(input).index;
  assert.deepEqual(again, index);
  const text = JSON.stringify(index);
  assert.ok(Buffer.byteLength(text) < TERRITORY_INDEX_MAX_BYTES / 4, "should stay far inside its transfer budget");
  const manifest = validateTerritoryManifest({ schemaVersion: 1, generatedAt: index.generatedAt, sha256: "a".repeat(64), bytes: Buffer.byteLength(text),
    publicationCount: index.publications.length, routeCount: index.routes.length, admittedEdgeCount });
  assert.equal(validateTerritoryIndex(JSON.parse(text), manifest, catalogIds).routes.length, index.routes.length);
});

test("validation rejects a wrong release, a missing publication and a bad route", () => {
  const text = JSON.stringify(index);
  const base = { schemaVersion: 1, generatedAt: index.generatedAt, sha256: "b".repeat(64), bytes: text.length, publicationCount: index.publications.length, routeCount: index.routes.length, admittedEdgeCount };
  assert.throws(() => validateTerritoryManifest({ ...base, sha256: "nope" }));
  assert.throws(() => validateTerritoryManifest({ ...base, bytes: TERRITORY_INDEX_MAX_BYTES + 1 }));
  const manifest = validateTerritoryManifest(base);
  assert.throws(() => validateTerritoryIndex({ ...index, generatedAt: "other" }, manifest));
  assert.throws(() => validateTerritoryIndex({ ...index, publications: index.publications.slice(1) }, manifest, catalogIds));
  const broken = JSON.parse(text);
  broken.routes[0].b = "unknown-publication";
  assert.throws(() => validateTerritoryIndex(broken, manifest, catalogIds));
});
