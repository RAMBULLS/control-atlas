// Regression coverage for issue #280 (product pruning). These assertions
// protect the USER JOB, not today's implementation: a legacy scoped Atlas
// link must still land somewhere real with its meaningful state intact, and
// Territory's "Full connection list" handoff must still produce the complete
// connection list for a record. Neither test names AtlasMapPage or asserts
// that any particular surface renders it — #282 can replace the
// implementation freely as long as these outcomes still hold.
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
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
  await expect(page.getByRole("main")).toContainText(/MITRE ATT&CK/i);
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
  // The job is "show the complete connection list for this record": a table
  // or list of counterpart records, not a single summary count.
  const rows = page.getByRole("row").or(page.getByRole("listitem"));
  await expect(rows.first()).toBeVisible({ timeout: 20000 });
  expect(await rows.count()).toBeGreaterThan(3);
});

test("Territory's Full connection list handoff reaches the complete list, and back/reload both hold", async ({ page }) => {
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
  const rows = page.getByRole("row").or(page.getByRole("listitem"));
  await expect(rows.first()).toBeVisible({ timeout: 20000 });

  // A reload of this exact URL (a saved/shared link) must reproduce it.
  const listUrl = page.url();
  await page.reload();
  await waitForAppReady(page);
  await expect(page).toHaveURL(listUrl);
  await expect(rows.first()).toBeVisible({ timeout: 20000 });

  // Back returns to Territory's own record focus, not an error page.
  await page.goBack();
  await waitForAppReady(page);
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Full connection list" })).toBeVisible({ timeout: 20000 });
});
