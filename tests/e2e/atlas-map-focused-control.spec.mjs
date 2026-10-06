// A focused record on the Atlas territory sheet, and its full connection list (#282 retired the
// classic record workspace; these protect the user jobs it served, not its panels).
import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

const overflow = (page) => page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth);

test("focused Atlas opens straight to the record, not a structural page", async ({ page }) => {
  // A saved classic "map" link lands on the record focus of the territory sheet.
  await page.goto("/#/explore?node=nist-800-53%3AAC-2&relationshipView=map");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page).toHaveURL(/#\/atlas\/nist-800-53:AC-2$/);
  await expect(page.getByRole("heading", { name: "Atlas", level: 1 })).toBeVisible();
  const details = page.locator(".atl-inspector");
  await expect(details).toContainText("AC-2", { timeout: 20000 });
  await expect(details).toContainText("SP 800-53 Rev. 5");
  await expect(details.getByRole("link", { name: "Full connection list" })).toBeVisible();
  await expect(details.getByRole("link", { name: "Open the full record" })).toHaveAttribute("href", /#\/record\/nist-800-53\/AC-2/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#atl-focus")).toContainText("AC-2");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("List uses the same published set and exposes traceable source references", async ({ page }) => {
  await page.goto("/#/explore?node=nist-800-53%3AAC-2&relationshipView=list");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const table = page.getByRole("table", { name: "Relationship table" });
  await expect(table).toBeVisible({ timeout: 20000 });
  await expect(table.locator("tbody tr").first()).toBeVisible();
  await expect(table.getByText("Evidence", { exact: true }).first()).toBeVisible();
  await expect(table).not.toContainText("Expanded item");
  await expect(table).not.toContainText("nist-olir-");
  // Each row says which relationship class it is and which way it runs.
  await expect(table.getByRole("columnheader", { name: "Class and direction" })).toBeVisible();
  await expect(table.locator("tbody tr").first()).toContainText(
    /Structure|Applicability|Correlation|Implementation|Assessment|Process|Cross-framework|Threat/,
  );
  await expect(table.locator("tbody tr").first()).toContainText(/From selected record|To selected record/);
});

test("zero-published-edge records render an honest empty list", async ({ page }) => {
  await page.goto("/#/atlas/disa-cci:CCI-000220?relationshipView=list");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const list = page.getByRole("region", { name: /All connections/ });
  await expect(list).toContainText("No published connections for", { timeout: 20000 });
  await expect(page.getByRole("table", { name: "Relationship table" })).toHaveCount(0);
});

test("the connection list reads on a phone without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/#/atlas/nist-800-53:AC-2?relationshipView=list");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("table", { name: "Relationship table" })).toBeVisible({ timeout: 20000 });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Back to the map" }).click();
  await expect(page.getByRole("link", { name: "Full connection list" })).toBeVisible();
});
