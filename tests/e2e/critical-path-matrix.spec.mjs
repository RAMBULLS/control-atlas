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

test("critical path: Template B landing hero and four entry cards are visible", async ({
  page,
}) => {
  await gotoApp(page, "/");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(
    page.getByRole("heading", {
      name: "Explore federal cybersecurity",
    }),
  ).toBeVisible();

  await expect(page.getByRole("searchbox", { name: "Search Control Atlas" })).toBeVisible();
  await expect(page.locator(".home-search").getByRole("button", { name: "Search" })).toBeVisible();
  await expect(page.locator('[data-template="B"]')).toBeVisible();
  await expect(page.locator(".home-secondary-action")).toHaveCount(3);
  // Five practitioner questions, ordered the way the work runs. The sixth
  // card was a record-volume statistic, not a place to start.
  await expect(page.locator(".home-library-kpis .home-library-kpi")).toHaveCount(5);
});

test("critical path: the Atlas connection list walks to a published connected record", async ({
  page,
}) => {
  await gotoApp(
    page,
    "/#/explore?node=nist-800-53%3AAC-2&relationshipView=list",
  );
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const table = page.getByRole("table", { name: "Relationship table" });
  await expect(table).toBeVisible({ timeout: 20000 });
  await table.locator("tbody tr").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/#\/record\//);
  await expect(page).not.toHaveURL(/AC-2$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // …and back into Atlas for that record's own connections.
  await page.getByRole("link", { name: "See connections", exact: true }).click();
  await expect(page).toHaveURL(/#\/atlas\//);
  await expect(page.getByRole("link", { name: "Full connection list" })).toBeVisible({ timeout: 20000 });
});

test("critical path: Atlas selected record leaves the map for record detail", async ({
  page,
}) => {
  await gotoApp(page, "/#/explore?node=nist-800-53%3AAC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.locator(".atl-inspector").getByRole("link", { name: "Open the full record" }).click();
  await expect(page).toHaveURL(/#\/record\/nist-800-53\/AC-2/);
  await expect(page.locator(".detail-page")).toBeVisible();
  await expect(page.getByRole("link", { name: "See connections", exact: true })).toBeVisible();
});

test("critical path: browser back returns from a record to the original search", async ({
  page,
}) => {
  await gotoApp(page, "/#/search?q=AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.locator('[data-record-id="nist-800-53:AC-2"] .workspace-result-row__link').click();
  await expect(page.locator(".detail-page")).toBeVisible();
  await page.goBack();

  await expect(page).toHaveURL(/#\/library\?q=AC-2/);
  await expect(page.getByLabel("Filter results by ID, title, or topic")).toHaveValue(
    "AC-2",
  );
});

test("critical path: Compare keeps evidence subordinate to the two-column crosswalk", async ({
  page,
}) => {
  await gotoApp(
    page,
    "/#/compare/relationships?intent=frameworks&source=nist-800-53&target=csf-2",
  );
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("button", { name: "Show published mappings" }).click();
  await expect(page.locator("#compare-results")).toBeVisible({
    timeout: 15000,
  });

  const table = page.getByRole("table", { name: "Published crosswalk mappings" });
  await expect(table).toBeVisible();
  await expect(table.locator("thead th")).toHaveText(["From", "Maps to"]);
  const evidence = table.locator("details.mapping-row-details").first();
  await expect(evidence).not.toHaveAttribute("open", "");
  await evidence.locator("summary").click();
  await expect(evidence).toHaveAttribute("open", "");
  await expect(evidence.locator(".mapping-evidence-list")).not.toBeEmpty();
});

/**
 * Relationship-display governance summarises large connection groups behind a
 * disclosure. Open them so assertions cover every published row.
 */
async function openConnectionGroups(page) {
  const groups = page.locator("details:has([data-record-connection-id])");
  for (const group of await groups.all()) {
    await group.evaluate((element) => { element.setAttribute("open", ""); });
  }
}

test("critical path: library detail connections show meaning and source trust text", async ({
  page,
}) => {
  await gotoApp(page, "/#/record/nist-800-53/AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(
    page.getByRole("heading", { name: "Related records" }).first(),
  ).toBeVisible();
  const relationshipCard = page.locator("[data-record-connection-id]").first();
  await expect(relationshipCard).toBeAttached();
  await openConnectionGroups(page);
  await expect(relationshipCard).toBeVisible();
  await expect(
    relationshipCard.locator(".relationship-meta"),
  ).not.toBeEmpty();
  await expect(
    relationshipCard.locator(".relationship-citation"),
  ).not.toBeEmpty();
});

test("critical path: record reading page uses a list and keeps the graph in Atlas", async ({
  page,
}) => {
  await gotoApp(
    page,
    "/#/record/nist-800-53/AC-2",
  );
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const connections = page.locator('[data-record-section="related-records"]');
  await expect(connections).toBeVisible();
  expect(await connections.locator("ul").count()).toBeGreaterThan(0);
  await openConnectionGroups(page);
  await expect(connections.locator("ul").first()).toBeVisible();
  await expect(page.locator(".record-template .react-flow")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See connections", exact: true })).toBeVisible();
});

test("critical path: MITRE library search returns technique with plain-language summary", async ({
  page,
}) => {
  test.setTimeout(120000);
  await gotoApp(page, "/?view=search&q=T1033");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(
    page.locator("#library-results .workspace-result-row__link").first(),
  ).toBeVisible({
    timeout: 90000,
  });
  await page
    .locator("#library-results .workspace-result-row__link")
    .first()
    .click();
  await expect(page).toHaveURL(/record\/mitre-attack|library-detail/);
  await expect(
    page.getByRole("heading", { name: /T1033/, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Technique Description", exact: true })).toBeVisible();
});

test("critical path: retired Compare workflows recover to the published crosswalk", async ({
  page,
}) => {
  for (const mode of ["baseline-compare", "stig-chain", "threat-chain"]) {
    await gotoApp(
      page,
      `/#/compare/${mode}?chainCatalog=mitre-attack&baselineA=nist-800-53b:LOW`,
    );
    await waitForAppReady(page);
    await dismissOnboarding(page);

    await expect(page).toHaveURL(/#\/compare$/);
    await expect(
      page.getByText(
        "This Compare link used a retired workflow. Start a published crosswalk here.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Compare" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Frameworks" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".chain-grid")).toHaveCount(0);
    await expect(page.getByLabel("Baseline A")).toHaveCount(0);
  }
});

test("critical path: keyboard focus reaches primary nav and search", async ({
  page,
}) => {
  // 2026-08-03: utility navigation grew from 3 items to 5 (Resources/About
  // joined Sources/Help/Start here), which needs more header width before
  // the full desktop chrome fits — see styles/orbital.css's compactNavigation
  // breakpoint comment. Playwright's bare default viewport (1280x720) is
  // below it now, so the primary nav this test exercises would otherwise be
  // the (correctly) collapsed mobile-sheet version instead.
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoApp(page, "/?view=explore");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const primaryNav = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const library = primaryNav.getByRole("link", {
    name: "Library",
    exact: true,
  });
  await library.focus();
  await expect(library).toBeFocused();
  // Scoped to the banner: the static search shell's own "Start here" button
  // can also be present in the DOM while its route is loading.
  const startHere = page.getByRole("banner").getByRole("link", {
    name: "Start here",
    exact: true,
  });
  await startHere.focus();
  await expect(startHere).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Start here", exact: true }),
  ).toBeVisible();

  const search = page.getByRole("button", { name: "Open search" });
  await search.focus();
  await expect(search).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("searchbox", { name: "Search Control Atlas" }),
  ).toBeFocused();
});
