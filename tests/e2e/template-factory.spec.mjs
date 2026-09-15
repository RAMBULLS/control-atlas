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
