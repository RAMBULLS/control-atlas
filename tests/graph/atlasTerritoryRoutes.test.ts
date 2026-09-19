import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_ROUTE_LIMIT, orderRoutes, revealRoutes, type TerritoryRoute } from "../../src/ui/lib/atlasTerritoryRoutes";

const route = (b: string, total: number, types: string[]): TerritoryRoute => ({ key: `hub|${b}`, a: "hub", b, from: b, to: "hub", bidirectional: false, total, types });
const HUB: TerritoryRoute[] = [
  route("csf-2", 746, ["concept_crosswalk"]), route("disa-cci", 5344, ["maps_to"]), route("dod-zt", 1903, ["supports"]), route("fips-200", 17, ["references"]),
  route("mitre-d3fend", 36, ["supports"]), route("nist-800-171", 157, ["maps_to"]), route("nist-800-37", 3, ["uses"]), route("nist-800-53a", 1014, ["assesses"]), route("nist-800-53b", 902, ["selects"]),
];

test("a dense hub draws a bounded, deterministic set first", () => {
  const reveal = revealRoutes(HUB);
  assert.equal(reveal.visible.length, INITIAL_ROUTE_LIMIT);
  assert.equal(reveal.hiddenCount, HUB.length - INITIAL_ROUTE_LIMIT);
  assert.deepEqual(reveal.visible.map((r) => r.b), ["disa-cci", "dod-zt", "nist-800-53a", "nist-800-53b"]);
  assert.deepEqual(revealRoutes([...HUB].reverse()).visible, reveal.visible, "input order must not change the result");
});

test("ordering is by published connection count then key, never by publication importance", () => {
  const tie = orderRoutes([route("b", 10, ["x"]), route("a", 10, ["x"]), route("c", 11, ["x"])]);
  assert.deepEqual(tie.map((r) => r.b), ["c", "a", "b"]);
});

test("the complete set is always reachable", () => {
  const reveal = revealRoutes(HUB);
  assert.equal(reveal.all.length, HUB.length);
  assert.ok(reveal.visible.every((r) => reveal.all.includes(r)));
  const everything = revealRoutes(HUB, { showAll: true });
  assert.equal(everything.visible.length, HUB.length);
  assert.equal(everything.hiddenCount, 0);
  assert.equal(everything.expanded, true);
});

test("relationship-type choices narrow the set and can also be expanded to the complete matching set", () => {
  const supports = revealRoutes(HUB, { types: ["supports"] });
  assert.deepEqual(supports.matching.map((r) => r.b), ["dod-zt", "mitre-d3fend"]);
  assert.equal(supports.hiddenCount, 0);
  assert.deepEqual(supports.typeCounts.find((t) => t.type === "supports"), { type: "supports", count: 2 });
  assert.equal(revealRoutes(HUB, { types: ["maps_to", "supports"] }).matching.length, 4);
  assert.equal(revealRoutes(HUB, { types: ["maps_to", "supports", "assesses", "selects", "concept_crosswalk"] }, ).matching.length, 7);
});

test("a publication with few routes shows all of them and reports nothing hidden", () => {
  const small = revealRoutes(HUB.slice(0, 3));
  assert.equal(small.visible.length, 3);
  assert.equal(small.hiddenCount, 0);
  assert.equal(revealRoutes([]).visible.length, 0);
});
