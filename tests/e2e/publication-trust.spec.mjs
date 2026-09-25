import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

/* global document, window */

/**
 * Issue #284 browser acceptance: publication pages and the Sources trust
 * register. The corpus-wide contract is proven by the generated Publication
 * Acceptance Matrix (tests/graph/publicationAcceptance.test.ts); this spec
 * proves the representative set renders that contract, the same way, on every
 * surface, at every required width.
 */

const geography = JSON.parse(readFileSync("data/curated/atlas-territory-geography.json", "utf8"));
const registry = JSON.parse(readFileSync("data/source-registry.json", "utf8"));
const bootstrap = JSON.parse(readFileSync("data/generated/catalog-bootstrap.json", "utf8")).catalog_bootstrap;
const sourceById = new Map(registry.publications.map((source) => [source.id, source]));
const catalogById = new Map(bootstrap.catalogs.map((catalog) => [catalog.id, catalog]));

const REPRESENTATIVE = [
  "nist-800-53", "nist-800-53a", "nist-800-53b", "nist-800-37",
  "fips-199", "fips-200",
  "disa-stig", "disa-srg", "disa-cci",
  "cmmc-2", "cui-policy",
  "fedramp-2026", "fedramp-rev5",
  "dod-zt", "nist-zt",
  "mitre-attack", "mitre-attack-ics", "mitre-d3fend",
  // Sparse and niche publications.
  "dod-rai", "nist-mobile-threats", "microsoft-zt-maturity", "nist-iot-cybersecurity",
];
const POLICY = ["authority-usc-44-3554", "authority-32-cfr-170", "authority-dfars-252-204-7012", "authority-eo-13556", "authority-dodi-8500-01"];
const WIDTHS = [320, 375, 390, 768, 1024, 1440];
// Operational vocabulary that must never reach the public trust story.
const LEAK = /workflow run|github actions|git branch|validator|quarantin|refresh task|job id|\bERR_[A-Z]/i;

async function open(page, path, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await gotoApp(page, path);
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
}

function expected(catalogId) {
  const catalog = catalogById.get(catalogId);
  const source = sourceById.get(catalog.source_id);
  return { alias: geography.presentation[catalogId].alias, official: source.name, sourceId: source.id };
}

async function heroFacts(page) {
  const facts = page.locator(".catalog-trust-facts");
  const read = async (label) => (await facts.locator("div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd").innerText()).trim();
  return { version: await read("Version"), status: await read("Status"), freshness: await read("Source freshness") };
}

test.beforeEach(async ({ page }) => attachPageDiagnostics(page));

