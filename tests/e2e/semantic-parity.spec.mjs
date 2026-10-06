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

test("record identity and displayed authority trace stay canonical", async ({ page }) => {
  await gotoApp(page, "/#/record/nist-800-53/AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.locator("[data-canonical-breadcrumb]"))
    .toHaveAttribute("data-canonical-breadcrumb", /Compliance.*SP 800-53.*Access Control.*AC-2/);
  const sidebar = page.locator(".record-template-sidebar");
  await expect(sidebar).toHaveAttribute("data-displayed-trace", /.+>.+/);
  // The accepted record page shows the path as its breadcrumb; the rail keeps the trace as data only.
  const breadcrumb = page.locator("[data-canonical-breadcrumb]");
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb).toContainText("Compliance");
  await expect(breadcrumb).toContainText("Access Control");
});

test("record connections retain distinct published assertions and citations", async ({ page }) => {
  await gotoApp(page, "/#/record/nist-800-53/AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  // Relationship-display governance summarises large groups behind a
  // disclosure. Open every group so the assertions cover all published rows.
  const rows = page.locator("[data-record-connection-id]");
  await expect(rows.first()).toBeAttached({ timeout: 20000 });
  const groups = page.locator(".record-connections details, details:has([data-record-connection-id])");
  for (const group of await groups.all()) {
    await group.evaluate((element) => { element.setAttribute("open", ""); });
  }
  await expect(rows.first()).toBeVisible({ timeout: 20000 });
  expect(await rows.count()).toBeGreaterThan(0);
  const ids = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-record-connection-id")),
  );
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  for (const row of await rows.all()) {
    await expect(row.locator(".relationship-meta")).not.toBeEmpty();
    await expect(row.locator(".relationship-citation")).not.toBeEmpty();
  }
});

test("record reading flow excludes structural and developer identifiers", async ({ page }) => {
  await gotoApp(page, "/#/record/nist-800-53/AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const mainText = await page.locator("main").innerText();
  expect(mainText).not.toContain("FAMILY-AC");
  expect(mainText).not.toMatch(/\.json#|\/data\//);
  await expect(page.getByText("Developer details", { exact: true })).toHaveCount(0);
  await expect(page.getByText("nist-800-53:AC-2", { exact: true })).toBeHidden();
});
