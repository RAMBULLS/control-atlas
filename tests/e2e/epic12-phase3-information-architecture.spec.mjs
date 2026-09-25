import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, gotoApp, waitForAppReady } from "./support.mjs";

const NAV = [
  { label: "Start here", path: "/start", placement: "primary" },
  { label: "Atlas", path: "/atlas", placement: "primary" },
  { label: "Library", path: "/library", placement: "primary" },
  { label: "Compare", path: "/compare", placement: "primary" },
  { label: "Resources", path: "/resources", placement: "primary" },
  { label: "Templates", path: "/build", placement: "primary" },
  { label: "Guides", path: "/guides", placement: "overflow" },
  { label: "Sources", path: "/sources", placement: "overflow" },
  { label: "About", path: "/about", placement: "overflow" },
];

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("header exposes task destinations directly from 1200px", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [1200, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, "/#/library?q=access+control");
    await waitForAppReady(page, { allowPartial: true });

    const primary = page.locator('header.site-header nav[aria-label="Primary navigation"]');
    await expect(primary.locator("a[href]")).toHaveCount(6);
    await expect(primary.locator("a[href]")).toHaveText(["Start here", "Atlas", "Library", "Compare", "Resources", "Templates"]);
    await expect(page.locator('header.site-header nav[aria-label="Utility navigation"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Open more pages" }).click();
    await expect(page.getByRole("navigation", { name: "More pages" }).getByRole("link")).toHaveText([
      "Guides",
      "Sources",
      "About",
    ]);
    await page.keyboard.press("Escape");
    const geometry = await page.locator("header.site-header").evaluate((header) => ({
      clientWidth: header.clientWidth,
      fontSizes: [...header.querySelectorAll('nav[aria-label="Primary navigation"] a[href]')].map((link) => globalThis.getComputedStyle(link).fontSize),
      scrollWidth: header.scrollWidth,
    }));
    expect(new Set(geometry.fontSizes).size).toBe(1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/about");
  await waitForAppReady(page, { allowPartial: true });
  await expect(page.locator(".route-transition")).toBeHidden();
  for (const destination of NAV) {
    if (destination.placement === "overflow") {
      await page.getByRole("button", { name: "Open more pages" }).click();
      await page.getByRole("navigation", { name: "More pages" })
        .getByRole("link", { name: destination.label, exact: true })
        .click();
    } else {
      await page.getByRole("navigation", { name: "Primary navigation" })
        .getByRole("link", { name: destination.label, exact: true })
        .click();
    }
    await expect(page).toHaveURL(new RegExp(`#${destination.path}$`));
    if (destination.placement === "overflow") {
      await page.getByRole("button", { name: "Open more pages" }).click();
      await expect(page.getByRole("navigation", { name: "More pages" })
        .getByRole("link", { name: destination.label, exact: true }))
        .toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      await expect(page.getByRole("navigation", { name: "Primary navigation" })
        .getByRole("link", { name: destination.label, exact: true }))
        .toHaveAttribute("aria-current", "page");
    }
  }
});

test("Phase 3 Library searches published records while Resources stays first-class", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/library?q=NIST");
  await waitForAppReady(page, { allowPartial: true });
  while (await page.getByRole("button", { name: "Show 25 more" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Show 25 more" }).click();
  }
  await expect(page.locator('[data-result-class="published-record"]').first()).toBeVisible();
  await expect(page.locator('[data-result-class="resource"]')).toHaveCount(0);
  await expect(page.locator('[data-result-class="source"]')).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Filter results by ID, title, or topic" })).toHaveValue("NIST");

  await gotoApp(page, "/#/catalog");
  await expect(page).toHaveURL(/#\/library$/);
  await gotoApp(page, "/#/resources");
  await expect(page).toHaveURL(/#\/resources$/);
  await expect(page.locator('[data-browse-state="resources"]')).toBeVisible();
  await gotoApp(page, "/#/resources/official-nist-oscal");
  await expect(page).toHaveURL(/#\/resources\/official-nist-oscal$/);
});

test("Phase 3 filters stay stable, bounded, and free of hierarchy node types", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const renderedSets = [];
  for (const query of ["access control", "Platform One"]) {
    await gotoApp(page, `/#/library?q=${encodeURIComponent(query)}`);
    await waitForAppReady(page);
    const rail = page.locator('[data-react-root] .workspace-facet-rail');
    await expect(rail).toBeVisible();
    const facetControls = rail.locator('.workspace-facet-controls[data-facet-set="publication,kind,area,asset_class,domain,vendor_brand,program"]');
    const primaryFacets = facetControls.locator(
      ":scope > .workspace-typeahead > span, :scope > .workspace-checkbox-facet > summary > .workspace-facet-group__label",
    );
    renderedSets.push(await primaryFacets.allTextContents());
    await expect(primaryFacets).toHaveText(["Publication", "Content kind", "Area"]);
    const advanced = facetControls.locator('details[data-advanced-facet-set="publisher,technology,product,framework,organization,environment,connections"]');
    if (!(await advanced.evaluate((element) => element instanceof globalThis.HTMLDetailsElement && element.open))) {
      await advanced.locator("summary").click();
    }
    await expect(advanced.getByText("Publisher", { exact: true })).toBeVisible();
    await expect(advanced.getByText("Has published connections", { exact: true })).toBeVisible();
    await expect(advanced).not.toContainText("No governed tags are available in this context.");
    const datalistSizes = await rail.locator("datalist").evaluateAll((lists) => lists.map((list) => list.querySelectorAll("option").length));
    expect(datalistSizes.every((size) => size >= 2), datalistSizes.join(",")).toBe(true);
    await expect(rail).not.toContainText(/\b(?:Limb|Trunk|Group)\b/);
  }
  expect(renderedSets[1]).toEqual(renderedSets[0]);
  // Facet groups are collapsed until asked for, so the options are out of the
  // accessibility tree until the group is opened. Opening it here also proves
  // the disclosure works.
  const kindGroup = page
    .locator(".workspace-facet-rail .workspace-checkbox-facet")
    .filter({ has: page.locator("summary", { hasText: "Content kind" }) })
    .first();
  await expect(kindGroup).toHaveJSProperty("open", false);
  await kindGroup.locator("summary").click();
  await expect(kindGroup).toHaveJSProperty("open", true);
  const kindLabels = await page.getByRole("group", { name: "Content kind" }).locator("label > span").allTextContents();
  expect(kindLabels.sort()).toEqual([
    "Baselines & profiles",
    "Process & methods",
    "Requirements",
    "Technical rules",
    "Threats & defenses",
  ]);
});

test("Phase 3 record identity is canonical across Library, Atlas, and direct paths", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const breadcrumb = page.locator("[data-canonical-breadcrumb]");

  await gotoApp(page, "/#/record/nist-800-53/AC-2");
  await waitForAppReady(page, { allowPartial: true });
  await expect(breadcrumb).toHaveAttribute("data-canonical-breadcrumb", /\S/);
  const canonicalBreadcrumb = await breadcrumb.getAttribute("data-canonical-breadcrumb");
  expect(canonicalBreadcrumb).toBeTruthy();

  await gotoApp(page, "/#/library?q=AC-2");
  await waitForAppReady(page, { allowPartial: true });
  await page.locator('[data-record-id="nist-800-53:AC-2"] .workspace-result-row__link').click();
  await waitForAppReady(page, { allowPartial: true });
  await expect(breadcrumb).toHaveAttribute("data-canonical-breadcrumb", canonicalBreadcrumb);
  await expect(page.locator('header.site-header nav a[aria-current="page"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See connections", exact: true })).toBeVisible();

  await gotoApp(page, "/#/atlas?node=nist-800-53%3AAC-2&relationshipView=map");
  await waitForAppReady(page, { allowPartial: true });
  await expect(page).toHaveURL(/#\/atlas\/nist-800-53:AC-2$/);
  const focusedRecord = page.locator(".atl-inspector");
  await expect(focusedRecord.getByRole("heading", { name: "AC-2" })).toBeVisible({ timeout: 20000 });
  await expect(focusedRecord).toContainText("Account Management");
  const atlasPath = page.getByRole("navigation", { name: "Where you are" });
  await expect(atlasPath).toContainText("Compliance");
  await expect(atlasPath).toContainText("SP 800-53 Rev. 5");
  await expect(atlasPath).toContainText("AC-2");
  await expect(page.locator('header.site-header nav[aria-label="Primary navigation"] a[aria-current="page"]')).toHaveText("Atlas");

  await gotoApp(page, "/#/record/nist-800-53/AC-2?from=search&returnTo=%2Flibrary");
  await waitForAppReady(page, { allowPartial: true });
  await expect(page).toHaveURL(/#\/record\/nist-800-53\/AC-2$/);
  await expect(breadcrumb).toHaveAttribute("data-canonical-breadcrumb", canonicalBreadcrumb);
});

test("Phase 3 List and Map preserve Library state and never drop non-empty results", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/library?q=access+control&kind=requirements&sort=identifier");
  await waitForAppReady(page);
  await expect(page.locator(".route-transition")).toBeHidden();
  await expect(page.getByRole("group", { name: "Library view" })).toBeVisible();
  const resultCount = Number((await page.locator(".workspace-result-count").textContent())?.match(/\d+/)?.[0] || 0);
  expect(resultCount).toBeGreaterThan(0);
  const mapButton = page.getByRole("button", { name: "Map", exact: true });
  await page.evaluate(() => globalThis.scrollTo(0, 320));
  const before = await page.evaluate(() => globalThis.scrollY);
  await mapButton.dispatchEvent("click");
  await expect(page).toHaveURL(/#\/library\?q=access%20control&kind=requirements&sort=identifier&view=map|#\/library\?q=access\+control&kind=requirements&sort=identifier&view=map/);
  await expect(page.locator(".library-atlas-map")).toHaveAttribute("data-map-node-count", String(Math.min(resultCount, 75)));
  expect(await page.locator(".library-map-node").count()).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeGreaterThanOrEqual(Math.max(0, before - 2));
  await page.getByRole("button", { name: "List", exact: true }).dispatchEvent("click");
  await expect(page).toHaveURL(/#\/library\?q=access%20control&kind=requirements&sort=identifier$|#\/library\?q=access\+control&kind=requirements&sort=identifier$/);
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeGreaterThanOrEqual(Math.max(0, before - 2));
  await page.getByRole("button", { name: "Map", exact: true }).dispatchEvent("click");
  await expect(page.locator(".library-atlas-map")).toHaveAttribute("data-map-node-count", String(Math.min(resultCount, 75)));
  await page.getByRole("link", { name: /Open Atlas map overview/ }).click();
  await expect(page).toHaveURL(/#\/atlas$/);
  await waitForAppReady(page);
  await expect(page.locator(".route-transition")).toBeHidden();

  await gotoApp(page, "/#/library?q=zzzzqqqq-no-results");
  await waitForAppReady(page);
  await expect(page.locator(".route-transition")).toBeHidden();
  await expect(page.getByRole("group", { name: "Library view" })).toBeVisible();
});

test("Template B leads with guided setup and retires the legacy work-map card", async ({ page }) => {
  await gotoApp(page, "/#/");
  await waitForAppReady(page, { allowPartial: true });
  const homeTaxonomy = await page.locator(".home-secondary-action strong").allTextContents();
  expect(homeTaxonomy).toEqual(["Start guided setup", "Search the Library", "Browse Resources"]);
  await expect(page.locator(".home-work-map span")).toHaveCount(0);
  await expect(page.getByText("Start with your work", { exact: true })).toHaveCount(0);
});

test("DISA STIG publication entry points preserve the benchmark layer above V-IDs", async ({ page }) => {
  await gotoApp(page, "/#/library");
  await waitForAppReady(page, { allowPartial: true });
  await page.getByRole("button", { name: /DISA STIG/ }).click();
  await expect(page).toHaveURL(/#\/library\/publication\/disa-stig$/);
  await waitForAppReady(page);
  const publication = page.locator(".catalog-detail-page");
  await expect(publication).toBeVisible();
  await expect(publication).not.toHaveClass(/\bpanel\b/);
  await expect(publication.locator(".catalog-detail-hero .eyebrow")).toHaveText("Publication · Implementation standard");
  await expect(publication.getByRole("heading", { name: "DISA STIG", level: 1 })).toBeVisible();
  await expect(publication.locator(".catalog-official-title")).toHaveText("Official title DISA Public STIG Library");
  await expect(publication.locator(".catalog-publisher")).toHaveText("Published by Defense Information Systems Agency (DISA)");
  await expect(publication.getByRole("link", { name: /^Open official publication for DISA Public STIG Library/ })).toBeVisible();
  const benchmarks = page.locator('[data-published-tier="benchmark"]');
  const benchmarkCount = await benchmarks.count();
  expect(benchmarkCount).toBeGreaterThan(0);
  await expect(page.getByText(`${benchmarkCount} benchmarks`, { exact: true })).toBeVisible();
  await expect(page.locator(".catalog-record-title")).toHaveCount(0);
  const benchmarkSearch = publication.getByRole("searchbox", { name: "Search DISA STIG benchmarks" });
  await expect(benchmarkSearch).toBeVisible();
  await benchmarkSearch.fill("zzzz-no-benchmark");
  await publication.getByRole("button", { name: "Search benchmarks", exact: true }).click();
  await expect(publication.getByRole("button", { name: "Clear benchmark search", exact: true })).toBeVisible();
  await publication.getByRole("button", { name: "Clear benchmark search", exact: true }).click();

  await gotoApp(page, "/#/library/publication/disa-stig?browseAll=true");
  await waitForAppReady(page, { allowPartial: true });
  await expect(benchmarks).toHaveCount(benchmarkCount);
  await expect(page.locator(".catalog-record-title")).toHaveCount(0);

  const benchmark = page.locator('[data-published-tier="benchmark"]', {
    hasText: "VMware vSphere 7.0 vCenter Appliance PostgreSQL",
  });
  await benchmark.click();
  await expect(page).toHaveURL(/family=VMware(?:%20|\+)vSphere(?:%20|\+)7\.0/);
  await expect(page.getByRole("combobox", { name: "Filter by benchmark" })).toBeVisible();
  await expect(page.getByText("Published group", { exact: true })).toHaveCount(0);
  const rules = page.locator(".catalog-record-title");
  await expect(rules.first()).toBeVisible({ timeout: 60_000 });
  expect(await rules.count()).toBeGreaterThan(0);
  await expect(rules.first().locator("strong")).toHaveText(/^V-\d+$/);
});

test("Phase 3 record actions and global footer expose the required hierarchy", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { globalThis.__copiedRecordUrl = value; } },
    });
  });
  await gotoApp(page, "/#/record/nist-800-53/AC-2");
  await waitForAppReady(page, { allowPartial: true });
  const actions = page.locator(".record-title-actions");
  await expect(actions.getByRole("link", { name: "View official source", exact: true })).toBeVisible();
  await actions.locator("summary", { hasText: "More actions" }).click();
  await expect(actions.getByRole("link", { name: "See connections", exact: true })).toBeVisible();
  await actions.getByRole("button", { name: "Copy link", exact: true }).click();
  const copied = await page.evaluate(() => globalThis.__copiedRecordUrl);
  expect(copied.replace(/^http:/, "https:")).toMatch(/^https:\/\/[^?]+#\/record\/[^?]+$/);

  for (const route of [
    "/#/",
    "/#/start",
    "/#/library",
    "/#/guides",
    "/#/atlas",
    "/#/sources",
    "/#/about",
    "/#/record/nist-800-53/AC-2",
    "/#/compare",
    "/#/build",
    "/#/library/publication/nist-800-53",
    "/#/library/resource/official-nist-oscal",
    "/#/retired?q=800-53",
    "/#/not-found",
  ]) {
    await gotoApp(page, route);
    await waitForAppReady(page, { allowPartial: true });
    const footer = page.locator("footer.site-footer");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText("Free and open source. Not a government system.");
    await expect(footer).toContainText("Product release");
    await expect(footer).toContainText("Source data built");
    await expect(footer.getByRole("link", { name: "Submit resource" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Report a problem" })).toBeVisible();
  }
});

test("Phase 3 Atlas shows honest integer counts and no obsolete work-surface label", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/atlas");
  await waitForAppReady(page);
  await expect(page.locator(".terr")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Connected work surface");
  // Counts are whole numbers stated in the publisher's own words, never estimates.
  await expect(page.getByRole("button", { name: "Policy & directives" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Other publications · \d+$/ })).toBeVisible();
  await page.locator('[data-landmark="nist-800-53"]').click();
  await expect(page.locator(".atl-inspector")).toContainText(/\d[\d,]* other publications? share published connections/);
  await expect(page.locator(".atl-inspector")).toContainText(/Records\s*1,196/);
});