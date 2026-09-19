import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

function map(page) {
  return page.getByTestId("atlas-area-map");
}

/* The publisher-native columns are still reached by URL, below the map. */
function atlas(page) {
  return page.getByTestId("atlas-map");
}

function level(page, key) {
  return atlas(page).locator(`.atlas-decomp__column[data-column="${key}"]`);
}

function panel(page) {
  return page.getByTestId("atlas-detail");
}

/**
 * Opens a cell by name. Every cell is a real button whose accessible name is
 * its label and its count, so a prefix match is enough at any depth.
 */
async function open(page, label) {
  const cell = map(page).getByRole("button", { name: new RegExp(`^${label}`) }).first();
  await expect(cell).toBeVisible();
  await cell.click();
}

test("structural records use publisher-native labels without changing their route targets", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const cases = [
    {
      route: "/#/atlas?atlasLimb=ecosystem%3Anist&atlasFramework=csf-2&atlasFamily=group%3Acsf-2%3A9",
      label: "PR.AA — Identity Management, Authentication, and Access Control",
      target: /#\/atlas\/csf-2:CATEGORY-PR\.AA\?/,
    },
    {
      route: "/#/atlas?atlasLimb=ecosystem%3Amitre&atlasFramework=mitre-attack&atlasFamily=group%3Amitre-attack%3A8",
      label: "TA0001 — Initial Access",
      target: /#\/atlas\/mitre-attack:TACTIC-TA0001\?/,
    },
    {
      route: "/#/atlas?atlasLimb=ecosystem%3Anist&atlasFramework=nist-800-53&atlasFamily=group%3Anist-800-53%3A0",
      label: "AC — Access Control",
      target: /#\/atlas\/nist-800-53:FAMILY-AC\?/,
    },
  ];

  for (const entry of cases) {
    await gotoApp(page, entry.route);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const records = level(page, "record");
    await expect(records.locator(".atlas-decomp__label").first()).toBeVisible();
    const label = records
      .locator(".atlas-decomp__label")
      .getByText(entry.label, { exact: true });
    const showMore = records.getByRole("button", { name: /Show \d+ more/ });
    if (!(await label.count()) && (await showMore.count())) {
      await showMore.click();
    }
    await expect(label).toBeVisible();
    await label.locator("xpath=ancestor::button").click();
    await expect(page).toHaveURL(entry.target);
  }
});

test("guided structural identity is identical before and after optional catalog hydration", async ({
  page,
}) => {
  let releaseRecords = () => {};
  const recordsGate = new Promise((resolve) => {
    releaseRecords = () => resolve();
  });
  await page.route(
    "**/data/generated/catalog-records/mitre-attack.json*",
    async (route) => {
      await recordsGate;
      await route.continue();
    },
  );

  await gotoApp(
    page,
    "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-THREAT&atlasFramework=mitre-attack&relationshipView=path",
  );
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  const explorer = page.locator("[data-atlas-structural-explorer]:visible");
  const row = explorer.getByRole("button", {
    name: "Open TA0001 — Initial Access",
    exact: true,
  });
  await expect(row).toBeVisible();
  const label = row.locator("strong");
  const initialLabel = await label.innerText();
  expect(initialLabel).toBe("TA0001 — Initial Access");

  releaseRecords();
  await waitForAppReady(page);
  await expect(label).toHaveText(initialLabel);
  await row.click();
  await expect(page).toHaveURL(/#\/atlas\/mitre-attack:TACTIC-TA0001\?/);
});
