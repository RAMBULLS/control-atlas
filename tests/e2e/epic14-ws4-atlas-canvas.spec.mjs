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

test("an Atlas record with a generated key leads with its title in primary and accessible copy", async ({ page }) => {
  test.setTimeout(120_000);
  const stableId = "MAPPING-CONTRIBUTOR-APPGATE-835EC7F121";
  // A saved classic hierarchy link opens the record on the territory sheet.
  const route = `/#/atlas?node=${encodeURIComponent(`nist-zt:${stableId}`)}&relationshipView=path`;

  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoApp(page, route);
    await waitForAppReady(page);
    await dismissOnboarding(page);

    const details = page.locator(width < 760 ? "#atl-focus" : ".atl-inspector");
    await expect(details).toContainText("Appgate", { timeout: 20000 });
    await expect(details).not.toContainText(stableId);
    await expect(page.getByRole("navigation", { name: "Where you are" }).first()).not.toContainText(stableId);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth),
      `${width}px generated Atlas overflow`,
    ).toBeLessThanOrEqual(1);
  }
});
