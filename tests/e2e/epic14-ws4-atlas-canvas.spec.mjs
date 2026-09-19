import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

/**
 * The Atlas root renders the canonical containment tree as a decomposition map:
 * one labelled column per level, every row a real button with a real name and a
 * real count. These assertions exist because the previous force-directed canvas
 * shipped unlabelled marks whose only affordance was hover — the defect this
 * surface was rebuilt to remove.
 */

const SOURCE_ECOSYSTEMS = [
  ["ecosystem:nist", "NIST"],
  ["ecosystem:disa", "DISA"],
  ["ecosystem:mitre", "MITRE"],
  ["ecosystem:fedramp", "FedRAMP"],
  ["ecosystem:dod", "DoD"],
  ["ecosystem:dod-cio", "DoD CIO"],
  ["ecosystem:cdao", "CDAO"],
  ["ecosystem:isoo", "ISOO"],
];

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

/**
 * Opens the columns. The publisher lens lands on a board of publisher cards,
 * and the columns this suite is about begin one level in, inside a publisher.
 */
async function openAtlas(page, viewport = { width: 1440, height: 900 }, ecosystem = "ecosystem%3Anist") {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoApp(page, `/#/atlas?atlasLanding=publishers&atlasLimb=${ecosystem}`);
  await waitForAppReady(page);
  await dismissOnboarding(page);
}

/** Opens a publisher from the landing board, which is where the columns start. */
async function openPublisherFromBoard(page, label) {
  const card = page
    .getByTestId("atlas-area-map")
    // In a plain string "\+" is just "+", so this escaped nothing and a label
    // containing one would have reached the regex as a quantifier.
    .getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} —`) });
  await expect(card).toBeVisible();
  await card.click();
}

function map(page) {
  return page.getByTestId("atlas-map");
}

function column(page, key) {
  return map(page).locator(`.atlas-decomp__column[data-column="${key}"]`);
}

test("Atlas keeps generated identifiers out of visible and accessible copy", async ({ page }) => {
  await gotoApp(page, "/#/atlas");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const atlas = page.locator(".atl");
  await expect(page.locator(".terr")).toBeVisible();
  await expect(atlas).not.toContainText(/atlas:LIMB-/);
  await expect(atlas).not.toContainText(/ecosystem:/);
  await expect(atlas).not.toContainText(/:CATALOG\b/);
  await expect(atlas).not.toContainText(/\b(?:trunks?|limbs?|twigs?|acorns?)\b/i);
  await expect(atlas).not.toContainText(/nist-zt|nist-iot-cybersecurity|microsoft-zt-maturity/);
  const labels = await page.locator(".terr [aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(labels.filter((l) => /atlas:LIMB-|ecosystem:|:CATALOG\b/.test(l))).toEqual([]);
});

test("Atlas hierarchy and local record controls keep generated IDs out of primary and accessible copy", async ({ page }) => {
  test.setTimeout(120_000);
  const stableId = "MAPPING-CONTRIBUTOR-APPGATE-835EC7F121";
  const route = `/#/atlas?node=${encodeURIComponent(`nist-zt:${stableId}`)}&relationshipView=path`;

  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoApp(page, route);
    await waitForAppReady(page);
    await dismissOnboarding(page);

    await expect(page.getByRole("region", { name: "Focused Atlas record" })).toBeVisible();
    const hierarchy = page.locator("#atlas-hierarchy-panel");
    await expect(hierarchy.getByRole("heading", { name: "Decomposes into", level: 3 })).toBeVisible();
    const child = hierarchy.getByRole("link", {
      name: /Open Appgate.*Product component, NIST Zero Trust/,
    }).first();
    await expect(child).toBeVisible();
    await expect(child).toContainText("Appgate");
    await expect(hierarchy).not.toContainText(/PRODUCT-COMPONENT-.*-[0-9A-F]{10}/);
    await expect(page.locator("main")).not.toContainText(stableId);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth),
      `${width}px generated Atlas overflow`,
    ).toBeLessThanOrEqual(1);
  }
});
