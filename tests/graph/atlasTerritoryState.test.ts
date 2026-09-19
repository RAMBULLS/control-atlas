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
  const patch = territoryPatch({ limb: "atlas:LIMB-COMPLIANCE", pins: ["cmmc-2", "fedramp-rev5"], mode: "shared", publisher: "DISA" });
  const back = roundTrip(atlas(patch));
  assert.equal(back.atlasLayer, "publisher:DISA");
  assert.equal(territoryTargetOf(back).publisher, "DISA");
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
  for (const value of ["count", "publisher", "publisher:", "lifecycle:x"]) assert.equal(roundTrip(atlas({ atlasLayer: value })).atlasLayer, "", value);
});

test("clear actions are offered only when there is something to clear", () => {
  assert.deepEqual(territoryHasWork(atlas()), { pins: false, path: false, layer: false, focus: false, context: false });
  const w = territoryHasWork(atlas(territoryPatch({ limb: "atlas:LIMB-RISK", pins: ["a", "b"], mode: "path", from: "a", to: "b", publisher: "DISA" })));
  assert.deepEqual(w, { pins: true, path: true, layer: true, focus: true, context: false });
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
  assert.equal(overview.librarySearch, false, "record search shards load only when the reader reaches for search");
  assert.equal(runtimeArtifactPlan(atlas() as never, { librarySearchRequested: true }).librarySearch, true);
  const record = runtimeArtifactPlan(atlas({ node: "disa-stig:V-205646" }) as never);
  assert.deepEqual([record.atlasNetwork, record.recordNodeId, record.sources], [false, "disa-stig:V-205646", true]);
  const classic = runtimeArtifactPlan(atlas({ atlasAxis: "framework" }) as never);
  assert.deepEqual([classic.atlasNetwork, classic.atlasSpine], [true, true]);
});

test("entering research inside the app changes the runtime scope, so record sources load", async () => {
  const app = await import("node:fs").then((fs) => fs.readFileSync("src/ui/App.tsx", "utf8"));
  assert.match(app, /territory:\$\{viewState\.node \|\| "none"\}:\$\{viewState\.atlasResearch \? "research" : ""\}/);
  assert.equal(runtimeArtifactPlan(atlas({ atlasResearch: "upstream", atlasFrom: "disa-stig:V-205646" }) as never).sources, true);
});

test("context choices and the source dataset round-trip through the URL, bounded and validated", () => {
  const patch = territoryPatch({ context: ["product.microsoft-windows", "program.stig", "asset.server"], dataset: "0123456789ab" });
  const back = roundTrip(atlas(patch));
  assert.equal(back.atlasContext, "asset.server,product.microsoft-windows,program.stig");
  assert.deepEqual(territoryTargetOf(back).context, ["asset.server", "product.microsoft-windows", "program.stig"]);
  assert.equal(back.atlasDataset, "0123456789ab");
  assert.equal(roundTrip(atlas({ atlasDataset: "not-a-dataset" })).atlasDataset, "");
  assert.equal(roundTrip(atlas({ atlasContext: "<script>,program.stig" })).atlasContext, "program.stig");
  assert.equal(territoryHasWork(back).context, true);
  assert.equal(atlasSurfaceFor(back), "territory", "context never sends a link to the earlier workspace");
});

test("context and dataset never carry a computed result", () => {
  const url = serializeViewState(atlas(territoryPatch({ context: ["program.stig"], dataset: "0123456789ab", mode: "path", from: "a", to: "b" })) as never);
  assert.deepEqual([...new URLSearchParams(url)].map(([k]) => k).sort(), ["atlasContext", "atlasDataset", "atlasFrom", "atlasResearch", "atlasTo", "view"]);
});

import { clearContextTarget, clearLayerTarget, clearPathTarget, clearPinsTarget, overviewTarget, territoryClearActions, type ClearableTarget } from "../../src/ui/lib/atlasTerritoryState";

