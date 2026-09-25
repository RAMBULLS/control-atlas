import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("WS5 Home implements Template B with one search, four destinations, and Library discovery", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, "/");
  await waitForAppReady(page, { allowPartial: true });

  const template = page.locator('[data-template="B"]');
  await expect(template).toBeVisible();
  await expect(template.locator(".home-hero")).toHaveCount(1);
  await expect(template.locator(".home-search")).toHaveCount(1);
  await expect(template.locator(".home-secondary-action")).toHaveCount(4);
  await expect(template.locator(".home-secondary-action strong")).toHaveText([
    "Start guided setup",
    "Browse the Atlas",
    "Search the Library",
    "Browse Resources",
  ]);
  await expect(template.getByRole("heading", { name: "Make federal cybersecurity make sense.", level: 1 })).toBeVisible();
  await expect(template.getByText("Understand what applies, what it means, and what to do next.", { exact: true })).toBeVisible();
  await expect(template.getByText(/publisher|provenance|mapping/i)).toHaveCount(0);
  await expect(template.locator(".home-ecosystem, .home-primary-actions")).toHaveCount(0);
  await expect(template.getByText("Start with your work", { exact: true })).toHaveCount(0);

  const libraryDiscovery = template.getByRole("navigation", { name: "Start with what you came to find." });
  const discoveryLinks = libraryDiscovery.locator(".home-library-kpi");
  await expect(template.getByText("BROWSE THE LIBRARY", { exact: true })).toBeVisible();
  await expect(discoveryLinks).toHaveCount(5);
  // The practitioner question leads and the collection name is the headline;
  // the record count is footer metadata, never the reason to look.
  await expect(discoveryLinks.locator(".home-library-kpi__question")).toHaveText([
    "What you have to do",
    "What applies to your system",
    "How it gets checked",
    "How systems get hardened",
    "What it defends against",
  ]);
  await expect(discoveryLinks.locator(".home-library-kpi__label")).toHaveText([
    "Controls & requirements",
    "Baselines & profiles",
    "Assessment & process",
    "Configuration rules",
    "Threats & defenses",
  ]);
  const discoveryCounts = await discoveryLinks.locator(".home-library-kpi__count").allTextContents();
  expect(discoveryCounts).toHaveLength(5);
  expect(discoveryCounts.every((count) => /^\d[\d,]* records$/.test(count))).toBe(true);
  await expect(libraryDiscovery.getByRole("link", { name: "Browse everything" })).toBeVisible();
  await expect(template.getByText(/more records|bigger tag/i)).toHaveCount(0);
  await expect(template.locator("[data-tag-count-scale]")).toHaveCount(0);
  await expect(template.locator(".home-area-browse, .home-ecosystem-areas, .home-area-link")).toHaveCount(0);
  // One taxonomy only: every card filters by record kind, never by tag.
  expect(await discoveryLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual([
    "#/library?kind=requirements",
    "#/library?kind=baselines-profiles",
    "#/library?kind=process-methods",
    "#/library?kind=technical-rules",
    "#/library?kind=threats-defenses",
  ]);

  const accentColors = await template.locator(".home-secondary-action").evaluateAll((cards) => (
    cards.map((card) => globalThis.getComputedStyle(card, "::before").backgroundColor)
  ));
  expect(new Set(accentColors).size).toBe(1);
});

test("WS5 Library discovery cards open the counted canonical filter states", async ({ page }) => {
  // Five full app loads and five Library data loads in one test. That fits the
  // 30s default alone but not beside three other workers, and the filter chip
  // is the first thing rendered after the Library's own data lands — so the
  // assertion below was racing that load on a 5s default rather than testing
  // the product.
  test.setTimeout(120_000);
  const discoveries = [
    ["Controls & requirements", "Requirements"],
    ["Baselines & profiles", "Baselines & profiles"],
    ["Assessment & process", "Process & methods"],
    ["Configuration rules", "Technical rules"],
    ["Threats & defenses", "Threats & defenses"],
  ];

  for (const [label, filterLabel] of discoveries) {
    await gotoApp(page, "/");
    await waitForAppReady(page, { allowPartial: true });
    const discovery = page.locator(".home-library-kpi").filter({ hasText: label });
    const count = (await discovery.locator(".home-library-kpi__count").innerText()).replace(/\s+records$/i, "");
    expect(count).toMatch(/^\d[\d,]*$/);
    await discovery.click();

    await expect(page).toHaveURL(/#\/library\?kind=/);
    await expect(
      page.getByLabel("Active filters").getByRole("button", { name: filterLabel }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("status")).toContainText(count);
    await expect(page.getByRole("list", { name: "Search results" }).getByRole("listitem").first()).toBeVisible();
  }
});

test("WS5 Library discovery remains bounded and usable at all supported widths", async ({ page }) => {
  test.setTimeout(90_000);
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await gotoApp(page, "/");
    await waitForAppReady(page, { allowPartial: true });

    const navigation = page.getByRole("navigation", { name: "Start with what you came to find." });
    await expect(navigation.locator(".home-library-kpi")).toHaveCount(5);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth),
      `${width}px Home overflow`,
    ).toBeLessThanOrEqual(1);
    const targets = await navigation.locator(".home-library-kpi").evaluateAll((links) => links.map((link) => {
      const box = link.getBoundingClientRect();
      return { height: box.height, width: box.width };
    }));
    expect(targets.every((target) => target.height >= 44 && target.width >= 44), `${width}px discovery targets`).toBe(true);
  }
});

