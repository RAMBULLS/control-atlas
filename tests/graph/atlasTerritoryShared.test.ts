import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PINS, addPin, compareHandoff, removePin, sharedGround } from "../../src/ui/lib/atlasTerritoryShared";
import type { TerritoryRoute } from "../../src/ui/lib/atlasTerritoryRoutes";

const r = (a: string, b: string): TerritoryRoute => ({ key: `${a}|${b}`, a, b, from: a, to: b, bidirectional: false, total: 1, types: ["x"] });
const ROUTES = [r("a", "hub"), r("b", "hub"), r("c", "hub"), r("a", "only-a"), r("b", "pair"), r("c", "pair"), r("a", "b")];

test("shared ground separates all, some and unique, and keeps direct routes", () => {
  const g = sharedGround(ROUTES, ["a", "b", "c"]);
  assert.deepEqual(g.all, ["hub"]);
  assert.deepEqual(g.some, [{ id: "pair", pins: ["b", "c"] }]);
  assert.deepEqual(g.unique.a, ["only-a"]);
  assert.deepEqual(g.unique.b, []);
  assert.deepEqual(g.direct.map((x) => x.key), ["a|b"]);
  assert.equal(g.none, false);
});

test("two pins with no common neighbour and no direct route is an honest zero", () => {
  const g = sharedGround([r("a", "x"), r("b", "y")], ["a", "b"]);
  assert.deepEqual(g.all, []);
  assert.deepEqual(g.some, []);
  assert.deepEqual(g.unique, { a: ["x"], b: ["y"] });
  assert.equal(g.none, true);
});

test("pins never count as their own shared ground and duplicates collapse", () => {
  const g = sharedGround(ROUTES, ["a", "a", "b"]);
  assert.deepEqual(g.all, ["hub"]);
  assert.equal(g.all.includes("a") || g.all.includes("b"), false);
});

test("a single pin has no shared ground to claim", () => {
  const g = sharedGround(ROUTES, ["a"]);
  assert.deepEqual(g.all, []);
  assert.deepEqual(g.some, []);
});

test("Compare is offered only for exactly two distinct publications", () => {
  const pubs = new Set(["a", "b", "c"]);
  assert.deepEqual(compareHandoff(["a", "b"], pubs), { source: "a", target: "b" });
  assert.equal(compareHandoff(["a"], pubs), null);
  assert.equal(compareHandoff(["a", "b", "c"], pubs), null);
  assert.equal(compareHandoff(["a", "disa-stig:V-1"], pubs), null, "record pins have no supported Compare handoff");
  assert.equal(compareHandoff(["a", "a"], pubs), null);
});

test("pins are bounded and removable", () => {
  let pins: string[] = [];
  for (let i = 0; i < MAX_PINS; i += 1) pins = addPin(pins, `p${i}`)!;
  assert.equal(addPin(pins, "one-more"), null);
  assert.deepEqual(addPin(pins, "p0"), pins, "re-pinning is a no-op");
  assert.equal(removePin(pins, "p0").length, MAX_PINS - 1);
});
