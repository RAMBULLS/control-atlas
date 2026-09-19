/* global document */
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
