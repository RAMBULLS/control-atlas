/* global document, getComputedStyle */
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

async function open(page, path = "/#/atlas", width = 1440, height = 900) {
  attachPageDiagnostics(page);
  await page.setViewportSize({ width, height });
  await gotoApp(page, path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator(".atl")).toBeVisible({ timeout: 30000 });
}

// Every drawn item of a kind must sit inside the map frame (small tolerance for stroke width).
const insideMap = (page, selector) => page.evaluate((sel) => {
  const frame = document.querySelector(".terr").getBoundingClientRect();
  return [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .filter((r) => r.left < frame.left - 2 || r.right > frame.right + 2 || r.top < frame.top - 2 || r.bottom > frame.bottom + 2).length;
}, selector);

for (const [width, height] of [[768, 1024], [1024, 768], [1440, 900]]) {
  test(`territory names are never clipped at ${width}px`, async ({ page }) => {
    await open(page, "/#/atlas", width, height);
    expect(await insideMap(page, ".dname__text"), "clipped territory names").toBe(0);
    expect(await insideMap(page, ".lm .lm__name"), "clipped landmark names").toBe(0);
  });
}

test("on a portrait tablet the sheet is no taller than its map needs", async ({ page }) => {
  await open(page, "/#/atlas", 768, 1024);
  const sheet = await page.locator(".atl").boundingBox();
  expect(sheet.height).toBeLessThanOrEqual(768 * 0.66 + 150 + 2);
});

for (const [width, height] of [[1024, 768], [1440, 900]]) {
  test(`a dense hub's first routes stay inside the visible map at ${width}px`, async ({ page }) => {
    await open(page, "/#/atlas?atlasLimb=atlas:LIMB-COMPLIANCE&atlasFramework=nist-800-53", width, height);
    await expect(page.locator(".route--sel")).toHaveCount(4);
    await page.waitForTimeout(700);
    expect(await insideMap(page, ".route--sel .route__line"), "routes leaving the view").toBe(0);
  });
}

test("a focused record does not stack a second breadcrumb bar above the sheet", async ({ page }) => {
  await open(page, "/#/atlas/disa-stig:V-205646");
  await expect(page.locator(".atl-inspector")).toContainText("V-205646");
  await expect(page.getByRole("region", { name: "Page context" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Where you are" })).toContainText("V-205646");
});

test("the phone search box shows a placeholder that fits", async ({ page }) => {
  await open(page, "/#/atlas", 320, 700);
  await expect(page.locator("#atlas-search")).toHaveAttribute("placeholder", "Search, e.g. V-205646");
});

test("empty territories are named on the map, so they never read as missing data", async ({ page }) => {
  await open(page, "/#/atlas");
  const empty = page.locator(".dname.is-empty");
  await expect(empty).toHaveCount(2);
  for (const name of ["Operations", "Knowledge"]) await expect(empty.filter({ hasText: name })).toHaveCount(1);
  await expect(empty.first()).toContainText("No publications placed yet");
});

test("a route's far end keeps its name when a context dims other publications", async ({ page }) => {
  await open(page, "/#/atlas?atlasContext=asset.server,product.microsoft-windows,program.stig&atlasLimb=atlas:LIMB-IMPLEMENTATION&atlasFramework=disa-stig");
  const end = page.locator('[data-landmark="disa-cci"]');
  await expect(end).not.toHaveClass(/is-dim/);
  await expect(end.locator(".lm__name")).toContainText("DISA CCI");
});

test("a tall inspector never covers the Other publications control", async ({ page }) => {
  await open(page, "/#/atlas?atlasLimb=atlas:LIMB-COMPLIANCE&atlasFramework=nist-800-53");
  await page.getByText("Filter by relationship type").click();
  const inspector = await page.locator(".atl-inspector").boundingBox();
  const pill = await page.locator(".atl-pill--other").boundingBox();
  expect(inspector.y + inspector.height).toBeLessThanOrEqual(pill.y);
});

test("a negative shared-ground answer says what was checked, not that nothing exists", async ({ page }) => {
  await open(page, `/#/atlas?atlasPins=${encodeURIComponent('["cmmc-2","fedramp-rev5"]')}`);
  await page.getByRole("button", { name: "Find shared connections" }).click();
  await expect(page.locator(".atl-inspector")).toContainText("Nothing is shared in the published connections we have");
});

for (const [query, first] of [["SP 800-53", "SP 800-53 Rev. 5"], ["FedRAMP", "FedRAMP 2026"], ["ATT&CK", "ATT&CK Enterprise"], ["CMMC", "CMMC 2.0"], ["V-205646", "V-205646"]]) {
  test(`searching "${query}" puts ${first} first`, async ({ page }) => {
    await open(page);
    await page.locator("#atlas-search").fill(query);
    const top = page.locator("#atlas-results button").first();
    await expect(top).toBeVisible({ timeout: 60000 });
    await expect(top).toContainText(first);
  });
}

test("trace step buttons have readable text", async ({ page }) => {
  await open(page, "/#/atlas/disa-stig:V-205646");
  await page.getByRole("button", { name: "Trace upstream" }).click();
  const seg = page.locator(".atl-steps__seg").first();
  await expect(seg).toBeVisible({ timeout: 120000 });
  const color = await seg.evaluate((e) => getComputedStyle(e).color);
  const bg = await seg.evaluate((e) => getComputedStyle(e).backgroundColor);
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [a, b] = [lum(color), lum(bg)].sort((x, y) => y - x);
  expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
});

test("a link to a record that is not in the data says so instead of loading forever", async ({ page }) => {
  await open(page, "/#/atlas/disa-stig:V-000000");
  const card = page.locator(".atl-inspector");
  await expect(card).toContainText("We could not find this record in the current data", { timeout: 90000 });
  await expect(card).not.toContainText("Loading the record");
  await expect(card.getByRole("button", { name: /^Pin/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Trace upstream" })).toHaveCount(0);
});

for (const [width, height] of [[768, 1024], [1024, 768], [1440, 900]]) {
  test(`the Atlas overview bar never covers anything drawn on the map at ${width}px`, async ({ page }) => {
    await open(page, "/#/atlas?atlasLimb=atlas:LIMB-COMPLIANCE&atlasFramework=nist-800-53", width, height);
    await page.waitForTimeout(700);
    const covered = await page.evaluate(() => {
      const bar = document.querySelector(".atl-map__actions").getBoundingClientRect();
      const frame = document.querySelector(".terr").getBoundingClientRect();
      return [".lm .lm__name", ".dname__text", ".lm .lm__dot", ".route__line"].flatMap((sel) => [...document.querySelectorAll(sel)].filter((el) => {
        const r = el.getBoundingClientRect();
        const l = Math.max(r.left, frame.left); const rt = Math.min(r.right, frame.right); const t = Math.max(r.top, frame.top); const bt = Math.min(r.bottom, frame.bottom);
        return rt > l && bt > t && l < bar.right && rt > bar.left && t < bar.bottom && bt > bar.top;
      }).map((el) => sel));
    });
    expect(covered).toEqual([]);
  });
}

test("on a phone the breadcrumb wraps between words, not inside them", async ({ page }) => {
  await open(page, "/#/atlas/disa-stig:V-205646", 320, 700);
  const lines = await page.locator(".atl-crumb").first().evaluate((nav) => {
    const span = [...nav.querySelectorAll("span")].find((e) => e.textContent === "Implementation");
    const range = document.createRange();
    range.selectNodeContents(span);
    return range.getClientRects().length;
  });
  expect(lines).toBe(1);
});
