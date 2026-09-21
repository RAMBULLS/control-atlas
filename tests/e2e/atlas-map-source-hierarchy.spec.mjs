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

/** Every node of the decomposition map is a labelled button, at every width. */
async function clickAtlasLandmark(page, name) {
  const node = page
    .getByTestId("atlas-map")
    .locator(".atlas-decomp__column")
    .getByRole("button", { name })
    .first();
  await expect(node).toBeVisible();
  await node.click();
}

/**
 * The landing draws the groups; a framework is one step inside one of them.
 * Every cell is a real button named for what it is and how much it holds, so
 * the same two clicks reach a publication at any width.
 */
async function enterFrameworkFromLandscape(page, group, name) {
  const map = page.getByTestId("atlas-area-map");
  const groupCell = map.getByRole("button", { name: group }).first();
  await expect(groupCell).toBeVisible();
  await groupCell.click();
  const node = map.getByRole("button", { name }).first();
  await expect(node).toBeVisible();
  await node.click();
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
      await page.locator('[data-district="atlas:LIMB-COMPLIANCE"] .district__shape').click();
      await page.locator('[data-landmark="nist-800-53"]').click();
    }
    await expect(page).toHaveURL(/atlasFramework=nist-800-53/);
    await expect(page.locator(".atl-inspector, #atl-focus").first()).toContainText("SP 800-53 Rev. 5");
    await expectNoHorizontalOverflow(page);

    // Jump to a control by identifier, then open its full record.
    await page.locator("#atlas-search").fill("nist-800-53:AC-1");
    // Record search loads on first focus. Enter before it is ready does nothing by design
    // ("Record search is still loading"), so wait for the match a reader would see.
    await expect(page.getByRole("listbox").getByRole("option").filter({ hasText: "AC-1" }).first()).toBeVisible({ timeout: 90_000 });
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
    await page.goto("/#/atlas?sourceView=rmf");
    await waitForAppReady(page);
    await dismissOnboarding(page);

    await expect(
      page.getByText("Which Risk Management Framework step are you working in?"),
    ).toBeVisible();

    await page.locator(".atlas-rmf-step-list button").first().click();
    await expect(page.getByText("Related records", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prepare", exact: true })).toBeVisible();
    await expect(page.locator(".atlas-choice-trail")).toContainText("PREPARE");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: `artifacts/w2-navigation/rmf-${viewport.width}.png`,
    });

    await page.locator(".atlas-path-record").first().click();
    await expect(page).toHaveURL(/\/record\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("a legacy RMF route recovers into the process branch", async ({ page }) => {
  await page.goto("/#/atlas?sourceView=rmf");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(
    page.getByText("Which Risk Management Framework step are you working in?"),
  ).toBeVisible();
  await expect(page.locator(".atlas-choice-trail")).toContainText(
    "Risk Management Framework",
  );
});
