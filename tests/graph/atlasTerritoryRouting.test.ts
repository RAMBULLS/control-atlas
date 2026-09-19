import assert from "node:assert/strict";
import test from "node:test";
import type { Pt } from "../../src/ui/lib/atlasTerritoryGeography";
import { hitsRects, octilinearVariants, roundedPath, routeBetween } from "../../src/ui/lib/atlasTerritoryRouting";

const angleOk = (a: Pt, b: Pt) => {
  const dx = Math.abs(b[0] - a[0]); const dy = Math.abs(b[1] - a[1]);
  return dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6;
};

test("every segment of a route is horizontal, vertical or 45 degrees", () => {
  for (const [a, b] of [[[0, 0], [300, 120]], [[500, 40], [80, 400]], [[10, 10], [10, 300]], [[0, 0], [200, 200]]] as [Pt, Pt][]) {
    const r = routeBetween(a, b, [], 12, 30);
    r.pts.slice(1).forEach((p, i) => assert.ok(angleOk(r.pts[i], p), `${a} -> ${b}: ${r.pts[i]} -> ${p}`));
  }
});

test("a route has at most one bend when nothing is in the way", () => {
  assert.ok(octilinearVariants([0, 0], [300, 120]).every((v) => v.length === 3));
  assert.equal(routeBetween([0, 0], [300, 120], [], 12, 30).pts.length, 3);
});

test("a route bends around a label instead of crossing it", () => {
  const label = { x0: 130, y0: -20, x1: 190, y1: 20 };
  const direct = routeBetween([0, 0], [300, 0], [], 12, 30);
  assert.ok(hitsRects(direct.pts, [label]) > 0, "the straight route would cross the label");
  const around = routeBetween([0, 0], [300, 0], [label], 12, 30);
  assert.equal(around.hits, 0);
  assert.equal(hitsRects(around.pts, [label]), 0);
});

test("routes start and end clear of both markers", () => {
  const r = routeBetween([100, 100], [400, 100], [], 12, 30);
  assert.ok(Math.abs(r.pts[0][0] - 112) < 1e-6 && Math.abs(r.pts[r.pts.length - 1][0] - 388) < 1e-6);
});

test("the path string is deterministic and rounded", () => {
  const a = routeBetween([0, 0], [300, 120], [], 12, 30);
  assert.equal(routeBetween([0, 0], [300, 120], [], 12, 30).d, a.d);
  assert.match(a.d, /^M[\d. -]+L[\d. -]+Q/);
  assert.equal(roundedPath([[0, 0], [10, 0]], 5), "M0 0L10 0");
});
