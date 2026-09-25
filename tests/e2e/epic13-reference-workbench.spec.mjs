import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, gotoApp, waitForAppReady } from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("homepage reads as a connected federal cybersecurity reference system", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, "/");

  await expect(page.getByRole("heading", { name: "Explore federal cybersecurity" })).toBeVisible();
  await expect(page.getByText("Understand what applies, what it means, and what to do next.", { exact: true })).toBeVisible();
  await expect(page.locator(".home-ecosystem")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Choose a Control Atlas destination" }).getByRole("link")).toHaveCount(3);
  await expect(page.getByRole("navigation", { name: "Start with what you came to find." }).locator(".home-library-kpi")).toHaveCount(5);
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Resources", exact: true })).toBeVisible();
  await expect(page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth)).resolves.toBe(true);

  await page.screenshot({ path: testInfo.outputPath("epic13-home-desktop.png"), fullPage: true });
});

test("Resources is a first-class durable destination", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, "/#/resources");
  await waitForAppReady(page);

  await expect(page).toHaveURL(/#\/resources$/);
  await expect(page.getByRole("heading", { name: "Resources", level: 1 })).toBeVisible();
  await expect(page.locator('[data-page-template="workspace"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Browse by Collection" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Resources", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Atlas overview shows every territory and drills directly to a publication", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await gotoApp(page, "/#/atlas");
  await waitForAppReady(page);

  await expect(page.getByRole("heading", { name: "Atlas", level: 1 })).toBeVisible();
  const map = page.locator(".terr");
  await expect(map).toBeVisible();
  await expect(map.locator(".district")).toHaveCount(9);
  await page.screenshot({ path: testInfo.outputPath("epic13-atlas-graph-first.png"), fullPage: true });

  // Opening a publication stays on the map and shows what it connects to.
  await map.locator('[data-landmark="nist-800-53"]').click();
  await expect(page).toHaveURL(/atlasFramework=nist-800-53/);
  await expect(page.locator(".atl-inspector")).toContainText("SP 800-53 Rev. 5");
  await page.screenshot({ path: testInfo.outputPath("epic13-atlas-workbench.png"), fullPage: true });
});

test("mobile homepage preserves the product story without horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/");

  await expect(page.getByRole("heading", { name: "Explore federal cybersecurity" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Start with what you came to find." }).locator(".home-library-kpi")).toHaveCount(5);
  await expect(page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth)).resolves.toBe(true);
  await page.screenshot({ path: testInfo.outputPath("epic13-home-mobile.png"), fullPage: true });
});
