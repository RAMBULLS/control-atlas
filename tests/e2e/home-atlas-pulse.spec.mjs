// #283: Home leads with Atlas and shows "What changed" from accepted evidence.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp } from "./support.mjs";

const WIDTHS = [320, 375, 390, 768, 1024, 1440];
// The governed journey list (src/ui/lib/atlasJourneyIds.ts), read rather than restated.
const JOURNEY_IDS = [...readFileSync("src/ui/lib/atlasJourneyIds.ts", "utf8").match(/Object\.freeze\(\[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
// Payloads Home must never request: the graph, the Atlas indexes, search data, or the Pulse artifact itself.
const HEAVY = /data\/generated\/(?:nodes|edges|evidence|atlas-territory|atlas-research|atlas-neighborhood|library-search|catalog-records|connection-inventory|commons-search|pulse)/;

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function openHome(page, width = 1440) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await gotoApp(page, "/");
  await dismissOnboarding(page);
  await expect(page.locator(".home-atlas")).toBeVisible();
  return requests;
}

test("Atlas is the flagship and its journeys are the governed journey list", async ({ page }) => {
  await openHome(page);
  const main = page.locator("#workspace");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Explore federal cybersecurity");
  const open = main.getByRole("link", { name: "Open Atlas" });
  await expect(open).toHaveAttribute("href", "#/atlas");
  // Atlas comes first on the page and is the largest block; no Atlas card competes in the grid.
  const firstLink = await main.locator("a[href]").first().getAttribute("href");
  expect(firstLink).toBe("#/atlas");
  await expect(page.locator(".home-secondary-action[href='#/atlas']")).toHaveCount(0);
  const [hero, pulse, grid] = await Promise.all([".home-atlas", ".home-pulse", ".home-secondary-grid"].map((s) => page.locator(s).boundingBox()));
  expect(hero.y).toBeLessThan(pulse.y);
  expect(pulse.y).toBeLessThan(grid.y);

  const journeys = page.getByRole("navigation", { name: "Start with what you're working on" }).getByRole("link");
  await expect(journeys).toHaveCount(JOURNEY_IDS.length);
  expect(await journeys.evaluateAll((links) => links.map((l) => l.getAttribute("href"))))
    .toEqual(JOURNEY_IDS.map((id) => `#/atlas?atlasJourney=${id}`));
  await journeys.filter({ hasText: "STIGs & SRGs" }).click();
  await expect(page).toHaveURL(/#\/atlas\?atlasJourney=stig$/);
});

test("What changed lists a bounded set of dated, typed events that match the Pulse artifact", async ({ page, request }) => {
  await openHome(page);
  const section = page.getByRole("region", { name: "What changed" });
  const items = section.locator(".home-pulse__event");
  const count = await items.count();
  const artifact = await (await request.get("data/generated/pulse.json")).json();
  if (artifact.events.length === 0) {
    await expect(section.locator(".home-pulse__empty")).toBeVisible();
    return;
  }
  expect(count).toBeGreaterThanOrEqual(Math.min(3, artifact.events.length));
  expect(count).toBeLessThanOrEqual(5);
  const shown = artifact.events.slice(0, count);
  expect(await items.evaluateAll((els) => els.map((el) => el.querySelector("h3")?.textContent))).toEqual(shown.map((e) => e.title));
  for (const [index, event] of shown.entries()) {
    const item = items.nth(index);
    await expect(item).toHaveAttribute("data-pulse-type", event.type);
    await expect(item.locator("time")).toHaveAttribute("datetime", event.date);
    await expect(item.locator("time")).toHaveText(new RegExp(`^${event.date_kind === "accepted" ? "Accepted" : "Shipped"} [A-Z][a-z]{2} \\d{1,2}, \\d{4}$`));
    // Every event is backed by evidence in the published artifact, and has one useful next step.
    expect(event.evidence.pointer).toMatch(/^data\/(source-change-log|product-release-log)\.json#/);
    const action = item.getByRole("link");
    await expect(action).toHaveCount(1);
    await expect(action).toHaveAttribute("href", event.destination.href);
    await expect(action).toHaveAccessibleName(`${event.destination.label} for ${event.title}`);
  }
  await expect(section).toHaveAttribute("data-dataset-id", artifact.dataset.dataset_id);
  expect(new Set(shown.map((e) => e.type)).size).toBeGreaterThan(1);
});

test("a Pulse destination opens the thing it names", async ({ page, request }) => {
  const artifact = await (await request.get("data/generated/pulse.json")).json();
  const event = artifact.events.slice(0, 5).find((e) => e.destination.view === "catalog-detail");
  test.skip(!event, "no publication event in the current bounded set");
  await openHome(page);
  await page.locator(`.home-pulse__action[href="${event.destination.href}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`${event.destination.href.replace(/[/?]/g, "\\$&")}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
});

test("keyboard order runs Atlas, journeys, search, then What changed", async ({ page }) => {
  await openHome(page);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace")).toBeFocused();
  const order = [];
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => {
      const el = globalThis.document.activeElement;
      return el?.closest(".home-pulse") ? "pulse" : el?.classList.contains("home-journey") ? "journey"
        : el?.classList.contains("home-atlas__open") ? "open" : el?.closest(".home-search") ? "search"
        : el?.closest(".home-secondary-grid") ? "destination" : el?.tagName || "none";
    }));
    const focused = page.locator(":focus");
    if (await focused.count()) {
      const outline = await focused.evaluate((el) => {
        const style = globalThis.getComputedStyle(el);
        return style.outlineStyle !== "none" || style.boxShadow !== "none" || style.textDecorationLine.includes("underline");
      });
      expect(outline, `visible focus at step ${step}`).toBe(true);
    }
  }
  const first = (kind) => order.indexOf(kind);
  expect(first("open")).toBe(0);
  expect(first("journey")).toBe(1);
  expect(order.slice(1, 1 + JOURNEY_IDS.length).every((k) => k === "journey")).toBe(true);
  expect(first("search")).toBeGreaterThan(order.lastIndexOf("journey"));
  expect(first("pulse")).toBeGreaterThan(first("search"));
});

test("Home loads no graph, Atlas index, search data or Pulse artifact", async ({ page }) => {
  const requests = await openHome(page);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  expect(requests.filter((url) => HEAVY.test(url))).toEqual([]);
});

for (const width of WIDTHS) {
  test(`Home at ${width}px: no overflow, Atlas first, usable targets`, async ({ page }, testInfo) => {
    await openHome(page, width);
    expect(await page.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px overflow`).toBeLessThanOrEqual(1);
    const open = page.locator(".home-atlas__open");
    await expect(open).toBeInViewport();
    const targets = await page.locator(".home-atlas__open, .home-journey, .home-pulse__action").evaluateAll((els) => els.map((el) => {
      const box = el.getBoundingClientRect();
      return { h: box.height, w: box.width, right: box.right };
    }));
    expect(targets.every((t) => t.h >= 44 && t.w >= 44), `${width}px targets`).toBe(true);
    expect(targets.every((t) => t.right <= width + 1), `${width}px targets inside the viewport`).toBe(true);
    await testInfo.attach(`home-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
}
