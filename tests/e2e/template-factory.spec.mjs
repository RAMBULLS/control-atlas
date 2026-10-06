/* global document */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  // Every test here loads the app, builds a document from the catalog, and
  // renders or downloads a real DOCX. That fits the 30s default alone but not
  // beside three other workers, where this file was the one test in the whole
  // suite that timed out — on app startup, before it had done any of its work.
  test.setTimeout(90_000);
  attachPageDiagnostics(page);
});

async function assertZipDownload(download) {
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = readFileSync(path);
  expect(bytes.length).toBeGreaterThan(0);
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
}

test("fresh starter-document state has no inferred catalog, baseline, or environment", async ({
  page,
}) => {
  await page.goto("/#/build/documents/security_plan_starter");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByText("What this template is for")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Catalog or program/ })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: /^Baseline/ })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: /^Environment/ })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: /Download Security Plan Starter \(/ }),
  ).toBeDisabled();
  await expect(page.locator(".generation-status")).toContainText(
    /Catalog or program and Baseline/i,
  );
});

test("preview and DOCX download share the selected validated snapshot", async ({
  page,
}) => {
  await page.goto("/#/build/documents/security_plan_starter");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("combobox", { name: /^Catalog or program/ }).selectOption("nist-800-53");
  await page.getByRole("combobox", { name: /^Baseline/ }).selectOption("MODERATE");
  await expect(page.locator(".template-document-preview")).toBeVisible();
  const downloadButton = page.getByRole("button", {
    name: /Download Security Plan Starter \(/,
  });
  await expect(downloadButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  await assertZipDownload(download);
});

test("tabular template exports a real XLSX workbook client-side", async ({
  page,
}) => {
  await page.goto("/#/build/documents/poam_starter");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("combobox", { name: /^Catalog or program/ }).selectOption("nist-800-53");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: /Download POA&M Working Register \(/ })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  await assertZipDownload(download);
});

test("generation failure removes stale preview and keeps download disabled", async ({
  page,
}) => {
  await page.goto(
    "/#/build/documents/security_plan_starter?framework=nist-800-53&baseline=NOT-REAL",
  );
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.locator(".template-document-preview")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Download Security Plan Starter \(/ }),
  ).toBeDisabled();
  await expect(page.locator(".generation-status")).toContainText(
    /invalid inputs: baseline/i,
  );
});

// #281: Review & download follows the setup task, never the height of the
// source rail. Hardware Baseline has the tallest rail (thousands of pixels of
// published sources); before this it pushed the download ~2,900px down on
// desktop and put the whole rail between setup and download on phones.
for (const width of [1440, 1024, 768, 390, 320]) {
  test(`at ${width}px the download follows setup and the source rail cannot move it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/build/documents/hardware_baseline");
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const setup = page.locator(".template-setup");
    const review = page.locator("section").filter({ has: page.getByRole("heading", { name: "Review and download" }) }).last();
    const rail = page.getByRole("complementary", { name: "Current document" });
    await expect(review).toBeVisible();
    const [s, r, a] = await Promise.all([setup.boundingBox(), review.boundingBox(), rail.boundingBox()]);
    const gap = r.y - (s.y + s.height);
    expect(gap, "Review & download starts right after setup").toBeGreaterThanOrEqual(0);
    expect(gap, "no dead space between setup and review").toBeLessThan(80);
    if (width < 1024) {
      expect(a.y, "below 1024px the rail follows the whole flow").toBeGreaterThanOrEqual(r.y + r.height - 1);
    } else {
      expect(Math.abs(a.y - s.y), "the rail sits beside the flow").toBeLessThan(4);
    }
    // One published format is shown as a fact, not a one-option dropdown.
    await expect(page.getByRole("combobox", { name: /^Format/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("a chosen template shows its purpose and every setup field with no reveal click", async ({ page }) => {
  await page.goto("/#/build/documents/security_plan_starter");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.getByRole("heading", { name: "What this template is for" })).toBeVisible();
  await expect(page.getByText("Not a replacement for", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "More options" })).toHaveCount(0);
  await expect(page.locator("summary", { hasText: "What this template is for" })).toHaveCount(0);
  // Control family is an ordinary optional field, shown with the others.
  await expect(page.getByRole("combobox", { name: /^Control family/ })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Step progress" });
  await expect(nav.locator('[aria-current="step"]')).toContainText("Set up");
  await expect(page.locator(".template-setup .label")).toHaveText("02 / Set up");
});