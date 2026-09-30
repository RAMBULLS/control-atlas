// Home (#283): the owner-approved composition. The approved design is the
// specification; these checks hold its structure, its behavior and its limits.
import { readFileSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp } from "./support.mjs";

const WIDTHS = [320, 375, 390, 768, 1024, 1440];
const HEADLINE = "Make federal cybersecurity make sense.";
const REJECTED_COPY = [
  "Nothing appears here until it passes review.",
  "Source updates Control Atlas has accepted and features it has shipped.",
  "Home shows what changed",
  "Accepted source updates and shipped features now appear on Home",
  "New in Control Atlas",
  "Control Atlas accepted",
  "Start with what you came to find",
];
const HEAVY = /data\/generated\/(?:nodes|edges|evidence|atlas-territory|atlas-research|atlas-neighborhood|library-search|catalog-records|connection-inventory|commons-search|pulse)/;
// The #282 journey registry, read from the same id list the app uses.
const JOURNEY_IDS = [...readFileSync("src/ui/lib/atlasJourneyIds.ts", "utf8")
  .match(/Object\.freeze\(\[([^\]]*)\]/)[1]
  .matchAll(/"([^"]+)"/g)].map((match) => match[1]);

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function openHome(page, width = 1440) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await gotoApp(page, "/");
  await dismissOnboarding(page);
  await expect(page.locator("#workspace .home-entry")).toBeVisible();
  return requests;
}

/**
 * What a reader gets from Home, without the search control (a form before
 * React, a trigger after): every element that holds text, with its class and
 * text, plus the links and the map. Whitespace between block elements (present
 * in the static HTML, absent in React) is not visible and is not compared.
 */
async function homeSnapshot(page) {
  return page.locator("#workspace .home-entry").evaluate((home) => {
    const clone = home.cloneNode(true);
    for (const search of clone.querySelectorAll(".home-search")) search.remove();
    const text = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();
    return {
      regions: [...clone.children].map((child) => child.className),
      headings: [...clone.querySelectorAll("h1, h2")].map(text),
      leaves: [...clone.querySelectorAll("*")]
        .filter((element) => !element.children.length)
        .map((element) => `${element.tagName}.${element.getAttribute("class") || ""}|${text(element)}`),
      links: [...clone.querySelectorAll("a[href]")].map((link) => `${link.getAttribute("href")} ${text(link)}`),
      map: {
        viewBox: clone.querySelector(".home-map svg")?.getAttribute("viewBox"),
        areas: [...clone.querySelectorAll(".home-map__area")].map((area) => area.getAttribute("d")),
        landmarks: [...clone.querySelectorAll(".home-map__alias")].map(text),
      },
    };
  });
}