const SCENE: ClearableTarget = {
  limb: "atlas:LIMB-IMPLEMENTATION", framework: "disa-stig", node: "", pins: ["cmmc-2", "fedramp-rev5"], mode: "path", from: "disa-cci", to: "disa-stig",
  publisher: "DISA", context: ["asset.server", "product.microsoft-windows", "program.stig"], dataset: "0123456789ab", direction: "either",
};
const changed = (a: ClearableTarget, b: ClearableTarget) => (Object.keys({ ...a, ...b }) as (keyof ClearableTarget)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();

test("each clear action changes only the fields it names and never the others", () => {
  assert.deepEqual(changed(SCENE, clearPathTarget(SCENE)), ["direction", "from", "mode", "to"]);
  assert.deepEqual(changed(SCENE, clearContextTarget(SCENE)), ["context"]);
  assert.deepEqual(changed(SCENE, clearLayerTarget(SCENE)), ["publisher"]);
  assert.deepEqual(changed(SCENE, clearPinsTarget(SCENE)), ["pins"]);
  assert.deepEqual(changed(SCENE, overviewTarget(SCENE)), ["direction", "framework", "from", "limb", "mode", "to"]);
});

test("Atlas overview keeps pins, context, layer and the source dataset", () => {
  const t = overviewTarget(SCENE);
  assert.deepEqual([t.pins, t.context, t.publisher, t.dataset], [SCENE.pins, SCENE.context, SCENE.publisher, SCENE.dataset]);
  assert.deepEqual([t.limb, t.framework, t.node, t.mode, t.from, t.to], ["", "", "", "explore", "", ""]);
});

test("Clear path keeps focus, pins, context, layer and dataset", () => {
  const t = clearPathTarget(SCENE);
  assert.deepEqual([t.limb, t.framework, t.pins, t.context, t.publisher, t.dataset], [SCENE.limb, SCENE.framework, SCENE.pins, SCENE.context, SCENE.publisher, SCENE.dataset]);
  assert.deepEqual([t.mode, t.from, t.to], ["explore", "", ""]);
});

test("Clear pins leaves shared ground because it needs pins, and keeps context, layer and focus", () => {
  const sharing: ClearableTarget = { ...SCENE, mode: "shared", from: "", to: "" };
  const t = clearPinsTarget(sharing);
  assert.deepEqual([t.pins, t.mode], [[], "explore"]);
  assert.deepEqual([t.limb, t.framework, t.context, t.publisher, t.dataset], [sharing.limb, sharing.framework, sharing.context, sharing.publisher, sharing.dataset]);
  assert.equal(clearPinsTarget(SCENE).mode, "path", "a path does not depend on pins");
});

test("Clear context keeps pins, path, focus and layer; Clear layer keeps everything else", () => {
  const c = clearContextTarget(SCENE);
  assert.deepEqual([c.pins, c.mode, c.from, c.to, c.limb, c.framework, c.publisher], [SCENE.pins, SCENE.mode, SCENE.from, SCENE.to, SCENE.limb, SCENE.framework, SCENE.publisher]);
  assert.deepEqual(c.context, []);
  const l = clearLayerTarget(SCENE);
  assert.deepEqual([l.pins, l.mode, l.context, l.limb, l.dataset], [SCENE.pins, SCENE.mode, SCENE.context, SCENE.limb, SCENE.dataset]);
});

test("only relevant clear actions are offered, and there is no clear-everything action", () => {
  assert.deepEqual(territoryClearActions(atlas()), { overview: false, path: false, pins: false, context: false, layer: false });
  const full = atlas({ atlasLimb: "atlas:LIMB-IMPLEMENTATION", atlasFramework: "disa-stig", atlasPins: JSON.stringify(["a", "b"]), atlasResearch: "path", atlasFrom: "a", atlasTo: "b", atlasLayer: "publisher:DISA", atlasContext: "program.stig" });
  assert.deepEqual(territoryClearActions(full), { overview: true, path: true, pins: true, context: true, layer: true });
  assert.deepEqual(territoryClearActions(atlas({ atlasPins: JSON.stringify(["a", "b"]) })), { overview: false, path: false, pins: true, context: false, layer: false });
  assert.deepEqual(territoryClearActions(atlas({ atlasLayer: "publisher:DISA" })), { overview: false, path: false, pins: false, context: false, layer: true });
});
