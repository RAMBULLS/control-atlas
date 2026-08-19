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

test("WS5 Home implements Template B with one search, four cards, and governed tag galaxies", async ({ page }) => {
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
  await expect(template.getByRole("heading", { name: "Make federal cybersecurity compliance make sense.", level: 1 })).toBeVisible();
  await expect(template.getByText("Understand what applies, what it means, and what to do next.", { exact: true })).toBeVisible();
  await expect(template.getByText(/publisher|provenance|mapping/i)).toHaveCount(0);
  await expect(template.locator(".home-ecosystem, .home-primary-actions")).toHaveCount(0);
  await expect(template.getByText("Start with your work", { exact: true })).toHaveCount(0);

  const tagNavigation = template.getByRole("navigation", { name: "Browse by tag" });
  const tagLinks = tagNavigation.locator(".home-tag-link");
  await expect(tagNavigation.locator(".home-tag-galaxy")).toHaveCount(6);
  await expect(tagLinks).toHaveCount(16);
  await expect(template.getByText("More records, bigger tag.", { exact: true })).toBeVisible();
  await expect(tagLinks.first()).toHaveAttribute("data-record-count", "2584");
  await expect(tagLinks.first()).toHaveAccessibleName("Server, 2,584 records");
  await expect(template.locator(".home-area-browse, .home-ecosystem-areas, .home-area-link")).toHaveCount(0);
  const hrefs = await tagLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs.every((href) => href?.startsWith("#/library?tag="))).toBe(true);

  const accentColors = await template.locator(".home-secondary-action").evaluateAll((cards) => (
    cards.map((card) => globalThis.getComputedStyle(card, "::before").backgroundColor)
  ));
  expect(new Set(accentColors).size).toBe(1);
});

test("WS5 representative tag galaxies open stable, populated Library filters", async ({ page }) => {
  const tags = [
    ["Server", "2,584"],
    ["Cloud", "666"],
    ["Operating system", "5,694"],
    ["Microsoft", "1,870"],
    ["Red Hat Enterprise Linux", "1,248"],
    ["Access Control", "1,008"],
  ];

  for (const [label, count] of tags) {
    await gotoApp(page, "/");
    await waitForAppReady(page, { allowPartial: true });
    await page.getByRole("link", { name: `${label}, ${count} records` }).click();

    await expect(page).toHaveURL(/#\/library\?tag=/);
    await expect(page.getByLabel("Active filters").getByRole("button", { name: label })).toBeVisible();
    await expect(page.getByRole("status")).not.toHaveText("0 results");
    await expect(page.getByRole("list", { name: "Search results" }).getByRole("listitem").first()).toBeVisible();
  }
});

test("WS5 governed tags remain bounded and usable at all supported widths", async ({ page }) => {
  test.setTimeout(90_000);
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await gotoApp(page, "/");
    await waitForAppReady(page, { allowPartial: true });

    const navigation = page.getByRole("navigation", { name: "Browse by tag" });
    await expect(navigation.locator(".home-tag-galaxy")).toHaveCount(6);
    await expect(navigation.locator(".home-tag-link")).toHaveCount(16);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth),
      `${width}px Home overflow`,
    ).toBeLessThanOrEqual(1);
    const targets = await navigation.locator(".home-tag-link").evaluateAll((links) => links.map((link) => {
      const box = link.getBoundingClientRect();
      return { height: box.height, width: box.width };
    }));
    expect(targets.every((target) => target.height >= 44 && target.width >= 44), `${width}px tag targets`).toBe(true);
  }
});

test("WS6 About states the research boundary exactly", async ({ page }) => {
  await gotoApp(page, "/#/about");
  await waitForAppReady(page);
  await expect(page.locator("main").getByText(
    "Control Atlas is a public research tool for federal cybersecurity requirements, controls, techniques, and guidance.",
    { exact: true },
  )).toBeVisible();
  await expect(page.locator("main").getByText(
    "Use Control Atlas for research, not compliance or authorization decisions.",
    { exact: true },
  )).toBeVisible();
  for (const title of [
    "What Control Atlas is",
    "How it is organized",
    "How sources and crosswalks work",
    "What Control Atlas does not decide",
    "About the project",
  ]) {
    const heading = page.getByRole("heading", { level: 2, name: title });
    await expect(heading).toBeVisible();
    const headingId = await heading.getAttribute("id");
    expect(headingId).toBeTruthy();
    await expect(heading.locator("xpath=ancestor::article")).toHaveAttribute(
      "aria-labelledby",
      headingId,
    );
  }
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
  await expect(cards.locator(".bucket-tag__dot")).toHaveCount(12);
  await expect(cards.locator(".guide-card__step")).toHaveText(
    Array.from({ length: 12 }, (_, index) => `Step ${String(index + 1).padStart(2, "0")}`),
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
