import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import { TerritoryMap } from "../../src/ui/components/atlas-territory/TerritoryMap";
import { TERRITORY_GEOMETRY, territoryPolygon } from "../../src/ui/lib/atlasTerritoryGeography";
import { boundsOf, buildTerritoryModel, fitTerritoryCamera, territoryCameraProgress } from "../../src/ui/lib/atlasTerritoryModel";

test("rendered publication names include the visible kind or matching-record count in reading order", () => {
  const area = "atlas:LIMB-IMPLEMENTATION";
  const model = buildTerritoryModel({
    publications: [{ id: "disa-stig", name: "Fixture publication", publisher: "Fixture publisher", kind: "Implementation standard", area, records: 1290 }],
    routes: [],
  } as Parameters<typeof buildTerritoryModel>[0]);
  const noop = () => {};
  for (const count of [null, 1, 1290]) {
    const html = renderToStaticMarkup(createElement(TerritoryMap, {
      model, size: { w: 1440, h: 900 }, focusAreaId: area, focusPublication: "disa-stig",
      selectedRouteKey: null, revealed: [], pins: [], active: new Set<string>(), sharedLines: [],
      publisher: "", records: [], hops: [], inspectorInset: 0,
      context: count === null ? null : new Map([["disa-stig", { records: count, byTag: {} }]]),
      actions: { selectDistrict: noop, selectPublication: noop, selectRoute: noop, selectRecord: noop, selectHop: noop, closeInspector: noop },
    }));
    const landmark = parse(html).querySelector('[data-landmark="disa-stig"]')!;
    const visible = landmark.textContent.trim().replace(/\s+/g, " ");
    assert.equal(visible, `DISA STIG ${count === null ? "Implementation standard" : `${count.toLocaleString()} matching ${count === 1 ? "record" : "records"}`}`);
    assert.ok(landmark.getAttribute("aria-label")!.startsWith(visible + ","));
  }
});

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
