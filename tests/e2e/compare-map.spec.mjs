import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

async function openCompare(page, route = "/#/compare") {
  await gotoApp(page, route);
  await waitForAppReady(page);
  await dismissOnboarding(page);
}

test("Compare opens as the Orbital three-stage Frameworks flow", async ({
  page,
}) => {
  await openCompare(page);

  await expect(
    page.getByRole("heading", { level: 1, name: "Compare" }),
  ).toBeVisible();
  // The count is data, not a constant: it must match the publications offered.
  await expect(page.locator(".compare-option").first()).toBeVisible();
  await expect(page.locator(".page-header-eyebrow")).toHaveText(
    `PUBLISHED CROSSWALKS / ${await page.locator(".compare-option").count()} CONNECTED PUBLICATIONS`,
  );
  await expect(page.locator(".page-summary")).toHaveText(
    "See how frameworks connect using published crosswalks.",
  );

  const modes = page.getByRole("tablist", { name: "Comparison mode" });
  await expect(modes.getByRole("tab", { name: "Frameworks" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    modes.getByRole("tab", { name: "Specific item" }),
  ).toHaveAttribute("aria-selected", "false");

  const progress = page.getByRole("navigation", { name: "Step progress" });
  await expect(progress.locator("li")).toHaveCount(3);
  await expect(progress.locator("li")).toHaveText([
    /^01Source/,
    /^02Compare with/,
    /^03Results/,
  ]);
  await expect(progress.locator('[aria-current="step"]')).toContainText(
    "Source",
  );

  await expect(
    page.getByRole("heading", { level: 2, name: "Choose a framework" }),
  ).toBeVisible();
  const source = page.getByRole("combobox", { name: "Publication" });
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute("list", /-options$/);
  await expect(page.getByRole("combobox", { name: /^Compare with/ })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: "Nothing selected yet" }),
  ).toBeVisible();

  // Setup stays mission-level: no future field, evidence chooser, systems
  // controls, or legacy card chooser is mounted before the user earns it.
  await expect(page.getByText("Crosswalk source", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Refine results", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source basis", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Trust level", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/candidate|inferred/i)).toHaveCount(0);
  await expect(page.locator(".intent-card")).toHaveCount(0);
  await expect(page.locator("#compare-workspace.panel")).toHaveCount(0);

  // A publication with no published crosswalk partner cannot be selected.
  const listId = await source.getAttribute("list");
  await expect(page.locator(`#${listId} option[value="DoD AI Assurance"]`)).toHaveCount(0);

  const specificItem = modes.getByRole("tab", { name: "Specific item" });
  await specificItem.focus();
  await expect(specificItem).toBeFocused();
  await specificItem.press("Enter");
  await expect(specificItem).toHaveAttribute("aria-selected", "true");
  const frameworks = modes.getByRole("tab", { name: "Frameworks" });
  await frameworks.focus();
  await frameworks.press("Enter");
  await expect(frameworks).toHaveAttribute("aria-selected", "true");
});

test("Frameworks reveals connected targets and a two-column published result", async ({
  page,
}) => {
  await openCompare(page);

  await page.getByRole("combobox", { name: "Publication" }).fill(
    "SP 800-53 Rev. 5",
  );
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Choose a framework to compare with",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Step progress" })
      .locator('[aria-current="step"]'),
  ).toContainText("Compare with");

  const support = page.locator(".compare-flow-support");
  await expect(support).toContainText("SP 800-53 Rev. 5");
  await expect(support).toContainText(/\d+ connected publications/);

  // Both steps now pick a publication the same way: a searchable field over an
  // open list of every connected publication, rather than a dropdown for the
  // target and an open list for the source.
  const target = page.getByRole("combobox", { name: /^Compare with/ });
  await expect(target).toBeVisible();
  const targetOptions = page.locator(".compare-option-list");
  await expect(targetOptions.getByRole("button", { name: "NIST CSF 2.0", exact: true })).toBeVisible();
  // A publication with no published crosswalk to the source is not offered.
  await expect(targetOptions.getByRole("button", { name: /Responsible AI/ })).toHaveCount(0);
  await targetOptions.getByRole("button", { name: "NIST CSF 2.0", exact: true }).click();

  await expect(page.locator("#compare-results")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#compare-results h2")).toContainText(
    "SP 800-53 Rev. 5 ↔ NIST CSF 2.0",
  );
  await expect(page.locator(".compare-mapping-total")).toContainText(
    "746 published mappings across",
  );

  const table = page.getByRole("table", { name: "Published crosswalk mappings" });
  await expect(table).toBeVisible();
  await expect(table.locator("thead th")).toHaveText(["From", "Maps to"]);
  await expect(table.locator("tbody tr").first().locator("td")).toHaveCount(2);
  const allSourceRows = await table.locator("tbody tr").count();
  expect(allSourceRows).toBe(25);
  const pagination = page.getByRole("navigation", { name: "Mapping result pages" });
  await expect(pagination).toContainText("Showing source records 1–25");
  const firstPageSourceId = await table.locator("tbody tr").first().locator("td").first().locator("strong").innerText();
  await pagination.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(pagination).toContainText("Showing source records 26–50");
  await expect(table.locator("tbody tr")).toHaveCount(25);
  expect(
    await table.locator("tbody tr").first().locator("td").first().locator("strong").innerText(),
  ).not.toBe(firstPageSourceId);
  await pagination.getByRole("button", { name: "Previous page" }).click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await expect(page.locator("[data-continuous-results] [data-continuous-scroll]")).toBeVisible();

  const sourceEvidence = page.locator(".compare-crosswalk-source");
  await expect(sourceEvidence).toContainText("Crosswalk source");
  await expect(sourceEvidence).toContainText("NIST CSF 2.0");
  await expect(page.getByRole("combobox", { name: "Crosswalk source" })).toHaveCount(0);

  const boundary = page.getByText(
    "A published crosswalk shows a cited relationship; it does not by itself establish equivalence or compliance.",
    { exact: true },
  );
  await expect(boundary).toHaveCount(1);
  await expect(boundary).toBeVisible();

  // Refinement is visible in the toolbar; there is no bottom drawer to open.
  await expect(page.getByText("Refine results", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Connection type")).toBeVisible();
  await expect(page.getByText("Source basis", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Trust level", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/candidate|inferred/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Atlas map" })).toHaveCount(0);

  const firstSourceId = await table.locator("tbody tr").first().locator("td").first().locator("strong").innerText();
  const resultSearch = page.getByLabel("Search results by ID or title");
  await resultSearch.fill(firstSourceId.trim());
  await expect(page.locator(".compare-mapping-total")).toContainText("of 746 published mappings match");
  const searchedSourceRows = await table.locator("tbody tr").count();
  expect(searchedSourceRows).toBeGreaterThan(0);
  expect(searchedSourceRows).toBeLessThan(allSourceRows);

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toBe("control-atlas-crosswalk.csv");
  const csvPath = await csvDownload.path();
  expect(csvPath).toBeTruthy();
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain('"Source Publication","Source Version","Source ID","Source Title"');
  expect(csv).toContain(firstSourceId.trim());

  const xlsxDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel workbook" }).click();
  const xlsxDownload = await xlsxDownloadPromise;
  expect(xlsxDownload.suggestedFilename()).toBe("control-atlas-crosswalk.xlsx");
  const xlsxPath = await xlsxDownload.path();
  expect(xlsxPath).toBeTruthy();
  const xlsx = await readFile(xlsxPath);
  expect(xlsx.subarray(0, 2).toString()).toBe("PK");

  await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(0);
});

