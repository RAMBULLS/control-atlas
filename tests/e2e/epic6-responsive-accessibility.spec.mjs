import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";
import commonsDataset from "../../data/commons-resource-dataset.json" with { type: "json" };

// The directory grows; the contract is that every governed collection stays
// reachable, not that there are exactly N of them.
const GOVERNED_COLLECTION_COUNT = commonsDataset.collections.length;

const compareRoute =
  "/#/compare/relationships?intent=frameworks&source=nist-800-53&target=csf-2";

async function expectNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    body: globalThis.document.body.scrollWidth - globalThis.document.body.clientWidth,
    document: globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
  }));
  expect(overflow, `${label} must not create document-level horizontal overflow`).toEqual({ body: 0, document: 0 });
}

for (const viewport of [
  { label: "390px", width: 390, height: 844 },
  { label: "1024px", width: 1024, height: 900 },
  { label: "1440px", width: 1440, height: 1000 },
]) {
  test(`Compare staged flow and mappings reflow without lost meaning at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    attachPageDiagnostics(page);

    await gotoApp(page, "/#/compare");
    await waitForAppReady(page);
    await dismissOnboarding(page);

    // The count is data, not a constant: it must match the publications offered.
    await expect(page.locator(".compare-option").first()).toBeVisible();
    await expect(page.locator(".page-header-eyebrow")).toHaveText(
      `PUBLISHED CROSSWALKS / ${await page.locator(".compare-option").count()} CONNECTED PUBLICATIONS`,
    );
    await expect(page.getByRole("tablist", { name: "Comparison mode" })).toBeInViewport();
    await expect(page.getByRole("navigation", { name: "Step progress" })).toBeInViewport();
    const task = page.locator(".compare-flow-task");
    const support = page.locator(".compare-flow-support");
    await expect(task).toBeInViewport();
    if (viewport.width <= 900) {
      await support.scrollIntoViewIfNeeded();
    }
    await expect(support).toBeInViewport();
    await expectNoPageOverflow(page, `Compare setup at ${viewport.label}`);

    const taskBox = await task.boundingBox();
    const supportBox = await support.boundingBox();
    expect(taskBox).not.toBeNull();
    expect(supportBox).not.toBeNull();
    if (viewport.width <= 900) {
      expect(supportBox.y).toBeGreaterThan(taskBox.y);
    } else {
      expect(supportBox.x).toBeGreaterThan(taskBox.x);
      expect(taskBox.width).toBeGreaterThan(supportBox.width);
    }

    await gotoApp(page, compareRoute);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await page.getByRole("button", { name: "Show published mappings" }).click();

    const table = page.getByRole("table", { name: "Published crosswalk mappings" });
    await expect(table).toBeVisible({ timeout: 60000 });
    await expectNoPageOverflow(page, `Compare at ${viewport.label}`);
    await expect(table.locator("thead th")).toHaveText(["From", "Maps to"]);
    await expect(table.locator("tbody tr").first().locator("td")).toHaveCount(2);
    await expect(table.locator("tbody tr").first().locator("td[data-label]")).toHaveCount(2);
    expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  });
}

for (const viewport of [
  { label: "375px", width: 375, height: 812 },
  { label: "768px", width: 768, height: 1024 },
]) {
  test(`Resources categories and filters remain discoverable at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    attachPageDiagnostics(page);
    await gotoApp(page, "/#/resources");
    await waitForAppReady(page);
    await dismissOnboarding(page);

    const collections = page.locator(".workspace-browse-card--collection");
    await expect(collections).toHaveCount(GOVERNED_COLLECTION_COUNT);
    await expectNoPageOverflow(page, `Resources at ${viewport.label}`);

    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await filters.press("Enter");
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    // Facet groups are collapsed until asked for, so their options are out of
    // the accessibility tree until opened. Opening each here proves the sheet
    // still exposes both, and that the disclosure works inside the dialog.
    for (const label of ["Collection", "Type"]) {
      const group = panel
        .locator(".workspace-checkbox-facet")
        .filter({ has: page.locator("summary", { hasText: label }) })
        .first();
      await expect(group).toBeVisible();
      await group.locator("summary").click();
      await expect(panel.getByRole("group", { name: label })).toBeVisible();
    }

    const owner = panel.getByRole("combobox", { name: "Owner" });
    await owner.fill("National Institute of Standards and Technology");
    await owner.press("Tab");
    await expect(page).toHaveURL(/owner=National(?:%20|\+)Institute/);
    await expect(panel).toHaveCount(0);
    await expect(page.locator("#resources-results .workspace-result-row").first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include("#resources-results")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || "")),
    ).toEqual([]);
  });
}
