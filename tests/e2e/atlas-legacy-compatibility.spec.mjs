// Regression coverage for issue #280 (product pruning). These assertions
// protect the USER JOB, not today's implementation: a legacy scoped Atlas
// link must still land somewhere real with its meaningful state intact, and
// Territory's "Full connection list" handoff must still reach the
// connection-list job for a record. #282 retired the classic Atlas page and
// now answers both natively on the territory sheet (legacy scopes are
// translated in routeIdentity.ts); these outcomes are what it must keep.
//
// Row count is asserted only as "more than a few" (>3), never an exact
// count: the legacy handoff contract is independent of its current 50-row
// replacement pages. The dense-list case below verifies those page bounds.
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

/**
 * The connection-list surface itself, however it's implemented: today a
 * `<table aria-label="Relationship table">`, tolerant of a future
 * implementation that renders the same job as a named list instead.
 */
function connectionResultsOf(page) {
  return page
    .getByRole("table", { name: "Relationship table" })
    .or(page.getByRole("list", { name: /connections/i }));
}

test("a dense full connection list replaces pages and keeps every connection reachable", async ({ page }) => {
  await gotoApp(page, "/#/atlas?node=disa-cci%3ACCI-000366&relationshipView=list");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const table = page.getByRole("table", { name: "Relationship table" });
  await expect(table).toBeVisible({ timeout: 20000 });
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(50);
  expect(await table.evaluate(element => element.getElementsByTagName("*").length)).toBeLessThan(4000);
  const firstId = await rows.first().getAttribute("data-record-connection-id");
  const pager = page.getByRole("navigation", { name: "Connection pages" });
  const total = Number((await pager.innerText()).match(/of ([\d,]+)\./)[1].replace(/,/g, ""));
  expect(total).toBeGreaterThan(1000);
  const original = page.url();
  await pager.getByRole("button", { name: "Next page" }).focus();
  await page.keyboard.press("Enter");
  await expect(pager).toContainText("connections 51-100");
  await expect(rows).toHaveCount(50);
  expect(await rows.first().getAttribute("data-record-connection-id")).not.toBe(firstId);
  await pager.getByRole("button", { name: "Last page" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(total % 50 || 50);
  await expect(pager).toContainText(`-${total.toLocaleString()} of ${total.toLocaleString()}`);
  await expect(pager.getByRole("button", { name: "Previous page" })).toBeFocused();
  await expect(page).toHaveURL(original);
  expect(await table.evaluate(element => element.getElementsByTagName("*").length)).toBeLessThan(4000);
  const filter = page.getByRole("combobox", { name: "Relationship", exact: true });
  await filter.selectOption({ index: 1 });
  await expect(page.locator(".relationship-graph-table__count")).toContainText("connections 1-");
  await filter.selectOption({ index: 0 });
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toHaveAttribute("data-record-connection-id", firstId);
});

test("a legacy scoped Atlas link lands on a working page with its scope intact", async ({ page }) => {
  await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasFramework=mitre-attack");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The requested publication scope is still the one in the URL: the link's
  // meaningful state was preserved, whichever surface answered it.
  await expect(page).toHaveURL(/atlasFramework=mitre-attack/);
  await expect(page.getByRole("main")).toContainText(/ATT&CK Enterprise/);
  await expect(page.getByRole("main")).toContainText(/MITRE/);
});

test("a shared full-relationship-list link for a record still opens with its connections", async ({ page }) => {
  // This is the URL shape Territory's own "Full connection list" link
  // produces (node + relationshipView=list) — treated here as a link someone
  // saved and is opening cold, independent of Territory ever having run.
  await gotoApp(page, "/#/atlas?node=nist-800-53%3AAC-2&relationshipView=list");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  await expect(page).toHaveURL(/relationshipView=list/);
  // The connection-list job: real counterpart entries, not a single summary count.
  const connectionResults = connectionResultsOf(page);
  await expect(connectionResults).toBeVisible({ timeout: 20000 });
  const entries = connectionResults.getByRole("row").or(connectionResults.getByRole("listitem"));
  expect(await entries.count()).toBeGreaterThan(3);
});

test("Territory's Full connection list handoff reaches the full-connection-list destination, and back/reload both hold", async ({ page }) => {
  await gotoApp(page, "/#/atlas/nist-800-53:AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const fullList = page.getByRole("link", { name: "Full connection list" });
  await expect(fullList).toBeVisible({ timeout: 20000 });
  await fullList.click();

  // The handoff's contract is the resulting state, not which component drew it.
  await expect(page).toHaveURL(/relationshipView=list/);
  await expect(page).toHaveURL(/AC-2/);
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  let connectionResults = connectionResultsOf(page);
  await expect(connectionResults).toBeVisible({ timeout: 20000 });
  let entries = connectionResults.getByRole("row").or(connectionResults.getByRole("listitem"));
  expect(await entries.count()).toBeGreaterThan(3);

  // A reload of this exact URL (a saved/shared link) must reproduce it.
  const listUrl = page.url();
  await page.reload();
  await waitForAppReady(page);
  await expect(page).toHaveURL(listUrl);
  connectionResults = connectionResultsOf(page);
  await expect(connectionResults).toBeVisible({ timeout: 20000 });
  entries = connectionResults.getByRole("row").or(connectionResults.getByRole("listitem"));
  expect(await entries.count()).toBeGreaterThan(3);

  // Back returns to Territory's own record focus, not an error page.
  await page.goBack();
  await waitForAppReady(page);
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Full connection list" })).toBeVisible({ timeout: 20000 });
});
