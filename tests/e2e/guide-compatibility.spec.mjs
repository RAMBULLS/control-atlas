import { expect, test } from "@playwright/test";
import { dismissOnboarding, waitForAppReady } from "./support.mjs";

const RETIRED_GUIDES = [
  ["understanding-rmf", "/atlas?atlasJourney=rmf"],
  ["hierarchy-and-relationships", "/atlas"],
  ["source-truth-and-notes", "/sources"],
  ["search-eligibility-and-ranking", "/library"],
  ["read-a-record", "/library"],
  ["published-mappings-in-compare", "/compare"],
  ["starter-documents-and-judgment", "/build"],
];

test("saved explanatory guide links open their current destination", async ({ page }) => {
  for (const [guide, destination] of RETIRED_GUIDES) {
    await page.goto(`/#/learn?pattern=${guide}`);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page).toHaveURL(new RegExp(`#${destination.replace(/[?]/g, "\\?")}$`));
    await expect(page.locator("main h1")).toBeVisible();
  }
});

test("retired RMF guide link keeps the Atlas journey through reload and back", async ({ page }) => {
  await page.goto("/#/");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await page.goto("/#/learn?pattern=understanding-rmf");
  await expect(page).toHaveURL(/#\/atlas\?atlasJourney=rmf$/);
  await page.reload();
  await expect(page).toHaveURL(/#\/atlas\?atlasJourney=rmf$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
});

test("guide navigation returns keyboard focus to the visible heading", async ({ page }) => {
  await page.goto("/#/guides");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await page.getByRole("link", { name: /Documenting control implementation/ }).click();
  await expect(page.locator("main h1")).toBeFocused();
  await expect(page.locator("main h1")).toHaveText("Documenting control implementation");
  await page.getByRole("link", { name: "Back to Guides" }).click();
  await expect(page.locator("main h1")).toBeFocused();
  await expect(page.locator("main h1")).toHaveText("Guides");
});
