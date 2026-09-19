import assert from "node:assert/strict";
import test from "node:test";
import { normalizeViewState, parseViewState, serializeViewState } from "../../src/ui/lib/viewState";
import { runtimeArtifactPlan } from "../../src/ui/lib/runtimeLoader";
import { atlasSurfaceFor, territoryFocusOf, territoryHasWork, territoryModeOf, territoryPatch, territoryTargetOf } from "../../src/ui/lib/atlasTerritoryState";

const atlas = (patch: Record<string, unknown> = {}) => normalizeViewState("atlas-map", { view: "atlas-map", ...patch } as never) as never as Record<string, any>;
const roundTrip = (state: Record<string, any>) => parseViewState(serializeViewState(state as never)) as Record<string, any>;

test("the territory sheet is the default surface for the overview and for a focused record", () => {
  assert.equal(atlasSurfaceFor(atlas()), "territory");
  assert.equal(atlasSurfaceFor(atlas({ node: "disa-stig:V-205646" })), "territory");
  assert.equal(atlasSurfaceFor(atlas({ atlasLimb: "atlas:LIMB-COMPLIANCE", atlasFramework: "nist-800-53" })), "territory");
  assert.equal(atlasSurfaceFor(atlas({ atlasAxis: "landscape", atlasFramework: "nist-800-53" })), "territory");
  assert.equal(atlasSurfaceFor(atlas({ atlasLanding: "publishers" })), "territory", "the retired landing lens opens the sheet");
});

test("saved links to earlier scoped views keep opening those views", () => {
  for (const legacy of [{ atlasAxis: "framework" }, { atlasAxis: "process" }, { atlasFamily: "AC" }, { atlasBenchmark: "x" }, { atlasBaseline: "moderate" },
    { atlasRmfStep: "prepare" }, { relationshipView: "list" }, { relationshipType: "maps_to" }, { atlasStage: "s" }, { sourceView: "rmf" }, { atlasParent: "p" }]) {
    assert.equal(atlasSurfaceFor(atlas(legacy)), "classic", JSON.stringify(legacy));
  }
});

test("focus resolves record over publication over territory over overview", () => {
  assert.deepEqual(territoryFocusOf(atlas()), { kind: "overview" });
  assert.deepEqual(territoryFocusOf(atlas({ atlasLimb: "atlas:LIMB-RISK" })), { kind: "territory", id: "atlas:LIMB-RISK" });
  assert.deepEqual(territoryFocusOf(atlas({ atlasLimb: "atlas:LIMB-RISK", atlasFramework: "fips-199" })), { kind: "publication", id: "fips-199" });
  assert.deepEqual(territoryFocusOf(atlas({ atlasFramework: "fips-199", node: "n" })), { kind: "record", id: "n" });
});

test("territory state survives refresh: layer, pins, mode and endpoints round-trip through the URL", () => {
  const patch = territoryPatch({ limb: "atlas:LIMB-COMPLIANCE", pins: ["cmmc-2", "fedramp-rev5"], mode: "shared", layer: "publisher" });
  const back = roundTrip(atlas(patch));
  assert.equal(back.atlasLayer, "publisher");
  assert.equal(back.atlasResearch, "shared");
  assert.deepEqual(territoryTargetOf(back).pins, ["cmmc-2", "fedramp-rev5"]);
  assert.equal(territoryModeOf(roundTrip(atlas(territoryPatch({ node: "disa-stig:V-205646", mode: "upstream", from: "disa-stig:V-205646" })))), "upstream");
});

test("a computed path is never written to the URL, only its endpoints", () => {
  const url = serializeViewState(atlas(territoryPatch({ mode: "path", from: "a", to: "b" })) as never);
  const keys = [...new URLSearchParams(url)].map(([k]) => k).sort();
  assert.deepEqual(keys, ["atlasFrom", "atlasResearch", "atlasTo", "view"]);
  assert.ok(url.length < 200);
});

test("a patch clears what it does not name, and unsupported layers are dropped", () => {
  const p = territoryPatch({ framework: "nist-800-53" });
  assert.deepEqual([p.node, p.atlasLimb, p.atlasPins, p.atlasResearch, p.atlasFrom, p.atlasTo, p.atlasLayer], ["", "", "", "", "", "", ""]);
  const bad = roundTrip(atlas({ atlasLayer: "count" }));
  assert.equal(bad.atlasLayer, "");
});

test("clear actions are offered only when there is something to clear", () => {
  assert.deepEqual(territoryHasWork(atlas()), { pins: false, path: false, layer: false, focus: false });
  const w = territoryHasWork(atlas(territoryPatch({ limb: "atlas:LIMB-RISK", pins: ["a", "b"], mode: "path", from: "a", to: "b", layer: "publisher" })));
  assert.deepEqual(w, { pins: true, path: true, layer: true, focus: true });
});

test("pins are limited to six and de-duplicated", () => {
  const p = territoryPatch({ pins: ["a", "b", "c", "d", "e", "f", "g"] });
  assert.equal(JSON.parse(String(p.atlasPins)).length, 6);
});

test("layer and pin changes do not enter the route transition scope", async () => {
  const app = await import("node:fs").then((fs) => fs.readFileSync("src/ui/App.tsx", "utf8"));
  const scope = app.slice(app.indexOf("function routeTransitionScope"), app.indexOf("case \"catalog-detail\""));
  for (const key of ["atlasLayer", "atlasPins", "atlasFrom", "atlasTo"]) assert.equal(scope.includes(key), false, key);
});

test("the territory sheet skips the relationship network and hierarchy; classic views still load them", () => {
  const overview = runtimeArtifactPlan(atlas() as never);
  assert.deepEqual([overview.atlasNetwork, overview.atlasSpine, overview.fullGraph, overview.recordNodeId], [false, false, false, ""]);
  assert.equal(overview.librarySearch, true);
  const record = runtimeArtifactPlan(atlas({ node: "disa-stig:V-205646" }) as never);
  assert.deepEqual([record.atlasNetwork, record.recordNodeId, record.sources], [false, "disa-stig:V-205646", true]);
  const classic = runtimeArtifactPlan(atlas({ atlasAxis: "framework" }) as never);
  assert.deepEqual([classic.atlasNetwork, classic.atlasSpine], [true, true]);
});
