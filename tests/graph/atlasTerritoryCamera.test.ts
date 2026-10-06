import assert from "node:assert/strict";
import test from "node:test";
import { TERRITORY_GEOMETRY, territoryPolygon } from "../../src/ui/lib/atlasTerritoryGeography";
import { boundsOf, fitTerritoryCamera, territoryCameraProgress } from "../../src/ui/lib/atlasTerritoryModel";

test("a frame timestamp before the effect starts cannot extrapolate the camera", () => {
  assert.equal(territoryCameraProgress(16, 32), 0);
  assert.equal(territoryCameraProgress(32, 32), 0);
  assert.equal(territoryCameraProgress(262, 32), 0.5);
  assert.equal(territoryCameraProgress(492, 32), 1);
  assert.equal(territoryCameraProgress(1000, 32), 1);
});

test("a stale desktop inspector reservation cannot invert a narrow or zero-sized map", () => {
  const area = TERRITORY_GEOMETRY.territories.find(item => item.id === "atlas:LIMB-IMPLEMENTATION");
  assert.ok(area);
  const bounds = boundsOf(territoryPolygon(TERRITORY_GEOMETRY, area.id), 120);
  for (const size of [{ w: 320, h: 844 }, { w: 372, h: 844 }, { w: 0, h: 0 }]) {
    const view = fitTerritoryCamera(bounds, size, 372);
    assert.ok(Object.values(view).every(Number.isFinite));
    assert.ok(view.w > 0 && view.h > 0, `invalid camera for ${size.w} × ${size.h}`);
    assert.ok(view.x <= bounds.x && view.y <= bounds.y);
    assert.ok(view.x + view.w >= bounds.x + bounds.w && view.y + view.h >= bounds.y + bounds.h);
  }
});
