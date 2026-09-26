import { expect, test } from "@playwright/test";

import { UI_REVIEW_ROUTES } from "../../tools/ui-review-routes.mjs";
import { dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

/* global document, window, getComputedStyle */

/**
 * Product-level layout contracts for every public route.
 *
 * These protect user outcomes, not taste. Automation cannot tell you a page is
 * well designed — that is what the ui-review screenshots and the owner's
 * approval are for. It can tell you a page overflows sideways, buries its
 * purpose under an inventory, skips a heading level, ships a 30px tap target,
 * or signals status with colour alone. Those are failures at any standard, and
 * they are the ones that kept reaching production between reviews.
 *
 * One test per route, each loading the route once and resizing. Sweeping every
 * route inside a single test took longer than the per-test timeout under the
 * parallel worker pool, and when it did fail it named a width rather than the
 * page that broke.
 */

const WIDTHS = [320, 375, 390, 768, 1024, 1440];
const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };

/** Routes whose whole job is a long inventory, so "purpose before inventory" reads differently. */
const INVENTORY_ROUTES = new Set(["library", "resources"]);

/**
 * The content gutters the product actually uses, measured at 1440. Three exist
 * today: the detail and editorial gutter, the workspace gutter shared by
 * Library, Resources and Sources, and the Atlas canvas gutter. Home is
 * full-bleed by design.
 *
 * This asserts the set, not a single value. Collapsing three gutters into one
 * is a product-wide design decision for the owner, not something a test should
 * force; what a test can do is stop a fourth appearing because one route
 * invented its own width.
 */
const ALLOWED_CONTENT_GUTTERS = new Set([0, 24, 36, 64]);

async function open(page, path, viewport = DESKTOP) {
  await page.setViewportSize(viewport);
  // Hash routes are same-document navigations, so loading each route as a
  // fresh document keeps one route's DOM from being read as the next one's.
  await page.goto("about:blank");
  await gotoApp(page, path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await page.locator("main").first().waitFor({ state: "visible", timeout: 20_000 });
  // The shell is ready before the route's content mounts. A route that
  // genuinely has no h1 still fails: the wait times out and the assertion
  // below finds nothing.
  await page.locator("main h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
}

/**
 * Overflow of the settled layout, not of a frame during one. A late chunk
 * reflowing a route reported an overflow that was gone a moment later, and a
 * guardrail that fails at random gets ignored.
 */
async function settledOverflow(page) {
  let previous = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    if (current === previous) return current;
    previous = current;
    await page.waitForTimeout(200);
  }
  return previous;
}

for (const route of UI_REVIEW_ROUTES) {
  test(`layout holds: ${route.id}`, async ({ page }) => {
    await open(page, route.path);

    // The route names itself, in the first screen.
    const heading = page.locator("main h1").first();
    expect(await heading.count(), `${route.id} renders no h1 inside main`).toBeGreaterThan(0);
    const headingBox = await heading.boundingBox();
    expect(headingBox, `${route.id} h1 is not rendered`).not.toBeNull();
    expect(headingBox.y, `${route.id} h1 starts below the first screen`).toBeLessThanOrEqual(DESKTOP.height);

    // Heading levels never skip on the way down.
    const levels = await page.locator("main").locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName[1])));
    if (levels.length) {
      expect(levels[0], `${route.id} starts at h${levels[0]}`).toBe(1);
      for (let index = 1; index < levels.length; index += 1) {
        expect(
          levels[index] - levels[index - 1],
          `${route.id} jumps h${levels[index - 1]} to h${levels[index]}`,
        ).toBeLessThanOrEqual(1);
      }
    }

    // The page's purpose comes before its inventory. A publication page leads
    // with what the publication is, not with a thousand-row record list.
    if (!INVENTORY_ROUTES.has(route.id)) {
      for (const selector of [".catalog-records", "table", "[data-record-inventory]"]) {
        const inventory = page.locator(selector).first();
        if (await inventory.count() === 0) continue;
        const box = await inventory.boundingBox();
        if (box) {
          expect(box.y, `${route.id}: ${selector} sits above the h1`).toBeGreaterThanOrEqual(headingBox.y);
        }
      }
    }

    // Status is never carried by colour alone.
    for (const status of await page.locator("[data-lifecycle], [data-freshness], [data-limitation]").all()) {
      const text = (await status.textContent() || "").trim();
      expect(text.length, `${route.id}: a status marker renders no text`).toBeGreaterThan(1);
    }

    // One of the product's known content gutters, not a fourth of its own.
    const gutter = await page.evaluate(() => {
      const main = document.querySelector("main");
      const style = getComputedStyle(main);
      return Math.round(main.getBoundingClientRect().left + parseFloat(style.paddingLeft));
    });
    expect(
      ALLOWED_CONTENT_GUTTERS.has(gutter),
      `${route.id} uses a ${gutter}px gutter; known gutters are ${[...ALLOWED_CONTENT_GUTTERS].join(", ")}`,
    ).toBe(true);

    // No sideways overflow at any supported width. Resizing avoids reloading
    // the route six times.
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await settledOverflow(page);
      expect(overflow, `${route.id} overflows by ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    }

    // On a phone: primary navigation stays reachable, and the first actions
    // are big enough to hit. Secondary material must not push the product's
    // own navigation down the page.
    await page.setViewportSize(PHONE);
    const nav = page.locator("header nav, header [role='navigation'], header button[aria-label*='menu' i]").first();
    expect(await nav.count(), `${route.id} has no primary navigation in the header`).toBeGreaterThan(0);
    const navBox = await nav.boundingBox();
    if (navBox) {
      expect(navBox.y, `${route.id}: primary navigation starts at ${Math.round(navBox.y)}px on a phone`)
        .toBeLessThanOrEqual(PHONE.height);
    }
    for (const action of (await page.locator("main a[class*='button'], main button:visible").all()).slice(0, 10)) {
      const box = await action.boundingBox();
      if (!box || box.height === 0) continue;
      const name = (await action.textContent() || "").trim().slice(0, 40);
      expect(box.height, `${route.id}: "${name}" is ${Math.round(box.height)}px tall`).toBeGreaterThanOrEqual(44);
    }
  });
}

test("the two halves of the trust layer share one gutter", async ({ page }) => {
  // A publication page and the Sources entry it hands off to are one journey.
  // If they sit on different grids the handoff visibly jumps.
  const gutterFor = async (path) => {
    await open(page, path);
    return page.evaluate(() => {
      const main = document.querySelector("main");
      const style = getComputedStyle(main);
      return Math.round(main.getBoundingClientRect().left + parseFloat(style.paddingLeft));
    });
  };
  const publication = await gutterFor("/#/library/publication/nist-800-53");
  const sources = await gutterFor("/#/sources");
  // Equal, not merely close. This used to allow a 28px difference, which is
  // exactly the jump it was supposed to catch.
  expect(
    Math.abs(publication - sources),
    `Publication pages sit at ${publication}px and Sources at ${sources}px.`,
  ).toBeLessThanOrEqual(1);
});
