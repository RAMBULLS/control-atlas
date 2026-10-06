import { expect, test } from "@playwright/test";

import { START_HERE_ACCEPTANCE_MATRIX } from "../../src/app/start-here-compatibility.mjs";
import { attachPageDiagnostics, dismissOnboarding, waitForAppReady } from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("old Start Here bookmarks resolve to the audited product destination", async ({ page }) => {
  for (const { goalId, contextId, firstDestination } of START_HERE_ACCEPTANCE_MATRIX) {
    await page.goto(`/#/start?goal=${goalId}&context=${contextId}`);
    await expect.poll(() => new URL(page.url()).hash).toBe(`#${firstDestination}`);
  }
});

test("unknown context and partial bookmarks never guess a publication", async ({ page }) => {
  for (const [legacy, destination] of [
    ["/#/start", "#/atlas"],
    ["/#/start?goal=assess&context=unsure", "#/atlas?atlasJourney=assessment"],
    ["/#/start?goal=tools&context=unsure", "#/resources"],
    ["/#/start?goal=document", "#/build"],
  ]) {
    await page.goto(legacy);
    await expect.poll(() => new URL(page.url()).hash).toBe(destination);
    await expect(page.getByRole("heading", { name: /^Start with/ })).toHaveCount(0);
  }
});

for (const width of [390, 1440]) {
  test(`former Start Here route at ${width}px opens Atlas without a shortcut wall`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/start");
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect.poll(() => new URL(page.url()).hash).toBe("#/atlas");
    await expect(page.locator(".start-here-known, .start-here-choice-grid")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Explore RMF & ATO" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Explore STIGs & SRGs" })).toHaveCount(0);
    const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth);
    expect(overflow).toBe(false);
  });
}

test("a consolidated bookmark survives reload and back navigation", async ({ page }) => {
  await page.goto("/#/start?goal=tools&context=fedramp");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/resources");
  await page.reload();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/resources");
  await page.goto("/#/about");
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/resources");
});