for (const catalogId of REPRESENTATIVE) {
  test(`publication page answers the contract without a click: ${catalogId}`, async ({ page }) => {
    const { alias, official, sourceId } = expected(catalogId);
    await open(page, `/#/library/publication/${catalogId}`);
    const hero = page.locator(`[data-publication-identity="${catalogId}"]`);

    // Identity: practitioner name, exact official title beside it, publisher.
    await expect(hero.getByRole("heading", { level: 1 })).toHaveText(alias);
    if (alias !== official) await expect(hero.locator(".catalog-official-title")).toHaveText(`Official title ${official}`);
    else await expect(hero.locator(".catalog-official-title")).toHaveCount(0);
    await expect(hero.locator(".catalog-publisher")).toContainText(/^Published by .+/);

    // Version, status, freshness and what Control Atlas holds are in view, not behind a disclosure.
    const facts = hero.locator(".catalog-trust-facts");
    await expect(facts).toBeVisible();
    for (const label of ["Version", "Status", "Source freshness", "In Control Atlas"]) {
      await expect(facts.locator("dt", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
    expect(await facts.evaluate((node) => Boolean(node.closest("details:not([open])")))).toBe(false);
    // Freshness says which claim it is: a check, or only a retrieval.
    await expect(facts.locator("[data-freshness]")).toHaveText(/^(Checked \w{3} \d{1,2}, \d{4}|Retrieved \w{3} \d{1,2}, \d{4} · no check recorded)$/);
    // Status is written out; colour is never the only signal.
    await expect(facts.locator("[data-lifecycle]")).toHaveText(/^(Active|Historical|Draft|Superseded|Not recorded)$/);

    // What it is and what Control Atlas indexes.
    await expect(page.locator(".catalog-about")).toContainText("What Control Atlas indexes");
    await expect(page.locator(".catalog-about")).toContainText("Edition and freshness");

    // Primary next actions.
    await expect(hero.getByRole("button", { name: /^Browse [\d,]+ / })).toBeVisible();
    await expect(hero.getByRole("link", { name: /^(Open|Download) official publication.* for .+ \(opens in a new tab\)$/ })).toBeVisible();
    await expect(hero.getByRole("link", { name: "See it on the Atlas" })).toBeVisible();
    await expect(hero.getByRole("link", { name: "Source details", exact: true })).toHaveAttribute("href", new RegExp(`source=${sourceId}`));

    // Identity comes before the record inventory.
    const heroBox = await hero.boundingBox();
    const recordsBox = await page.locator(".catalog-records").boundingBox();
    expect(heroBox.y).toBeLessThan(recordsBox.y);
    for (const part of await page.locator(".catalog-detail-hero, .catalog-about").all()) await expect(part).not.toContainText(LEAK);

    // Same identity and trust facts on the Sources register.
    const facts1440 = await heroFacts(page);
    const publisher = (await hero.locator(".catalog-publisher").innerText()).replace(/^Published by\s+/i, "").trim();
    await open(page, `/#/sources?source=${sourceId}`);
    const inspector = page.locator(".sources-inspector-pane .source-inspector--inline");
    await expect(inspector.getByRole("heading", { level: 2 })).toHaveText(alias);
    if (alias !== official) await expect(inspector.locator("[data-official-title]")).toContainText(official);
    await expect(inspector.locator(".source-inspector-publisher")).toContainText(publisher);
    const summary = inspector.getByRole("region", { name: "Source status summary" });
    await expect(summary.locator("[data-version-state]")).toContainText(facts1440.version);
    await expect(summary.locator("[data-lifecycle]")).toHaveText(facts1440.status);
    await expect(summary.locator("[data-freshness]")).toHaveText(facts1440.freshness);
    await expect(inspector).not.toContainText(LEAK);
    await expect(inspector.getByRole("link", { name: "Open the publication page" })).toHaveAttribute("href", new RegExp(`publication/${catalogId}`));
  });
}

test("Atlas, the Library and the publication page show one identity for DISA STIG", async ({ page }) => {
  await open(page, "/#/atlas?atlasFramework=disa-stig");
  const card = page.locator(".atl-inspector .atl-card");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("DISA STIG");
  await expect(card).toContainText("DISA Public STIG Library");
  await expect(card).toContainText("DISA · Implementation standard");

  await open(page, "/#/library");
  const row = page.locator('[data-publication-card="disa-stig"]');
  await expect(row.locator("strong")).toHaveText("DISA STIG");
  await expect(row).toContainText("DISA Public STIG Library");
  await expect(row.locator("span")).toHaveText("DISA");

  await open(page, "/#/library/publication/disa-stig");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("DISA STIG");
  await expect(page.locator(".catalog-publisher")).toContainText("(DISA)");
});

test("historical and superseded editions are stated, never inferred", async ({ page }) => {
  await open(page, "/#/library/publication/fedramp-rev5");
  await expect(page.locator(".catalog-trust-facts [data-lifecycle]")).toHaveText("Historical");
  await expect(page.locator(".catalog-about")).toContainText("Use the Consolidated Rules for 2026");

  // 800-171 Rev. 2 is active in the register; the recorded source review says the publisher superseded it.
  await open(page, "/#/library/publication/nist-800-171-rev2");
  await expect(page.locator(".catalog-trust-facts [data-lifecycle]")).toHaveText("Active");
  await expect(page.locator('[data-limitation="superseded_upstream"]')).toContainText("recorded that the publisher has superseded this edition");

  // A retrieval date is not presented as the publisher's version.
  await open(page, "/#/library/publication/cmmc-2");
  await expect(page.locator(".catalog-trust-facts [data-version-state]")).toHaveText("Not stated by the publisher");
  await expect(page.locator('[data-limitation="retrieval_dated_version"]')).toBeVisible();
});

test("Compare, templates and journeys appear only where governed data supports them", async ({ page }) => {
  await open(page, "/#/library/publication/disa-stig");
  const next = page.locator(".catalog-about").getByRole("region", { name: "Work with it" });
  await expect(next.getByRole("link", { name: "Compare with DISA CCI" })).toHaveAttribute("href", /compare\/relationships\?.*source=disa-stig.*target=disa-cci/);
  await expect(next.getByRole("link", { name: "Evidence Expectation Matrix" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recorded policy basis" }).getByRole("link", { name: "DoDI 8500.01" })).toBeVisible();

  // A publication with no published crosswalk, journey or citing template offers none.
  await open(page, "/#/library/publication/nist-ai-rmf");
  await expect(page.getByRole("region", { name: "Work with it" })).toHaveCount(0);
  // Its authority record states no basis document, only the recorded note.
  const basis = page.getByRole("region", { name: "Recorded policy basis" });
  await expect(basis.getByRole("link")).toHaveCount(0);
  await expect(basis).toContainText("voluntary resources");
});

test("Policy & directives is a first-class Sources view with recorded basis only", async ({ page }) => {
  await open(page, "/#/sources");
  await page.getByRole("button", { name: /^Policy & directives/ }).click();
  await expect(page).toHaveURL(/layer=policy/);
  const table = page.getByRole("table", { name: "Policy and directives register" });
  await expect(table.getByRole("columnheader")).toHaveText(["Document", "Issued by", "Version / current through", "Source freshness", "Status"]);
  for (const id of POLICY) await expect(page.locator(`#source-trigger-${id}`)).toBeVisible();
  await expect(page.locator(".source-register-boundary")).toContainText("does not state legal precedence");

  await page.locator("#source-trigger-authority-dodi-8500-01").click();
  const inspector = page.locator(".sources-inspector-pane .source-inspector--inline");
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("DoDI 8500.01");
  await expect(inspector.locator("[data-official-title]")).toContainText("DoD Instruction 8500.01, Cybersecurity");
  await expect(inspector).toContainText("Issued by Department of Defense");
  await expect(inspector.getByRole("link", { name: /^Read the official text/ })).toBeVisible();
  const basis = inspector.getByRole("region", { name: "Recorded as the basis for" });
  await expect(basis.getByRole("link")).toHaveText(["DISA CCI", "DISA SRG", "DISA STIG"]);
  await expect(basis).toContainText("It does not state legal precedence or whether it applies to you.");
  await expect(inspector).not.toContainText(LEAK);

  // A policy document with no recorded basis relationship claims none.
  await open(page, "/#/sources?layer=policy&source=authority-dodi-8510-01");
  await expect(page.locator(".sources-inspector-pane .source-inspector--inline").getByRole("region", { name: "Recorded as the basis for" })).toHaveCount(0);
});

for (const width of WIDTHS) {
  test(`publication and Sources layouts hold at ${width}px`, async ({ page }) => {
    for (const catalogId of ["disa-stig", "fips-199"]) {
      await open(page, `/#/library/publication/${catalogId}`, width);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".catalog-records")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), catalogId).toBeLessThanOrEqual(1);
      // Heading levels never skip on the way down.
      const levels = await page.locator("#workspace").locator("h1, h2, h3, h4").evaluateAll((nodes) => nodes.map((node) => Number(node.tagName[1])));
      expect(levels[0]).toBe(1);
      for (let index = 1; index < levels.length; index += 1) expect(levels[index] - levels[index - 1], `${catalogId} heading order`).toBeLessThanOrEqual(1);
      for (const action of await page.locator(".catalog-source-actions a, .catalog-source-actions button").all()) {
        expect((await action.boundingBox()).height, catalogId).toBeGreaterThanOrEqual(44);
      }
      const hero = await page.locator(".catalog-detail-hero").boundingBox();
      const records = await page.locator(".catalog-records").boundingBox();
      expect(hero.y).toBeLessThan(records.y);
    }

    await open(page, "/#/sources", width);
    const trigger = page.locator("#source-trigger-disa-stig-library");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const compact = width < 1200;
    const inspector = compact ? page.getByRole("dialog") : page.locator(".sources-inspector-pane .source-inspector--inline");
    await expect(inspector).toBeVisible();
    // The trust story comes before the file inventory, and a long inventory starts collapsed.
    const summary = await inspector.getByRole("region", { name: "Source status summary" }).boundingBox();
    const files = inspector.locator("details.source-inspector-section").filter({ hasText: /^Source files/ });
    expect(summary.y).toBeLessThan((await files.boundingBox()).y);
    await expect(files).not.toHaveAttribute("open", "");
    expect((await inspector.getByRole("link", { name: /official publication/ }).boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    if (compact) {
      await expect(inspector.getByRole("button", { name: "Close inspector" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } else {
      await inspector.getByRole("button", { name: "Close publication details" }).click();
      await expect(trigger).toBeFocused();
    }
  });
}

for (const [label, path] of [
  ["publication page", "/#/library/publication/disa-stig"],
  ["sparse publication page", "/#/library/publication/fips-199"],
  ["Sources policy view", "/#/sources?layer=policy&source=authority-dodi-8500-01"],
]) {
  test(`${label} has no serious or critical WCAG violations`, async ({ page }) => {
    await open(page, path);
    const results = await new AxeBuilder({ page }).include("#workspace").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""))).toEqual([]);
  });
}
