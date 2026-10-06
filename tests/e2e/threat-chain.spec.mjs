import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("retired threat-chain links recover to the published crosswalk", async ({
  page,
}) => {
  await page.goto(
    "/?view=matrix&workbench=threat-chain&chainCatalog=mitre-attack&chainItem=mitre-attack%3AT1033",
  );
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page).toHaveURL(/#\/compare$/);
  await expect(page.getByText(
    "This Compare link used a retired workflow. Start a published crosswalk here.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByRole("tab", { name: "Frameworks" })).toHaveAttribute("aria-selected", "true");
});

test("threat records open the supported Specific item comparison", async ({
  page,
}) => {
  await page.goto("/#/record/mitre-attack/T1033");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.locator(".record-actions-menu summary").click();
  await page.locator(".record-actions-popover")
    .getByRole("link", { name: "Compare frameworks", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/compare(?:\/relationships)?\?.*(source=mitre-attack.*items=T1033|items=T1033.*source=mitre-attack)/);
  // Compare loads its crosswalk data after the app reports ready, and shows
  // "Loading the comparison" until it lands — measured at 4.7s past app-ready
  // for this route, against a 5s default assertion timeout. Waiting for the
  // tablist to exist first is the difference between testing the product and
  // testing how fast the machine is that day.
  const specificItem = page.getByRole("tab", { name: "Specific item" });
  await expect(specificItem).toBeVisible({ timeout: 30_000 });
  await expect(specificItem).toHaveAttribute("aria-selected", "true");
});
