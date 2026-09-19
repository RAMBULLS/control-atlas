import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto("/#/atlas");
  await waitForAppReady(page);
  await dismissOnboarding(page);
});

test("exact Atlas identifier opens the record on the territory sheet", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Search records and publications" })
    .fill("nist-800-53:AC-2");
  await page.getByRole("combobox", { name: "Search records and publications" }).press("Enter");

  await expect(page).toHaveURL(/#\/atlas\/nist-800-53:AC-2/);
  await expect(page.getByRole("heading", { level: 1, name: "Atlas" })).toBeVisible();
  await expect(page.locator(".atl-inspector")).toContainText("AC-2");
  await expect(page.locator(".rec[data-record]")).toHaveCount(1);
});

test("ambiguous Atlas text hands off to canonical Search", async ({ page }) => {
  await page.getByRole("combobox", { name: "Search records and publications" }).fill("account");
  await page.getByRole("combobox", { name: "Search records and publications" }).press("Enter");

  await expect(page).toHaveURL(/\/library\?q=account/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Library",
    }),
  ).toBeVisible();
});

test("no-match Atlas search stays local with announced recovery actions", async ({
  page,
}) => {
  const query = "zzzz-epic-one-no-match";
  await page.getByRole("combobox", { name: "Search records and publications" }).fill(query);
  await page.getByRole("combobox", { name: "Search records and publications" }).press("Enter");

  await expect(page).toHaveURL(/\/atlas/);
  await expect(page.locator(".atl-search__recovery")).toContainText(`No record matches ${query}`);
  await expect(page.getByRole("link", { name: "Search all records" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse the Library" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    `No Atlas record matches ${query}. Try Search or browse the Library.`,
  );
});

test("the full connection workspace exposes explicit lenses and class-direction List semantics", async ({
  page,
}) => {
  await page.goto("/#/atlas?node=nist-800-53%3AAC-2&relationshipView=map");
  await waitForAppReady(page);

  await page.getByRole("button", { name: "Hierarchy" }).click();
  await expect(
    page.getByRole("navigation", { name: "Where this sits" }).first(),
  ).toContainText("SP 800-53 Rev. 5");
  await expect(
    page.getByRole("navigation", { name: "Where this sits" }).first(),
  ).toContainText("Access Control");
  await expect(page.getByRole("heading", { name: "Connections", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "View all", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "View all", exact: true }).click();
  const table = page.getByRole("table", { name: "Relationship table" });
  await expect(table.getByRole("columnheader", { name: "Class and direction" })).toBeVisible();
  // List reuses Map's own relationship-lens label per row (never a coarser,
  // disagreeing taxonomy) — any of the published lens labels is valid here.
  await expect(table.locator("tbody tr").first()).toContainText(
    /Structure|Applicability|Correlation|Implementation|Assessment|Process|Cross-framework|Threat/,
  );
  await expect(table.locator("tbody tr").first()).toContainText(
    /From selected record|To selected record/,
  );
});
