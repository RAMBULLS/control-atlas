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

async function clickAtlasNode(page, viewport, id) {
  if (viewport.width < 1024) {
    const node = page.locator(`.atlas-tree-compact [data-atlas-node-id="${id}"]`);
    await expect(node).toBeVisible();
    await node.click();
    return;
  }
  const node = page.locator(`.react-flow__node:has([data-atlas-node-id="${id}"])`);
  await expect(node).toBeVisible();
  await node.dispatchEvent("click");
}

for (const viewport of VIEWPORTS) {
  test(`NIST reaches a focused control with choices separate from structure at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas");
    await waitForAppReady(page);
    await dismissOnboarding(page);

    await clickAtlasNode(page, viewport, "atlas:LIMB-COMPLIANCE");
    await expect(page).toHaveURL(/atlasLimb=atlas(?::|%3A)LIMB-COMPLIANCE/);
    await clickAtlasNode(page, viewport, "nist-800-53:CATALOG");
    await expect(page).toHaveURL(/atlasFramework=nist-800-53/);
    await expect(page).not.toHaveURL(/atlasBaseline=/);

    const explorer = page.locator("[data-atlas-structural-explorer]");
    await explorer.getByRole("button", { name: /FAMILY-AC Access Control/ }).click();
    await expect(explorer.getByLabel("Search this publication")).toBeVisible();
    await expect(explorer.getByRole("heading", { name: "Access Control" })).toBeVisible();
    await expect(page.locator(".atlas-tree__mobile-bar")).toContainText("Access Control");
    await expectNoHorizontalOverflow(page);
    await explorer.getByLabel("Search this publication").fill("AC-1");
    await explorer.getByRole("button", { name: /^AC-1\b/ }).click();
    await expect(page).toHaveURL(/\/#\/atlas\/nist-800-53:AC-1\?/);
    await expect(page.getByRole("heading", { name: "Atlas", level: 1 })).toBeVisible();
    // The guided path lands with Hierarchy already open (it sets
    // relationshipView: "path" when a record is chosen) — the visitor just
    // navigated structure to get here, so showing it is the point.
    await expect(page.getByRole("button", { name: "Hierarchy" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("heading", { name: "Where this sits" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Where this sits" }).first(),
    ).toContainText("Access Control");
    await expect(
      page.getByRole("navigation", { name: "Where this sits" }).first(),
    ).not.toContainText("Low Impact Baseline");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: `artifacts/w2-navigation/epic1-focused-${viewport.width}.png`,
    });
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

test("Atlas root presents an authority-rooted interactive hierarchy", async ({
  page,
}) => {
  await page.goto("/#/atlas");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.locator(".atlas-tree")).toBeVisible();
  await expect(page.locator('[data-atlas-node-id^="atlas:LIMB-"]')).toHaveCount(9);
  await expect(page.locator(".react-flow")).toHaveCount(1);
  await expect(
    page.getByText("Explore areas, publications, and the published connections between them.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveCount(
    0,
  );
});

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
