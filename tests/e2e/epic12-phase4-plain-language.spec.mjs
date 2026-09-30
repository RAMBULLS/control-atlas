import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

const SUPPORTED_ROUTES = [
  "/#/",
  "/#/explore",
  "/#/catalog",
  "/#/search?q=access+control",
  "/#/compare",
  "/#/learn",
  "/#/build",
  "/#/resources",
  "/#/sources",
  "/#/about",
];

const REPRESENTATIVE_RECORD = "/#/record/nist-800-53/AC-2";
const FRESHNESS_RECORD = "/#/record/fips-200/AC";

const BANNED_RENDERED_TEXT = [
  ["published graph", /published graph/i],
  ["published fact", /published fact/i],
  ["connected work surface", /connected work surface/i],
  ["publisher-declared structure", /publisher-declared structure/i],
  ["imported from", /imported from/i],
  ["surface as a UI noun", /\bsurface\b/i],
  ["masthead", /\bmasthead\b/i],
  ["landscape ready", /landscape ready/i],
  ["Federal utilized", /Federal utilized/i],
  ["Federal referenced", /Federal referenced/i],
  ["Map inclusion", /Map inclusion/i],
  ["Included in map", /Included in map/i],
  ["Excluded from map", /Excluded from map/i],
  ["Correlated through", /Correlated through/i],
  [
    "artifact as an ingested-file noun",
    /\b(?:feed\s*\/\s*artifact|ingestion artifacts?|ingested artifacts?|imported artifacts?|From:\s*[^.]{0,120}\bArtifact)\b/i,
  ],
];

const INTERNAL_IMPLEMENTATION_COPY = [
  ["graph parenting", /\b(?:graph parenting|not as parents?)\b/i],
  ["focus semantics", /\b(?:after focus|focus semantics)\b/i],
  ["ingestion state", /\b(?:ingestion|ingested)\b/i],
];

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function waitForRenderedRoute(page, route) {
  await waitForAppReady(page);
  const selector = route === "/#/"
    ? ".home-entry"
    : route.startsWith("/#/record/")
      ? ".detail-page"
      : '[data-route-primary-header="true"]';
  await expect(page.locator(selector)).toBeVisible({ timeout: 60_000 });
}

test("Phase 4 bans internal language across every supported route and a representative record", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const route of [...SUPPORTED_ROUTES, REPRESENTATIVE_RECORD]) {
    await test.step(route, async () => {
      await gotoApp(page, route);
      await waitForRenderedRoute(page, route);
      const text = await page.locator("#app").textContent();
      for (const [label, pattern] of [
        ...BANNED_RENDERED_TEXT,
        ...INTERNAL_IMPLEMENTATION_COPY,
      ]) {
        expect(text, `${route}: ${label}`).not.toMatch(pattern);
      }
    });
  }
});

test("Phase 4 keeps rendered filters useful, sorted, and consistently cased", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const route of SUPPORTED_ROUTES) {
    await gotoApp(page, route);
    await waitForRenderedRoute(page, route);

    const selects = await page.locator("select").evaluateAll((elements) =>
      elements.map((element) => {
        const select = /** @type {HTMLSelectElement} */ (element);
        return {
          label: select.closest("label")?.querySelector("span")?.textContent
            || select.getAttribute("aria-label")
            || select.id,
          meaningful: [...select.options]
            .filter((option) => option.value !== "" && !option.disabled)
            .map((option) => option.textContent || ""),
        };
      }),
    );
    for (const { label, meaningful } of selects) {
      expect(meaningful.length, `${route}: ${label}`).toBeGreaterThanOrEqual(2);
      const values = meaningful.map((value) => value.replace(/ \([\d,]+\)$/, "").trim());
      for (const value of values) {
        const firstLetter = value.match(/[A-Za-z]/)?.[0] || "";
        expect(firstLetter, `${route}: ${label}: ${value}`).toBe(firstLetter.toUpperCase());
      }
      if (label !== "Sort") {
        expect(values, `${route}: ${label}`).toEqual(
          [...values].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
        );
      }
    }
  }
});

test("Phase 4 places comparison limits with results and removes menu methodology copy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/compare");
  await waitForRenderedRoute(page, "/#/compare");

  const modes = page.getByRole("tablist", { name: "Comparison mode" }).getByRole("tab");
  await expect(modes).toHaveCount(2);
  await expect(modes).toHaveText(["Frameworks", "Specific item"]);
  await expect(page.locator(".compare-decision-boundary")).toHaveCount(0);

  await gotoApp(
    page,
    "/#/compare?intent=frameworks&crosswalk=relationships&source=nist-800-53&target=csf-2&mappingSource=nist-olir-csf2-to-sp800-53&compareRun=true",
  );
  await waitForRenderedRoute(page, "/#/compare");
  await expect(page.locator("#compare-results")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#compare-results .compare-decision-boundary")).toContainText(
    "does not by itself establish equivalence or compliance",
  );
});

test("Phase 4 renders each default record connection once with its meaning and source", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/record/nist-800-53/AC-2");
  await waitForRenderedRoute(page, "/#/record/nist-800-53/AC-2");

  const groups = page.locator(".record-connection-groups");
  const rows = groups.locator("[data-record-connection-id]");
  expect(await rows.count()).toBeGreaterThan(0);
  const ids = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-record-connection-id")),
  );
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  await expect(page.locator(".tree-relationship-classes")).toHaveCount(0);
  await expect(page.locator(".record-context-published")).toHaveCount(0);
  await expect(page.locator(".advanced-list + table")).toHaveCount(0);
  for (const row of await rows.all()) {
    await expect(row.locator(".relationship-meta")).not.toBeEmpty();
    await expect(row.locator(".relationship-citation")).not.toBeEmpty();
  }
});

test("Phase 4 keeps the product boundary contextual and reports freshness from verified data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/atlas");
  await waitForRenderedRoute(page, "/#/atlas");
  await expect(page.locator("main")).not.toContainText(
    "Control Atlas does not decide what applies to your system",
  );

  await gotoApp(page, FRESHNESS_RECORD);
  await waitForRenderedRoute(page, FRESHNESS_RECORD);
  const sourceSupport = page.locator(".record-template-sidebar");
  // Source freshness renders as a reading date, not the stored ISO value.
  await expect(sourceSupport).toContainText("Jun 13, 2026");
  await expect(sourceSupport).not.toContainText(/overdue|pipeline age/i);
  await expect(sourceSupport).toContainText("FIPS 200");
});