test("a pair with multiple published sources defaults to all and exposes one result filter", async ({
  page,
}) => {
  await openCompare(
    page,
    "/#/compare/relationships?intent=item-mapping&source=nist-800-53&items=AC-2&target=disa-cci",
  );

  await page.getByRole("button", { name: "Show published mappings" }).click();
  const sourceFilter = page.getByRole("combobox", { name: "Crosswalk source" });
  await expect(sourceFilter).toBeVisible({ timeout: 30_000 });
  await expect(sourceFilter).toHaveValue("");
  await expect(sourceFilter.locator("option")).toHaveText([
    "All published sources",
    "DISA CCI",
    "SP 800-53 Rev. 5",
  ]);

  await sourceFilter.selectOption("disa-cci-nist-references");
  await expect(page).toHaveURL(/mappingSource=disa-cci-nist-references/);
  await expect(
    page.getByRole("table", { name: "Published crosswalk mappings" }),
  ).toBeVisible();
});

test("Specific item reveals only targets with a real mapping for the exact item", async ({
  page,
}) => {
  await openCompare(page);

  await page.getByRole("tab", { name: "Specific item" }).click();
  await expect(
    page.getByRole("tab", { name: "Specific item" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("navigation", { name: "Step progress" }).locator("li"),
  ).toHaveText([/^01Item/, /^02Compare with/, /^03Results/]);
  await expect(page.getByLabel("Control / requirement / rule")).toBeVisible();

  await page.getByRole("combobox", { name: "Publication" }).fill(
    "SP 800-171 Rev. 3",
  );
  await page.getByLabel("Control / requirement / rule").fill("3.1.1");

  const target = page.getByRole("combobox", { name: /^Compare with/ });
  await expect(target).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(".compare-option-list").getByRole("button", {
      name: "SP 800-53 Rev. 5",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".compare-option-list").getByRole("button", { name: /Responsible AI/ }),
  ).toHaveCount(0);

  await page
    .locator(".compare-option-list")
    .getByRole("button", { name: "SP 800-53 Rev. 5", exact: true })
    .click();
  await expect(page.locator(".compare-mapping-total")).toContainText(
    "4 published mappings across",
  );
  const table = page.getByRole("table", { name: "Published crosswalk mappings" });
  await expect(table).toBeVisible();
  await expect(table.getByText("3.1.1", { exact: true }).first()).toBeVisible();
});

test("invalid and zero-capability scopes never become selectable result states", async ({
  page,
}) => {
  await openCompare(
    page,
    "/#/compare/relationships?intent=frameworks&source=nist-800-53&target=not-a-real-catalog",
  );

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Choose a framework to compare with",
    }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Compare with/ })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Show published mappings" }),
  ).toBeDisabled();
  await expect(page.locator("#compare-results")).toHaveCount(0);
  await expect(page.getByText("Crosswalk source", { exact: true })).toHaveCount(0);
});
