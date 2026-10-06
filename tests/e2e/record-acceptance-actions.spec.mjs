import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, dismissOnboarding, waitForAppReady } from "./support.mjs";

async function assertNoBlockingViolations(page, contextLabel) {
  const results = await new AxeBuilder({ page })
    .include("#workspace")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""));
  expect(blocking, `Accessibility violations on ${contextLabel}: ${blocking.map((entry) => `${entry.id} (${entry.impact})`).join(", ")}`).toEqual([]);
}

// Issue #279: a record page offers an action only when it can do something
// useful, and never renders an empty child inventory. Routes below are stable
// publisher keys; assertions describe behavior, not corpus counts.

async function openRecord(page, route) {
  attachPageDiagnostics(page);
  await page.goto(route);
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page.locator('[data-template="E"]')).toBeVisible();
}

async function openActionsMenu(page) {
  await page.locator(".record-actions-menu > summary").click();
  return page.locator(".record-actions-popover");
}

test("baseline headings name the baseline, not just the word Baseline", async ({ page }) => {
  await openRecord(page, "/#/record/nist-800-53b/HIGH");
  await expect(page.getByRole("heading", { name: "High Impact Baseline", level: 1 })).toBeVisible();
  await openRecord(page, "/#/record/fedramp-rev5/LOW");
  await expect(page.getByRole("heading", { name: "Low Baseline", level: 1 })).toBeVisible();
});

test("selection objects never render an empty Contained records section", async ({ page }) => {
  for (const route of [
    "/#/record/nist-800-53b/HIGH",
    "/#/record/fedramp-rev5/HIGH",
    "/#/record/fips-199/FIPS-199-HIGH",
    "/#/record/cmmc-2/LEVEL-1",
  ]) {
    await openRecord(page, route);
    await expect(page.locator('[data-record-section="child-inventory"]'), route).toHaveCount(0);
    await expect(page.locator("main"), route).not.toContainText("No directly contained records");
  }
});

test("a structural hub still lists what the publisher published beneath it", async ({ page }) => {
  await openRecord(page, "/#/record/csf-2/CATEGORY-PR.AA");
  const inventory = page.locator('[data-record-section="child-inventory"]');
  await expect(inventory).toBeVisible();
  await expect(inventory.getByRole("heading", { name: "Contained records", level: 2 })).toBeVisible();
  expect(await inventory.locator("li a").count()).toBeGreaterThan(0);
});

test("records with no mapping to compare do not offer Compare or Templates", async ({ page }) => {
  for (const route of [
    "/#/record/dod-zt/DOC-OVERLAYS",
    "/#/record/cmmc-2/LEVEL-1",
  ]) {
    await openRecord(page, route);
    const menu = await openActionsMenu(page);
    await expect(menu.getByRole("button", { name: "Copy link" }), route).toBeVisible();
    await expect(menu.getByRole("link", { name: "Compare frameworks" }), route).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "Choose a template" }), route).toHaveCount(0);
    await expect(page.locator(".record-template-sidebar").getByRole("link", { name: "Compare this record" }), route).toHaveCount(0);
    await expect(page.locator(".record-template-sidebar").getByRole("link", { name: "View in Atlas" }), route).toBeVisible();
  }
});

