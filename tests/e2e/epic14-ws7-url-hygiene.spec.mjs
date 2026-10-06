import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("WS7 rewrites legacy Atlas and Compare links into readable canonical routes", async ({ page }) => {
  test.setTimeout(180_000);

  await gotoApp(page, "/#/atlas?node=nist-800-53%3AAC-2&relationshipView=map");
  await waitForAppReady(page, { allowPartial: true });
  // The retired classic "map" view is the record's focus on the territory sheet now.
  await expect(page).toHaveURL(/#\/atlas\/nist-800-53:AC-2$/);
  await expect(page.locator(".atl-inspector")).toContainText("AC-2", { timeout: 20000 });
  await expect(page.getByRole("link", { name: "Full connection list" })).toBeVisible();

  await gotoApp(page, "/#/compare?crosswalk=relationships&workbench=relationships&source=nist-800-53&target=csf-2");
  await waitForAppReady(page, { allowPartial: true });
  await expect(page).toHaveURL(/#\/compare\/relationships\?source=nist-800-53&target=csf-2$/);
  await expect(page.getByRole("heading", { name: "Compare", level: 1 })).toBeVisible();
});

test("WS7 removes retired mode state during legacy-query migration", async ({ page }) => {
  await gotoApp(page, "/?mode=novice#");
  await waitForAppReady(page, { allowPartial: true });
  await expect(page).not.toHaveURL(/mode=/);
  await expect(page).toHaveURL(/#\/$/);
});
