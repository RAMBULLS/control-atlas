import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 },
];

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

async function expectNoHorizontalOverflow(page) {
  const width = await page.evaluate(() => ({
    client: globalThis.document.documentElement.clientWidth,
    scroll: globalThis.document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
}

for (const viewport of VIEWPORTS) {
  test(`NIST reaches a focused control from the territory sheet at ${viewport.width}px`, async ({ page }) => {
    // The record search index is tens of megabytes decoded; a shared CI runner can take well over the default 45s.
    test.setTimeout(150_000);
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas");
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page.locator(".atl")).toBeVisible();

    // Two choices reach a publication: its territory, then it.
    if (viewport.width < 760) {
      await page.getByRole("button", { name: "Compliance territory" }).click();
      await page.getByRole("button", { name: /SP 800-53 Rev\. 5/ }).first().click();
    } else {
      // Keyboard activation: at tablet widths a landmark's hit area covers the district's centre.
      await page.locator('[data-district="atlas:LIMB-COMPLIANCE"] .district__shape').focus();
      await page.keyboard.press("Enter");
      await page.locator('[data-landmark="nist-800-53"]').click();
    }
    await expect(page).toHaveURL(/atlasFramework=nist-800-53/);
    await expect(page.locator(".atl-inspector, #atl-focus").first()).toContainText("SP 800-53 Rev. 5");
    await expectNoHorizontalOverflow(page);

    // Jump to a control by identifier, then open its full record.
    // Record search loads on first focus, and Enter before it is ready does nothing by design
    // ("Record search is still loading"). WebKit also drops text typed in the moment after the
    // map settles, so type again until the match a reader would see is on screen.
    const option = page.locator("#atlas-results [role=option]").filter({ hasText: "AC-1" }).first();
    await expect(async () => {
      await page.locator("#atlas-search").fill("nist-800-53:AC-1");
      await expect(option).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });
    await page.locator("#atlas-search").press("Enter");
    await expect(page).toHaveURL(/\/#\/atlas\/nist-800-53:AC-1/);
    await expect(page.getByRole("heading", { name: "Atlas", level: 1 })).toBeVisible();
    await expect(page.locator(".atl-inspector, #atl-focus").first()).toContainText("AC-1");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("link", { name: "Open the full record" }).click();
    await expect(page).toHaveURL(/\/record\/nist-800-53\/AC-1/);
  });

  test(`RMF reaches a published result in three choices at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas");
    await waitForAppReady(page);
    await dismissOnboarding(page);

    // One: the work, named the way practitioners name it.
    await page.getByRole("button", { name: "RMF & ATO", exact: true }).click();
    const journey = page.locator(".atl-journey");
    await expect(journey.getByRole("heading", { name: "RMF steps" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // Two: a step, which is a published SP 800-37 record.
    await journey.getByRole("button", { name: "Prepare", exact: true }).click();
    await expect(page).toHaveURL(/#\/atlas\/nist-800-37:RMF-PREPARE\?atlasJourney=rmf/);
    await expect(page.locator(".atl-inspector, #atl-focus").first()).toContainText("Prepare", { timeout: 20000 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: `artifacts/w2-navigation/rmf-${viewport.width}.png`,
    });
    // Three: its full record.
    await page.getByRole("link", { name: "Open the full record" }).click();
    await expect(page).toHaveURL(/\/record\/nist-800-37\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("a legacy RMF route opens the RMF journey", async ({ page }) => {
  await page.goto("/#/atlas?sourceView=rmf");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page).toHaveURL(/#\/atlas\?atlasJourney=rmf$/);
  await expect(page.locator(".atl-journey").getByRole("heading", { name: "RMF & ATO" })).toBeVisible();
});
