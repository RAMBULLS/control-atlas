import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function openLibraryCompare(page, query) {
  await gotoApp(page, `/#/library?q=${encodeURIComponent(query)}`);
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator(".compare-tray")).toBeVisible();
}

function selectionBoxes(page) {
  return page.locator('input[type="checkbox"][aria-label*="for comparison"]');
}

// The bug this guards: selection was keyed by the bare item id, but the same
// identifier exists in several catalogs (AC-2 is both an SP 800-53 control and
// an SP 800-53A assessment procedure). One click checked both rows, the
// selection never reached two, and Compare was unreachable.
test("selecting a record does not also select its same-id twin in another publication", async ({ page }) => {
  await openLibraryCompare(page, "AC-2");

  const boxes = selectionBoxes(page);
  await expect(boxes).toHaveCount(2);

  await boxes.nth(0).click();
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
  await expect(page.locator(".compare-tray__status strong")).toHaveText("1 selected");

  await boxes.nth(1).click();
  await expect(page.locator(".compare-tray__status strong")).toHaveText("2 selected");
  await expect(page.locator(".compare-tray__items li")).toHaveCount(2);
});

test("the tray names both publications so same-id records stay distinguishable", async ({ page }) => {
  await openLibraryCompare(page, "AC-2");
  const boxes = selectionBoxes(page);
  await boxes.nth(0).click();
  await boxes.nth(1).click();

  const publications = await page.locator(".compare-tray__chip-publication").allTextContents();
  expect(new Set(publications).size).toBe(2);
});

test("a chip can be removed and the whole selection cleared", async ({ page }) => {
  await openLibraryCompare(page, "AC-2");
  const boxes = selectionBoxes(page);
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await expect(page.locator(".compare-tray__items li")).toHaveCount(2);

  await page.locator(".compare-tray__remove").first().click();
  await expect(page.locator(".compare-tray__items li")).toHaveCount(1);
  await expect(page.locator(".compare-tray__status strong")).toHaveText("1 selected");

  await page.locator(".compare-tray").getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator(".compare-tray__status strong")).toHaveText("0 selected");
  await expect(page.locator(".compare-tray__items")).toHaveCount(0);
});

// Compare's item-mapping mode requires intent + source + items + target. A link
// carrying only `items` landed in Frameworks mode with empty selectors, which
// is what made Library Compare a dead end.
test("a two-publication selection hands off a complete, runnable comparison", async ({ page }) => {
  await openLibraryCompare(page, "AC-2");
  const boxes = selectionBoxes(page);
  await boxes.nth(0).click();
  await boxes.nth(1).click();

  await page.getByRole("link", { name: /^Compare 2$/ }).click();

  await expect.poll(() => new URL(page.url()).hash).toContain("intent=item-mapping");
  const hash = new URL(page.url()).hash;
  expect(hash).toContain("source=nist-800-53");
  expect(hash).toContain("target=nist-800-53a");
  expect(hash).toContain("compareRun=true");

  // Lands on real results, not an unconfigured builder.
  await expect(page.getByText(/published mapping across/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
});

// One catalog cannot determine a target, so the handoff must stop at the target
// step rather than auto-running an unrunnable comparison.
test("a single-publication selection stops at the target step instead of a broken result", async ({ page }) => {
  await openLibraryCompare(page, "account management");

  const rows = page.locator("[data-record-id]");
  await expect(rows.first()).toBeVisible();
  for (const id of ["nist-800-53:AC-2", "nist-800-53:AC-2.1"]) {
    await page.locator(`[data-record-id="${id}"] input[type="checkbox"]`).click();
  }
  await expect(page.locator(".compare-tray__status strong")).toHaveText("2 selected");
  await expect(page.locator(".compare-tray__hint")).toContainText("Add a record from another publication");

  await page.getByRole("link", { name: /^Compare 2$/ }).click();

  const hash = new URL(page.url()).hash;
  expect(hash).toContain("source=nist-800-53");
  expect(hash).toContain("items=nist-800-53:AC-2%2Cnist-800-53:AC-2.1");
  expect(hash).not.toContain("compareRun=true");
  // sources.json is not cached from the Library page, so the Compare partial
  // load takes several seconds. Wait up to 30s for the target form to render.
  await expect(page.getByRole("combobox", { name: /^Compare with/ })).toHaveValue("", { timeout: 30_000 });
});

test("the tray fits the small-screen contract without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openLibraryCompare(page, "AC-2");
  const boxes = selectionBoxes(page);
  await boxes.nth(0).click();
  await boxes.nth(1).click();

  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator(".compare-tray")).toBeVisible();
});