test("Home holds the approved composition: hero with search and the Atlas, tools, Library and source changes", async ({ page }) => {
  await openHome(page);
  const home = page.locator("#workspace .home-entry");
  await expect(home.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
  await expect(home.locator(".home-lead")).toContainText("trace where requirements come from, see how they relate, and know what to do next.");
  await expect(home.getByRole("searchbox", { name: "Search Control Atlas" })).toBeVisible();
  // Two real counts; the connection count left the hero.
  await expect(home.locator(".home-metrics")).toHaveText(/^\S+ records · \d+ source publications$/);
  await expect(home.locator(".home-map__area")).toHaveCount(9);
  await expect(home.getByRole("heading", { name: "See how federal cybersecurity fits together.", level: 2 })).toBeVisible();
  await expect(home.getByRole("link", { name: "Open the Atlas", exact: true })).toHaveAttribute("href", "#/atlas");
  await expect(home.locator(".home-start__link")).toHaveCount(0);
  await expect(home.getByRole("navigation", { name: "Tools" }).getByRole("link")).toHaveCount(3);
  await expect(home.getByRole("region", { name: "Browse the Library" }).locator(".home-library__item")).toHaveCount(5);
  for (const copy of REJECTED_COPY) await expect(home).not.toContainText(copy);

  // The regions stack in the approved order, and at 1440 the tools band starts in the first viewport.
  const boxes = await Promise.all([".home-hero", ".home-tools", ".home-library"].map((selector) => home.locator(selector).boundingBox()));
  expect(boxes[0].y + boxes[0].height).toBeLessThanOrEqual(boxes[1].y + 1);
  expect(boxes[1].y + boxes[1].height).toBeLessThanOrEqual(boxes[2].y + 1);
  expect(boxes[1].y).toBeLessThan(1000);
});

test("the topic list is hidden by default and opens, closes and returns focus from the keyboard", async ({ page }) => {
  await openHome(page);
  const topics = page.locator("#workspace [data-home-topics]");
  const summary = topics.locator("summary");
  await expect(topics).not.toHaveAttribute("open", "");
  await expect(topics.getByRole("navigation", { name: "Atlas topics" })).toBeHidden();

  await summary.focus();
  await page.keyboard.press("Enter");
  const list = topics.getByRole("navigation", { name: "Atlas topics" });
  await expect(list).toBeVisible();
  // Every destination is a #282 journey, in registry order.
  expect(await list.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
    .toEqual(JOURNEY_IDS.map((id) => `#/atlas?atlasJourney=${id}`));
  await expect(page.locator(".home-topics__panel h2, .home-topics__panel h3, .home-topics__panel .home-eyebrow")).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(list.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(summary).toBeFocused();

  // A click outside closes it without moving focus into the page.
  await page.keyboard.press("Enter");
  await expect(list).toBeVisible();
  await page.locator("#workspace .home-lead").click();
  await expect(list).toBeHidden();
});

test("a topic opens its Atlas journey", async ({ page }) => {
  await openHome(page);
  await page.locator("#workspace [data-home-topics] summary").click();
  await page.getByRole("navigation", { name: "Atlas topics" }).getByRole("link").first().click();
  await expect(page).toHaveURL((url) => url.hash === `#/atlas?atlasJourney=${JOURNEY_IDS[0]}`);
  await expect(page.locator(".atl")).toBeVisible({ timeout: 30_000 });
});

test("the static first paint and the React Home render the same page", async ({ page }) => {
  await openHome(page);
  const staticHome = await homeSnapshot(page);
  expect(staticHome.links.length).toBeGreaterThan(10);

  await page.getByRole("link", { name: "Open the Atlas", exact: true }).click();
  await expect(page).toHaveURL((url) => url.hash === "#/atlas");
  await expect(page.locator(".atl")).toBeVisible({ timeout: 30_000 });
  await page.locator("a[href='#/']").first().click();
  await expect(page.locator("#workspace .home-entry")).toBeVisible();
  const reactHome = await homeSnapshot(page);
  expect(reactHome).toEqual(staticHome);
});

test("Home search behaves as before: a query opens the Library", async ({ page }) => {
  await openHome(page);
  await page.getByRole("searchbox", { name: "Search Control Atlas" }).fill("AC-2");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/library\?q=AC-2/);
});

test("source changes are publications only: a desktop sidecar of at most two and one compact phone row", async ({ page }) => {
  await openHome(page);
  const aside = page.locator("#workspace .home-pulse");
  await expect(aside).toBeVisible();
  const changes = aside.locator(".home-pulse__change");
  expect(await changes.count()).toBeLessThanOrEqual(2);
  for (const href of await changes.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
    expect(href).toMatch(/^#\/library\/publication\//);
  }
  await expect(aside.locator("time")).toHaveCount(await changes.count());
  await expect(page.locator("#workspace .home-pulse-row")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(aside).toBeHidden();
  if (await changes.count()) {
    await expect(page.locator("#workspace .home-pulse-row")).toBeVisible();
    await expect(page.locator("#workspace .home-pulse-row")).toHaveAttribute("href", "#/sources");
  }
});

test("Home loads no graph, Atlas index, search data or Pulse artifact", async ({ page }) => {
  const requests = await openHome(page);
  await page.waitForLoadState("networkidle");
  expect(requests.filter((url) => HEAVY.test(url))).toEqual([]);
});

test("Home with the topic list open has no serious accessibility violations", async ({ page }) => {
  await openHome(page);
  await page.locator("#workspace [data-home-topics] summary").click();
  const results = await new AxeBuilder({ page }).include("#workspace .home-entry").analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact))).toEqual([]);
});

test("both Home renderers take copy from site-copy and never show the rejected release feed", () => {
  for (const path of ["src/ui/pages/HomePage.tsx", "vite.config.ts"]) {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("HOME_CONTENT.headline");
    for (const copy of REJECTED_COPY) expect(source).not.toContain(copy);
  }
  const build = readFileSync("tools/build-static-site.mjs", "utf8");
  expect(build).toContain("scripts/build-pulse-artifact.mjs");
});

for (const width of WIDTHS) {
  test(`Home at ${width}px keeps search and the Atlas first and has no horizontal overflow`, async ({ page }, testInfo) => {
    await openHome(page, width);
    const home = page.locator("#workspace .home-entry");
    expect(await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px overflow`).toBeLessThanOrEqual(1);
    const [search, open, tools] = await Promise.all([
      home.locator(".home-search").boundingBox(),
      home.getByRole("link", { name: "Open the Atlas", exact: true }).boundingBox(),
      home.locator(".home-tools").boundingBox(),
    ]);
    const viewportHeight = width < 768 ? 844 : 1000;
    expect(search.y + search.height, `${width}px search in the first viewport`).toBeLessThanOrEqual(viewportHeight);
    expect(open.y, `${width}px Atlas below search`).toBeGreaterThan(search.y);
    expect(tools.y, `${width}px tools after the Atlas`).toBeGreaterThan(open.y);
    // WCAG 2.5.8: a standalone target is at least 24px; a link inside a sentence is exempt.
    const targets = await home.locator("a[href]:not([tabindex='-1']), summary").evaluateAll((nodes) => nodes
      .filter((node) => node.getClientRects().length && node.parentElement?.tagName !== "P")
      .filter((node) => node.getBoundingClientRect().height < 24)
      .map((node) => `${node.className} ${Math.round(node.getBoundingClientRect().height)}px`));
    expect(targets, `${width}px link targets`).toEqual([]);
    await testInfo.attach(`home-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
}