test("a record with no published mapping does not offer Compare, and templates stay on supported catalogs", async ({ page }) => {
  await openRecord(page, "/#/record/cui-policy/CATEGORY-ACCIDENT-INVESTIGATION");
  const menu = await openActionsMenu(page);
  await expect(menu.getByRole("link", { name: "Compare frameworks" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Choose a template" })).toHaveCount(0);
  await expect(page.locator(".record-template-sidebar").getByRole("link", { name: "Compare this record" })).toHaveCount(0);
});

test("a control with real mappings still offers Compare and a template handoff", async ({ page }) => {
  await openRecord(page, "/#/record/nist-800-53/AC-2");
  const menu = await openActionsMenu(page);
  await expect(menu.getByRole("link", { name: "Compare frameworks" })).toBeVisible();
  const template = menu.getByRole("link", { name: "Choose a template" });
  await expect(template).toBeVisible();
  await template.click();
  await expect(page).toHaveURL(/framework=nist-800-53/);
});

test("baselines, impact levels and program levels lead with what the publisher selected or requires", async ({ page }) => {
  const cases = [
    ["/#/record/nist-800-53b/HIGH", "Selected controls"],
    ["/#/record/fedramp-rev5/HIGH", "Selected controls"],
    ["/#/record/fips-199/FIPS-199-HIGH", "Selected baseline"],
    ["/#/record/cmmc-2/LEVEL-2", "Requirements"],
  ];
  for (const [route, heading] of cases) {
    await openRecord(page, route);
    const section = page.locator('[data-record-section="selection"]');
    await expect(section, route).toHaveCount(1);
    await expect(section.getByRole("heading", { name: heading, level: 2 }), route).toBeVisible();
    expect(await section.locator("li a").count(), route).toBeGreaterThan(0);
    // The same edges are not repeated as generic related links.
    await expect(page.locator('[data-record-section="related-records"] [data-record-connection-id]').filter({ hasText: /Selects/i }), route).toHaveCount(0);
  }
});

test("a selection section is never empty, and a level with nothing published shows none", async ({ page }) => {
  await openRecord(page, "/#/record/cmmc-2/LEVEL-1");
  const sections = page.locator('[data-record-section="selection"]');
  for (let index = 0; index < await sections.count(); index += 1) {
    expect(await sections.nth(index).locator("li a").count()).toBeGreaterThan(0);
  }
});

test("a long selection is capped with a way to see the rest in Atlas", async ({ page }) => {
  await openRecord(page, "/#/record/nist-800-53b/HIGH");
  const section = page.locator('[data-record-section="selection"]');
  expect(await section.locator("li a").count()).toBeLessThanOrEqual(25);
  await expect(section.getByRole("link", { name: /more — Explore in Atlas/ })).toBeVisible();
});

test("FedRAMP control context redirects to its control and reads parameters plainly there", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto("/#/record/fedramp-2026/CTL-AC-06-01");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page).toHaveURL(/#\/record\/nist-800-53\/AC-6\.1/);
  await expect(page.getByRole("heading", { name: "NIST AC-6.1", level: 1 })).toBeVisible();
  const context = page.locator('[data-record-section="fedramp-context"]');
  await expect(context.getByRole("heading", { name: "FedRAMP 2026 parameters and guidance", level: 2 })).toBeVisible();
  await expect(context.locator("li strong").first()).toHaveText(/^AC-6\.1 parameter \d$/);
  // The publisher's identifier stays available, but is not the lead.
  await expect(context.locator("li code").first()).toContainText("_odp");
  // It is not repeated as a generic related record.
  await expect(page.locator('[data-record-section="related-records"]')).not.toContainText("CTL-AC-06-01");
});

test("guidance-only control context keeps every paragraph once folded onto its control", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto("/#/record/fedramp-2026/CTL-AC-20");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page).toHaveURL(/#\/record\/nist-800-53\/AC-20/);
  const context = page.locator('[data-record-section="fedramp-context"]');
  await expect(context).toContainText("The interrelated controls of AC-20, CA-3, and SA-9 should be differentiated as follows");
  await expect(context).toContainText("SA-9 describes the responsibilities of external system owners");
});

// Issue #279 retirements: the graph keeps these records, but they are no longer
// public record pages. Old URLs must land somewhere useful, never on a 404.
/** @type {Array<[string, string, RegExp]>} */
const RETIRED_ROUTES = [
  ["catalog root", "/#/record/cmmc-2/CATALOG", /#\/library\/publication\/cmmc-2/],
  ["Atlas trunk", "/#/record/atlas/TRUNK", /#\/atlas\/atlas:TRUNK/],
  ["Atlas limb", "/#/record/atlas/LIMB-ARCHITECTURE", /#\/atlas\/atlas:LIMB-ARCHITECTURE/],
  ["regulation", "/#/record/authority/32-CFR-170", /#\/sources\?source=authority-32-cfr-170/],
  ["statute", "/#/record/authority/USC-40-11331", /#\/sources\?source=authority-usc-40-11331/],
  ["policy directive", "/#/record/authority/OMB-CIRCULAR-A-130", /#\/sources\?source=authority-omb-circular-a-130/],
  ["mapping workbook", "/#/record/nist-zt/MAPPING-DOCUMENT-NIST-SP-1800-35-CRITICAL-SOFTWARE-MAPPINGS-F3ED12702F", /#\/sources\?source=nist-sp-1800-35-critical-software-mappings/],
  ["control context", "/#/record/fedramp-2026/CTL-AC-06-01", /#\/record\/nist-800-53\/AC-6\.1/],
];

test("retired record URLs redirect to a real destination, never a not-found page", async ({ page }) => {
  for (const [name, route, destination] of RETIRED_ROUTES) {
    attachPageDiagnostics(page);
    await page.goto(route);
    await waitForAppReady(page, { allowPartial: true });
    await dismissOnboarding(page);
    await expect(page, name).toHaveURL(destination);
    await expect(page.getByRole("heading", { name: "Record not found" }), name).toHaveCount(0);
    await expect(page.locator('[data-record-retired="true"]'), name).toHaveCount(0);
    await expect(page.locator("main"), name).toBeVisible();
  }
});

test("a redirect replaces history, so Back does not return to the retired URL", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto("/#/library");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  const before = page.url();
  await page.evaluate(() => { globalThis.location.hash = "#/record/cmmc-2/CATALOG"; });
  await expect(page).toHaveURL(/#\/library\/publication\/cmmc-2/);
  await page.goBack();
  await expect(page).toHaveURL(before);
});

test("retired helper entities are out of Library search, and public product pages do not redirect", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto("/#/library?q=Appgate");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page.getByRole("link", { name: /Appgate Headless Client/ }).first()).toBeVisible();
  const hrefs = await page.locator("main a[href*='/record/']").evaluateAll((links) => links.map((link) => link.getAttribute("href") || ""));
  expect(hrefs.length).toBeGreaterThan(0);
  expect(hrefs.filter((href) => /COLLABORATOR-|MAPPING-CONTRIBUTOR-|MAPPING-DOCUMENT-/.test(href))).toEqual([]);

  const product = "/#/record/nist-zt/PRODUCT-COMPONENT-APPGATE-APPGATE-HEADLESS-CLIENT-RESOURCE-PROTECTION-CL-E65DEBF0E8";
  await page.goto(product);
  await waitForAppReady(page, { allowPartial: true });
  await expect(page).toHaveURL(/PRODUCT-COMPONENT-APPGATE/);
  await expect(page.locator('[data-template="E"]')).toBeVisible();
});

test("Atlas does not offer a full-record link for records that retire into Atlas", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto("/#/record/atlas/TRUNK");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page).toHaveURL(/#\/atlas\/atlas:TRUNK/);
  await expect(page.getByRole("heading", { name: "TRUNK" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /(Open|Read) the full record/ })).toHaveCount(0);

  // Positive control: a public record still offers it.
  await page.goto("/#/atlas/nist-800-53:AC-2");
  await waitForAppReady(page, { allowPartial: true });
  await expect(page.getByRole("link", { name: /(Open|Read) the full record/ }).first()).toBeVisible();
});

test("a publication's Browse all list and families leave out retired helper records", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto("/#/library/publication/nist-zt?browseAll=true");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page.getByRole("link", { name: /Product component/ }).first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Technology Collaborators");
  await expect(page.locator("main")).not.toContainText("Mapping Workbook Contributors");
  await expect(page.locator("main")).not.toContainText("Mapping Workbooks");
  await expect(page.getByRole("link", { name: /Technology collaborator|Mapping workbook contributor/ })).toHaveCount(0);
});

// Tier 2 polish (issue #279): identity, translation and fact-leak fixes found
// during the pair-specific review, verified on the built site.

test("a requirement with no genuine publisher code reads by its title, not a generated slug", async ({ page }) => {
  await openRecord(page, "/#/record/dod-rai/PRINCIPLE-ETHICS");
  await expect(page.getByRole("heading", { name: "DoW AI Ethical Principles", level: 1 })).toBeVisible();
  await expect(page.locator("h1")).not.toContainText("PRINCIPLE-ETHICS");
  await expect(page.locator("h1")).not.toContainText("Chief Digital and Artificial Intelligence Office");
});

test("Microsoft Zero Trust assessment categories show in English, never French", async ({ page }) => {
  await openRecord(page, "/#/record/microsoft-zt-maturity/MSZT-3-1");
  const facts = page.locator(".record-native-facts");
  await expect(facts.getByRole("heading", { name: "Published facts" })).toBeVisible();
  await expect(facts).toContainText("SSO and conditional access");
  await expect(page.locator("main")).not.toContainText("SSO et accès conditionnel");
});

test("a baseline sidebar does not show a Version or Benchmark date it never earned", async ({ page }) => {
  await openRecord(page, "/#/record/fedramp-rev5/HIGH");
  const about = page.locator("aside.record-template-sidebar");
  await expect(about).not.toContainText("Benchmark date");
  await expect(about).not.toContainText("Version");
  // The facts a baseline DOES earn stay.
  await expect(about).toContainText("Publication");
  await expect(about).toContainText("Status");
});

test("a real STIG benchmark still shows its publisher status date, formatted as a date", async ({ page }) => {
  await openRecord(page, "/#/record/disa-stig/BENCHMARK-A10-NETWORKS-ADC-ALG-STIG");
  const facts = page.locator(".record-native-facts");
  await expect(facts).toContainText("Published status date");
  await expect(facts).toContainText("Jun 4, 2024");
  await expect(facts).not.toContainText("2024-06-04");
});

test("a selection list item with no distinct title shows a snippet of its own text", async ({ page }) => {
  await openRecord(page, "/#/record/cmmc-2/LEVEL-2");
  const firstLink = page.locator('[data-record-section="selection"] li a').first();
  await expect(firstLink).toContainText("3.1.1");
  await expect(firstLink).toContainText("Limit system access");
});

// Issue #279: keyboard and axe coverage for the new record-page surfaces
// (selection sections, the control-context underlying-control link, the
// retirement redirect notice) — the existing accessibility.spec.mjs checks
// one generic record route but predates all of these.

test("selection-section and control-context record pages have no serious/critical axe violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of [
    "/#/record/nist-800-53b/HIGH",
    "/#/record/cmmc-2/LEVEL-2",
    "/#/record/fedramp-2026/CTL-AC-06-01",
    "/#/record/microsoft-zt-maturity/MSZT-3-1",
  ]) {
    await openRecord(page, route);
    await assertNoBlockingViolations(page, route);
  }
});

test("a retired record's redirect destination has no serious/critical axe violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  attachPageDiagnostics(page);
  await page.goto("/#/record/atlas/TRUNK");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page).toHaveURL(/#\/atlas\/atlas:TRUNK/);
  await assertNoBlockingViolations(page, "atlas trunk redirect target");
});

test("the selection section and the header actions menu are fully keyboard-operable", async ({ page }) => {
  await openRecord(page, "/#/record/nist-800-53b/HIGH");

  // Tab from the top of the page reaches the header actions menu, and Enter
  // opens it without a mouse.
  const menuSummary = page.locator(".record-actions-menu > summary");
  await menuSummary.focus();
  await expect(menuSummary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".record-actions-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".record-actions-popover")).toBeHidden();

  // The selection list's links are real, individually focusable anchors.
  const firstSelectionLink = page.locator('[data-record-section="selection"] li a').first();
  await firstSelectionLink.focus();
  await expect(firstSelectionLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/record\/nist-800-53\//);
});
