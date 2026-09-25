import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  gotoApp,
} from "./support.mjs";

// #282 retired the classic skill-tree Atlas; its structure navigation lives on record and Library
// publication pages now. What this suite still guards is the Atlas route's cold-load budget.
test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("twenty consecutive Atlas map cold navigations resolve within five seconds", async ({ browser }) => {
  test.setTimeout(150_000);
  for (let index = 0; index < 20; index += 1) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const started = Date.now();
    await gotoApp(page, `/#/atlas?coldRun=${index}`);
    await expect(page.locator('[data-route-content-ready="true"]')).toBeVisible({ timeout: 5_000 });
    expect(Date.now() - started, `cold load ${index + 1}`).toBeLessThanOrEqual(5_000);
    await context.close();
  }
});
