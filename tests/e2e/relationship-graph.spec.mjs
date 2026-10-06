import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

// The Territory Edition replaced the focused canvas, the Connections section and the
// area-map landing that earlier versions of these two tests asserted. Territory's own
// landing and lenses are covered by atlas-territory.spec.mjs; these keep the record hand-off.
test("Atlas opens a record on the territory sheet with its identity and a way to the full record", async ({ page }) => {
  await page.goto("/#/atlas?node=nist-800-53%3AAC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("heading", { name: "Atlas", level: 1 })).toBeVisible();
  const inspector = page.locator(".atl-inspector");
  await expect(inspector).toContainText("AC-2");
  await expect(inspector).toContainText("Account Management");
  await expect(inspector.getByRole("link", { name: "Open the full record" })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Trace upstream" })).toBeVisible();
});

test("record detail keeps published connections in an accessible list", async ({ page }) => {
  await page.goto(
    "/#/record/nist-800-53/AC-2?relationshipView=list",
  );
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.locator('[data-template="E"]')).toBeVisible();
  // Relationship-display governance summarises large groups behind a
  // disclosure; open them before asserting the list is reachable.
  const groups = page.locator("details:has([data-record-connection-id])");
  for (const group of await groups.all()) {
    await group.evaluate((element) => { element.setAttribute("open", ""); });
  }
  await expect(page.locator('[data-record-section="related-records"] ul').first()).toBeVisible();
});

test("record detail leaves the shared relationship graph in Atlas", async ({ page }) => {
  await page.goto("/#/record/nist-800-53/AC-2?relationshipView=map");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.locator('[data-template="E"]')).toBeVisible();
  await expect(page.locator(".record-template .react-flow")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See connections", exact: true })).toBeVisible();
});

test("record detail opens the same record in the new Atlas", async ({ page }) => {
  await page.goto("/#/record/nist-800-53/AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("link", { name: "See connections", exact: true }).click();
  await expect(page).toHaveURL(/#\/atlas/);
  await expect(page.getByRole("heading", { name: "Atlas", level: 1 })).toBeVisible();
  await expect(page.locator(".atl-inspector")).toContainText("Account Management");
});
