// Owner-directed Home rollback. Keep this file in the existing CI smoke set.
// Pulse generation remains tested separately; it must not appear on Home until
// a replacement layout and its public copy have received visual approval.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp } from "./support.mjs";

const WIDTHS = [320, 375, 390, 768, 1024, 1440];
const HEADLINE = "Make federal cybersecurity make sense.";
const REJECTED_COPY = [
  "Nothing appears here until it passes review.",
  "Source updates Control Atlas has accepted and features it has shipped.",
  "Home shows what changed",
  "Accepted source updates and shipped features now appear on Home",
];
const HEAVY = /data\/generated\/(?:nodes|edges|evidence|atlas-territory|atlas-research|atlas-neighborhood|library-search|catalog-records|connection-inventory|commons-search|pulse)/;

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function openHome(page, width = 1440) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await gotoApp(page, "/");
  await dismissOnboarding(page);
  await expect(page.locator("#workspace .home-entry")).toBeVisible();
  return requests;
}

async function assertRestoredHome(page) {
  const home = page.locator("#workspace .home-entry");
  await expect(home.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
  await expect(home.locator(".home-search")).toBeVisible();
  await expect(home.locator(".home-atlas, .home-journeys, .home-pulse")).toHaveCount(0);
  for (const copy of REJECTED_COPY) await expect(home).not.toContainText(copy);
  const destinations = home.getByRole("navigation", { name: "Choose a Control Atlas destination" });
  await expect(destinations.getByRole("link")).toHaveCount(4);
  await expect(destinations.getByRole("link", { name: /Browse the Atlas/ })).toHaveAttribute("href", "#/atlas");
  const [hero, grid, library] = await Promise.all(
    [".home-hero", ".home-secondary-grid", ".home-library-discovery"].map((selector) => home.locator(selector).boundingBox()),
  );
  expect(hero).not.toBeNull();
  expect(grid).not.toBeNull();
  expect(library).not.toBeNull();
  expect(hero.y + hero.height).toBeLessThanOrEqual(grid.y + 1);
  expect(grid.y + grid.height).toBeLessThanOrEqual(library.y + 1);
}

test("Home rollback restores search and destinations without the rejected release feed", async ({ page }) => {
  await openHome(page);
  await assertRestoredHome(page);
});

test("Home rollback also holds after React navigation returns from Atlas", async ({ page }) => {
  await openHome(page);
  await page.locator(".home-secondary-action[href='#/atlas']").click();
  await expect(page).toHaveURL((url) => url.hash === "#/atlas");
  await expect(page.locator(".atl")).toBeVisible({ timeout: 30_000 });
  await page.locator("a[href='#/']").first().click();
  await assertRestoredHome(page);
});

test("Home rollback preserves the Pulse pipeline but disconnects both Home renderers", () => {
  const build = readFileSync("tools/build-static-site.mjs", "utf8");
  expect(build).toContain("scripts/build-pulse-artifact.mjs");
  expect(readFileSync("scripts/lib/product-history.mjs", "utf8").length).toBeGreaterThan(0);
  for (const path of ["src/ui/pages/HomePage.tsx", "vite.config.ts"]) {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("HOME_CONTENT.headline");
    expect(source).not.toContain("home-pulse");
    expect(source).not.toContain("HOME_SURFACE");
    for (const copy of REJECTED_COPY) expect(source).not.toContain(copy);
  }
});

test("restored Home still loads no graph, Atlas index, search data or Pulse artifact", async ({ page }) => {
  const requests = await openHome(page);
  await page.waitForLoadState("networkidle");
  expect(requests.filter((url) => HEAVY.test(url))).toEqual([]);
});

for (const width of WIDTHS) {
  test(`restored Home at ${width}px keeps navigation and has no horizontal overflow`, async ({ page }, testInfo) => {
    await openHome(page, width);
    await assertRestoredHome(page);
    expect(await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px overflow`).toBeLessThanOrEqual(1);
    await testInfo.attach(`home-restored-${width}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}
