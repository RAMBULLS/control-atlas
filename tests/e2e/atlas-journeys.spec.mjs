// Issue #282: practitioner-first journeys, secondary Policy & directives, and the native full
// connection list. Journeys are Control Atlas navigation: they add destinations, never map lines.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";
/* global document */

const JOURNEYS = ["RMF & ATO", "STIGs & SRGs", "Zero Trust", "CMMC & CUI", "FedRAMP", "Controls & baselines", "Assessment & evidence", "Threats & defenses", "Working files"];

async function open(page, path = "/#/atlas", width = 1440) {
  attachPageDiagnostics(page);
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await gotoApp(page, path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator(".atl")).toBeVisible({ timeout: 30000 });
}
const query = (page) => new URLSearchParams(new URL(page.url()).hash.split("?")[1] || "");
const card = (page) => page.locator(".atl-journey");

test("every practitioner journey is one click away without publication numbers", async ({ page }) => {
  await open(page);
  const bar = page.getByRole("navigation", { name: "Start with what you’re working on" });
  for (const name of JOURNEYS) await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  for (const name of JOURNEYS) {
    await bar.getByRole("button", { name, exact: true }).click();
    await expect(card(page).getByRole("heading", { level: 2 })).toHaveText(name);
    await expect(bar.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    // A journey is navigation only: it never draws a relationship line.
    await expect(page.locator(".route--sel, .route--focus, .route--shared")).toHaveCount(0);
    expect(await card(page).locator("a, button").count()).toBeGreaterThanOrEqual(3);
    await expect(card(page)).toContainText("Not a publisher mapping.");
  }
});

test("RMF leads with the practitioner name and keeps the exact publication identity, with real handoffs", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "RMF & ATO", exact: true }).click();
  expect(query(page).get("atlasJourney")).toBe("rmf");
  const rmf = card(page);
  await expect(rmf.getByRole("button", { name: /RMF process: SP 800-37 Rev\. 2/ })).toBeVisible();
  await expect(rmf.getByRole("button", { name: /Control catalog: SP 800-53 Rev\. 5/ })).toBeVisible();
  await expect(rmf.getByRole("link", { name: "Compare SP 800-53 Rev. 5 and 800-53B" })).toHaveAttribute("href", /compare\/relationships\?.*source=nist-800-53.*target=nist-800-53b/);
  await expect(rmf.getByRole("link", { name: "Build an authorization package" })).toHaveAttribute("href", /#\/build\/tasks\/build-authorization-package/);
  await expect(rmf.getByRole("link", { name: "Security Plan Starter" })).toHaveAttribute("href", /#\/build\/documents\/security_plan_starter/);
  await expect(rmf.getByRole("link", { name: "DoD RMF Knowledge Service" })).toHaveAttribute("href", /#\/resources\/service-dod-rmf-knowledge-service/);
  await rmf.getByText(/^Policy & directives · \d+$/).click();
  // A journey addition shows its stated basis, never a citation the authority data does not record.
  const dodi = rmf.locator(".atl-policy__item", { hasText: "DoDI 8510.01" });
  await expect(dodi).toContainText("Its official title is Risk Management Framework for DoD Systems.");
  await expect(dodi).not.toContainText("Cited as the basis for");
  await expect(rmf).toContainText("OMB Circular A-130");
  // A step opens the published step record on the map; back returns to the journey.
  await rmf.getByRole("button", { name: "Categorize" }).click();
  await expect(page).toHaveURL(/#\/atlas\/nist-800-37:RMF-CATEGORIZE\?atlasJourney=rmf/);
  await page.getByRole("button", { name: "‹ Back to RMF & ATO" }).click();
  await expect(card(page)).toBeVisible();
  await page.reload();
  await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("RMF & ATO", { timeout: 20000 });
  await page.goBack();
  await expect(page).toHaveURL(/RMF-CATEGORIZE/);
});

test("a publication opened from a journey keeps its Library and map handoffs", async ({ page }) => {
  await open(page, "/#/atlas?atlasJourney=stig");
  await card(page).getByRole("button", { name: /^STIGs: DISA STIG/ }).click();
  await expect(page).toHaveURL(/atlasFramework=disa-stig/);
  await expect(page.locator(".atl-inspector")).toContainText("DISA STIG");
  await expect(page.locator(".atl-inspector").getByRole("link", { name: "Open in the Library" })).toHaveAttribute("href", /library\/publication\/disa-stig/);
  await page.getByRole("button", { name: "◂ Atlas overview" }).click();
  expect(query(page).get("atlasJourney")).toBeNull();
});

test("practitioner words in Atlas search open the journey; exact publication names still win", async ({ page }) => {
  await open(page);
  await page.locator("#atlas-search").fill("ATO");
  await expect(page.locator("#atlas-results button").first()).toContainText("RMF & ATO");
  await page.locator("#atlas-search").press("Enter");
  await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("RMF & ATO");
  await page.locator("#atlas-search").fill("FedRAMP");
  await expect(page.locator("#atlas-results button").first()).toContainText("FedRAMP 2026");
});

test("keyboard reaches a journey and opens it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Zero Trust", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Zero Trust");
  await expect(card(page).getByRole("link", { name: "NIST SP 1800-35" })).toHaveAttribute("href", /sources\?source=nist-sp-1800-35/);
});

test("the full connection list is native to Atlas, filterable, and returns to the record", async ({ page }) => {
  await open(page, "/#/atlas/nist-800-53:AC-2");
  await page.getByRole("link", { name: "Full connection list" }).click();
  const list = page.getByRole("region", { name: /All connections · AC-2/ });
  await expect(list.getByRole("table", { name: "Relationship table" })).toBeVisible({ timeout: 20000 });
  const select = list.locator("#atl-conn-type");
  const option = (await select.locator("option").allTextContents()).find((t) => /^Assesses/.test(t));
  expect(option).toBeTruthy();
  await select.selectOption({ label: option });
  expect(query(page).get("relationshipType")).toBe("assesses");
  await expect(list.getByRole("row").nth(1)).toContainText("Assesses");
  await list.getByRole("button", { name: "Back to the map" }).click();
  expect(query(page).get("relationshipView")).toBeNull();
  await expect(page.getByRole("link", { name: "Full connection list" })).toBeVisible();
});

for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`journeys, policy and the connection list fit at ${width}px`, async ({ page }) => {
    for (const path of ["/#/atlas/nist-800-53:AC-2?relationshipView=list", "/#/atlas?atlasJourney=rmf"]) {
      await open(page, path, width);
      if (path.includes("rmf")) await expect(card(page)).toBeVisible();
      else await expect(page.getByRole("table", { name: "Relationship table" })).toBeVisible({ timeout: 20000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    await page.getByRole("button", { name: "Policy & directives" }).click();
    await expect(page.getByRole("region", { name: /Policy & directives · \d+/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const control of await page.locator(".atl-journeys__list button:visible, .atl-journey button:visible").all()) {
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(43.5);
    }
  });
}

test("on a phone the journeys come before the territories and an open journey leads the page", async ({ page }) => {
  await open(page, "/#/atlas", 390);
  const journeys = page.getByRole("heading", { name: "Start with what you’re working on" });
  const territories = page.getByRole("heading", { name: "Territories" });
  expect((await journeys.boundingBox()).y).toBeLessThan((await territories.boundingBox()).y);
  await page.getByRole("button", { name: "CMMC & CUI", exact: true }).click();
  const opened = card(page);
  await expect(opened).toBeVisible();
  expect((await opened.boundingBox()).y).toBeLessThan((await territories.boundingBox()).y);
  await expect(opened.getByRole("link", { name: "NARA CUI Registry" })).toBeVisible();
});

test("journey, policy and connection list have no serious accessibility violations", async ({ page }) => {
  for (const path of ["/#/atlas?atlasJourney=assessment", "/#/atlas/nist-800-53:AC-2?relationshipView=list"]) {
    await open(page, path);
    if (path.includes("assessment")) await page.getByRole("button", { name: "Policy & directives" }).click();
    else await expect(page.getByRole("table", { name: "Relationship table" })).toBeVisible({ timeout: 20000 });
    const results = await new AxeBuilder({ page }).include(".atl").analyze();
    expect(results.violations.filter((v) => ["serious", "critical"].includes(v.impact))).toEqual([]);
  }
});
