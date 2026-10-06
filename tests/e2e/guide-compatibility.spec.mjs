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

for (const [guide, template, title] of [
  ["managing-findings", "poam_starter", "POA&M Working Register"],
  ["continuous-monitoring", "conmon_calendar", "Continuous Monitoring Delivery Calendar"],
  ["inheritance-and-common-controls", "inheritance_worksheet", "Inheritance Worksheet"],
  ["reciprocity", "reciprocity_checklist", "Reciprocity Package Review"],
]) {
  test(`${guide} opens the chosen working file and returns through Back`, async ({ page }) => {
    await page.goto(`/#/guides?pattern=${guide}`);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const action = page.getByRole("link", { name: `Open the ${title}`, exact: true });
    const destination = `#/build/documents/${template}`;
    await expect(action).toHaveAttribute("href", destination);

    await action.click();
    await expect.poll(() => new URL(page.url()).hash).toBe(destination);
    await expect(page.locator("#app")).toHaveAttribute("data-view", "templates");
    await waitForAppReady(page);
    await expect(page.getByRole("complementary", { name: "Current document" })).toContainText(title);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`pattern=${guide}$`));
    await expect(page.locator("#app")).toHaveAttribute("data-view", "patterns");
    await waitForAppReady(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test(`${guide} opens the chosen working file in a new tab`, async ({ page, context }) => {
    await page.goto(`/#/guides?pattern=${guide}`);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const action = page.getByRole("link", { name: `Open the ${title}`, exact: true });
    const destination = `#/build/documents/${template}`;
    await expect(action).toHaveAttribute("href", destination);
    const opened = context.waitForEvent("page");
    await action.click({ modifiers: ["Control"] });
    const newTab = await opened;
    await expect(newTab.locator("#app")).toHaveAttribute("data-view", "templates");
    await waitForAppReady(newTab);
    await expect.poll(() => new URL(newTab.url()).hash).toBe(destination);
    await expect(newTab.getByRole("complementary", { name: "Current document" })).toContainText(title);
    await newTab.close();
    await expect(page).toHaveURL(new RegExp(`pattern=${guide}$`));
  });
}

test("saved explanatory guide links open their current destination", async ({ page }) => {
  for (const [guide, destination] of RETIRED_GUIDES) {
    await page.goto(`/#/learn?pattern=${guide}`);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect.poll(() => new URL(page.url()).hash).toBe(`#${destination}`);
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
