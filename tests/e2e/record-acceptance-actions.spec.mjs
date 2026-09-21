import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, dismissOnboarding, waitForAppReady } from "./support.mjs";

// Issue #279: a record page offers an action only when it can do something
// useful, and never renders an empty child inventory. Routes below are stable
// publisher keys; assertions describe behavior, not corpus counts.

async function openRecord(page, route) {
  attachPageDiagnostics(page);
  await page.goto(route);
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page.locator('[data-template="E"]')).toBeVisible();
}

async function openActionsMenu(page) {
  await page.locator(".record-actions-menu > summary").click();
  return page.locator(".record-actions-popover");
}

test("baseline headings name the baseline, not just the word Baseline", async ({ page }) => {
  await openRecord(page, "/#/record/nist-800-53b/HIGH");
  await expect(page.getByRole("heading", { name: "High Impact Baseline", level: 1 })).toBeVisible();
  await openRecord(page, "/#/record/fedramp-rev5/LOW");
  await expect(page.getByRole("heading", { name: "Low Baseline", level: 1 })).toBeVisible();
});

test("selection objects never render an empty Contained records section", async ({ page }) => {
  for (const route of [
    "/#/record/nist-800-53b/HIGH",
    "/#/record/fedramp-rev5/HIGH",
    "/#/record/fips-199/FIPS-199-HIGH",
    "/#/record/cmmc-2/LEVEL-1",
  ]) {
    await openRecord(page, route);
    await expect(page.locator('[data-record-section="child-inventory"]'), route).toHaveCount(0);
    await expect(page.locator("main"), route).not.toContainText("No directly contained records");
  }
});

test("a structural hub still lists what the publisher published beneath it", async ({ page }) => {
  await openRecord(page, "/#/record/csf-2/CATEGORY-PR.AA");
  const inventory = page.locator('[data-record-section="child-inventory"]');
  await expect(inventory).toBeVisible();
  await expect(inventory.getByRole("heading", { name: "Contained records", level: 2 })).toBeVisible();
  expect(await inventory.locator("li a").count()).toBeGreaterThan(0);
});

test("helper records do not offer Compare or Templates", async ({ page }) => {
  for (const route of [
    "/#/record/atlas/TRUNK",
    "/#/record/nist-zt/COLLABORATOR-APPGATE-835EC7F121",
  ]) {
    await openRecord(page, route);
    const menu = await openActionsMenu(page);
    await expect(menu.getByRole("button", { name: "Copy link" }), route).toBeVisible();
    await expect(menu.getByRole("link", { name: "Compare frameworks" }), route).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "Choose a template" }), route).toHaveCount(0);
    await expect(page.locator(".record-template-sidebar").getByRole("link", { name: "Compare this record" }), route).toHaveCount(0);
    await expect(page.locator(".record-template-sidebar").getByRole("link", { name: "View in Atlas" }), route).toBeVisible();
  }
});

test("a record with no published mapping does not offer Compare, and templates stay on supported catalogs", async ({ page }) => {
  await openRecord(page, "/#/record/cui-policy/CATEGORY-ACCIDENT-INVESTIGATION");
  const menu = await openActionsMenu(page);
  await expect(menu.getByRole("link", { name: "Compare frameworks" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Choose a template" })).toHaveCount(0);
  await expect(page.locator(".record-template-sidebar").getByRole("link", { name: "Compare this record" })).toHaveCount(0);
});

test("a control with real mappings still offers Compare and a template handoff", async ({ page }) => {
  await openRecord(page, "/#/record/nist-800-53/AC-2");
  const menu = await openActionsMenu(page);
  await expect(menu.getByRole("link", { name: "Compare frameworks" })).toBeVisible();
  const template = menu.getByRole("link", { name: "Choose a template" });
  await expect(template).toBeVisible();
  await template.click();
  await expect(page).toHaveURL(/framework=nist-800-53/);
});

test("baselines, impact levels and program levels lead with what the publisher selected or requires", async ({ page }) => {
  const cases = [
    ["/#/record/nist-800-53b/HIGH", "Selected controls"],
    ["/#/record/fedramp-rev5/HIGH", "Selected controls"],
    ["/#/record/fips-199/FIPS-199-HIGH", "Selected baseline"],
    ["/#/record/cmmc-2/LEVEL-2", "Requirements"],
  ];
  for (const [route, heading] of cases) {
    await openRecord(page, route);
    const section = page.locator('[data-record-section="selection"]');
    await expect(section, route).toHaveCount(1);
    await expect(section.getByRole("heading", { name: heading, level: 2 }), route).toBeVisible();
    expect(await section.locator("li a").count(), route).toBeGreaterThan(0);
    // The same edges are not repeated as generic related links.
    await expect(page.locator('[data-record-section="related-records"] [data-record-connection-id]').filter({ hasText: /Selects/i }), route).toHaveCount(0);
  }
});

test("a selection section is never empty, and a level with nothing published shows none", async ({ page }) => {
  await openRecord(page, "/#/record/cmmc-2/LEVEL-1");
  const sections = page.locator('[data-record-section="selection"]');
  for (let index = 0; index < await sections.count(); index += 1) {
    expect(await sections.nth(index).locator("li a").count()).toBeGreaterThan(0);
  }
});

test("a long selection is capped with a way to see the rest in Atlas", async ({ page }) => {
  await openRecord(page, "/#/record/nist-800-53b/HIGH");
  const section = page.locator('[data-record-section="selection"]');
  expect(await section.locator("li a").count()).toBeLessThanOrEqual(25);
  await expect(section.getByRole("link", { name: /more — Explore in Atlas/ })).toBeVisible();
});