test("WS6 About is a five-section knowledge-base article with the exact research boundary", async ({ page }) => {
  await gotoApp(page, "/#/about");
  await waitForAppReady(page);
  const article = page.getByRole("article");
  await expect(page.locator('[data-page-template="knowledge-base"]')).toBeVisible();
  await expect(page.locator(".about-card-grid, .summary-card")).toHaveCount(0);
  await expect(page.locator("main").getByText(
    "Control Atlas is a public research tool for federal cybersecurity requirements, controls, techniques, and guidance.",
    { exact: true },
  )).toBeVisible();
  await expect(page.locator("main").getByText(
    "Use Control Atlas for research, not compliance or authorization decisions.",
    { exact: true },
  )).toBeVisible();
  for (const title of [
    "Why Control Atlas exists",
    "What's in here",
    "Built for the people doing the work",
    "Follow it back to the source",
    "About the project",
  ]) {
    const heading = article.getByRole("heading", { level: 2, name: title });
    await expect(heading).toBeVisible();
  }
  await expect(article.locator(":scope > section")).toHaveCount(5);
  await expect(page.getByRole("complementary", { name: "On this page" })).toBeVisible();
});

test("WS5 Guides implements a numbered, icon-bearing, whole-card Template F directory", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, "/#/guides");
  await waitForAppReady(page);

  const template = page.locator('[data-template="F"]');
  await expect(template).toBeVisible();
  await expect(template.getByRole("heading", { name: "Guides", level: 1 })).toBeVisible();

  const cards = template.locator("a.guide-card");
  await expect(cards).toHaveCount(12);
  await expect(cards.locator(".guide-card__icon svg")).toHaveCount(12);
  await expect(cards.locator(".bucket-tag")).toHaveCount(12);
  await expect(cards.locator(".guide-card__number")).toHaveText(
    Array.from({ length: 12 }, (_, index) => `Guide ${String(index + 1).padStart(2, "0")}`),
  );

  const iconShapes = await cards.locator(".guide-card__icon svg").evaluateAll((icons) => (
    icons.map((icon) => icon.innerHTML)
  ));
  expect(new Set(iconShapes).size).toBe(12);

  const firstCard = cards.first();
  const firstTitle = await firstCard.locator("strong").innerText();
  await firstCard.click();
  await expect(page).toHaveURL(/#\/guides\?pattern=starting-an-authorization/);
  await expect(page.getByRole("heading", { name: firstTitle, level: 1 })).toBeVisible();
  await expect(page.locator('[data-page-template="knowledge-base"]')).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Guide context" })).toContainText("Guide 01 of 12");
  const article = page.getByRole("article");
  for (const title of ["When it matters", "What this means", "Limitations", "Official references"]) {
    await expect(article.getByRole("heading", { name: title, level: 2 })).toBeVisible();
  }
  await expect(article.locator(".summary-card")).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: "Guide contents and source" })).toBeVisible();
});

test("WS5 Home and Guides stack without horizontal overflow below 640 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ["/", "/#/guides"]) {
    await gotoApp(page, path);
    await waitForAppReady(page, { allowPartial: true });
    await expect(page.evaluate(() => (
      globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth
    ))).resolves.toBe(true);
  }

  const cards = page.locator("a.guide-card");
  await expect(cards).toHaveCount(12);
  const firstLeft = await cards.first().evaluate((card) => card.getBoundingClientRect().left);
  const secondLeft = await cards.nth(1).evaluate((card) => card.getBoundingClientRect().left);
  expect(Math.abs(firstLeft - secondLeft)).toBeLessThanOrEqual(1);
});
