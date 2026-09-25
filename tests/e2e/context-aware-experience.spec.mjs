import { test, expect } from "@playwright/test";

async function open(page, path) {
  await page.goto(path);
  await expect(page.locator('[data-app-ready="true"]')).toBeVisible({ timeout: 30000 });
  if (path.startsWith("/#/record/")) {
    await expect(page.locator('[data-template="E"]')).toBeVisible();
    await expect(page.locator(".route-transition")).toBeHidden();
  }
}

test("Home is a calm, task-focused front door", async ({ page }) => {
  await open(page, "/#/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Make federal cybersecurity make sense.",
  );
  await expect(page.getByText("Understand what applies, what it means, and what to do next.", { exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search Control Atlas" })).toBeVisible();
  await expect(page.locator(".home-search").getByRole("button", { name: "Search" })).toBeVisible();
  for (const entrance of ["Browse the Atlas", "Search the Library", "Browse Resources"]) {
    await expect(page.getByRole("link", { name: new RegExp(entrance) })).toBeVisible();
  }
  // Five practitioner questions, ordered the way the work runs. The sixth
  // card was a record-volume statistic, not a place to start.
  await expect(page.locator(".home-library-kpis .home-library-kpi")).toHaveCount(5);
});

test("record leads with publisher text and contains no generated guidance", async ({ page }) => {
  await open(page, "/#/record/nist-800-53/AC-2");
  await expect(page.getByRole("heading", { name: "Control Statement", exact: true })).toBeVisible();
  await expect(page.locator('[data-source-field="description"] p')).not.toBeEmpty();
  await expect(page.locator('[data-editorial-boundary="explicit"]')).toHaveCount(0);
  await expect(page.getByText(/What this is|What you need to do|How to satisfy it/i)).toHaveCount(0);
});

test("record template stays inside the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "/#/record/nist-800-53/AC-2");
  const overflow = await page.evaluate(() => ({
    body: globalThis.document.body.scrollWidth - globalThis.document.body.clientWidth,
    document: globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
  }));
  const templateRegions = page.locator(".record-template-grid, .record-official-text, .record-connections");
  expect(overflow.body).toBe(0);
  expect(overflow.document).toBe(0);
  expect(await templateRegions.count()).toBe(3);
  expect(await templateRegions.evaluateAll((groups) =>
    groups.map((group) => group.scrollWidth - group.clientWidth),
  )).toEqual([0, 0, 0]);
});

test("record actions preserve durable context across features", async ({ page }) => {
  await open(page, "/#/record/nist-800-53/AC-2");
  await page.getByRole("link", { name: "See connections", exact: true }).click();
  await expect(page).toHaveURL(/#\/atlas\/nist-800-53(?::|%3A)AC-2/);

  await open(page, "/#/record/nist-800-53/AC-2");
  await page.locator(".record-actions-menu summary").click();
  await expect(page.locator(".record-actions-menu")).toHaveAttribute("open", "");
  await page.locator(".record-actions-popover").getByRole("link", { name: "Compare frameworks", exact: true }).click();
  await expect(page).toHaveURL(/#\/compare(?:\/relationships)?\?.*(source=nist-800-53.*items=AC-2|items=AC-2.*source=nist-800-53)/);
});

test("record types show source-native publisher fields", async ({ page }) => {
  const cases = [
    ["/#/record/disa-cci/CCI-000001", "Requirement"],
    ["/#/record/disa-stig/V-222387", "Discussion"],
    ["/#/record/nist-800-171/3.17.1", "Requirement"],
    ["/#/record/mitre-attack/T1195.002", "Technique Description"],
  ];
  for (const [path, section] of cases) {
    await open(page, path);
    await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
    await expect(page.locator('[data-source-field="description"] p').first()).not.toBeEmpty();
  }
});

test("Library and Resources keep their result kinds distinct", async ({ page }) => {
  await open(page, "/#/library?q=access");
  await expect(page.locator('[data-result-class="published-record"]').first()).toBeVisible();
  await expect(page.locator('[data-result-class="resource"]')).toHaveCount(0);

  await open(page, "/#/resources?q=NISTControls");
  await expect(page.locator('[data-result-class="resource"]').first()).toBeVisible();
});
