/* global document, getComputedStyle, Node */
import { readFile } from "node:fs/promises";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

// Bounds come from the measured production baseline for SP 800-53 Rev. 5 <-> NIST CSF 2.0
// before this change: first mapping 1,342 px (desktop) / 2,180 px (phone) below the results
// heading, page 43,535 px / 77,433 px tall, 100 rows, 28 controls before the first mapping,
// a "Show published mappings" click after choosing both frameworks.
const CONFIGURED = "/#/compare/relationships?intent=frameworks&source=nist-800-53&target=csf-2";
const PAIR = `${CONFIGURED}&compareRun=true`;
const ROWS = ".compare-results-table tbody tr";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

async function open(page, route, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await gotoApp(page, route);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator("#compare-results")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(ROWS).first()).toBeVisible();
}

const mappingsIn = async (page) => {
  const text = await page.locator(".compare-mapping-total").innerText();
  return Number((text.match(/^([\d,]+)/) || [])[1].replace(/,/g, ""));
};

const layout = (page) => page.evaluate(() => {
  const panel = document.querySelector("#compare-results");
  const heading = document.querySelector("#compare-active-step");
  const first = panel.querySelector("tbody tr");
  const controls = [...panel.querySelectorAll("button, input, select, a[href], summary")]
    .filter((el) => el.getClientRects().length > 0 && el.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  const heights = [...panel.querySelectorAll("tbody tr")].map((row) => row.getBoundingClientRect().height);
  return {
    controlsBeforeFirstRow: controls.length,
    headingToFirstRow: Math.round(first.getBoundingClientRect().top - heading.getBoundingClientRect().top),
    maxRowHeight: Math.round(Math.max(...heights)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pageHeight: document.documentElement.scrollHeight,
    rows: heights.length,
  };
});

test("choosing the second framework runs the comparison with no extra step", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page, "/#/compare");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await page.getByRole("button", { name: "SP 800-53 Rev. 5", exact: true }).click();
  await page.getByRole("button", { name: "NIST CSF 2.0", exact: true }).click();
  await expect(page.locator("#compare-results")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Show published mappings" })).toHaveCount(0);
  await expect(page.locator("#compare-results h2")).toContainText("SP 800-53 Rev. 5 ↔ NIST CSF 2.0");
  await expect(page.locator(ROWS).first()).toBeVisible();
});

test("a link that only names both publications waits for one explained, primary action", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page, CONFIGURED);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const button = page.getByRole("button", { name: "Show published mappings" });
  await expect(button).toBeVisible();
  await expect(page.getByText(/loads the full published connection data/)).toBeVisible();
  await expect(page.locator("#compare-results")).toHaveCount(0);
  await button.click();
  await expect(page.locator("#compare-results")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(ROWS).first()).toBeVisible();
});

test("handoff links that carry compareRun land straight on the result", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, PAIR);
  await expect(page.locator("#compare-results h2")).toContainText("NIST CSF 2.0");
  await expect(page.getByRole("button", { name: "Show published mappings" })).toHaveCount(0);
});

test("the answer leads at desktop: summary first, the first mapping close, controls few, page bounded", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, PAIR);
  const m = await layout(page);
  expect(m.headingToFirstRow, "first mapping close to the heading (baseline 1,342)").toBeLessThan(700);
  expect(m.controlsBeforeFirstRow, "controls before the first mapping (baseline 28)").toBeLessThanOrEqual(12);
  expect(m.rows, "rendered source records (baseline 100)").toBeLessThanOrEqual(25);
  expect(m.pageHeight, "page height (baseline 43,535)").toBeLessThan(15_000);
  expect(m.maxRowHeight, "no single record dominates (baseline 2,628)").toBeLessThan(1000);
  // Refinement is visible in the toolbar; the taxonomy wall is a collapsed inline disclosure.
  await expect(page.getByLabel("Search results by ID or title")).toBeVisible();
  await expect(page.getByLabel("Connection type")).toBeVisible();
  await expect(page.getByText("Refine results", { exact: true })).toHaveCount(0);
  await expect(page.locator(".compare-taxonomy-context")).toHaveCount(0);
  await expect(page.getByText(/\d+ shared · \d+ only in SP 800-53 Rev\. 5 · \d+ only in NIST CSF 2\.0/)).toBeVisible();
});

for (const width of [320, 375, 390]) {
  test(`the result is scannable on a ${width}px phone`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, PAIR, { width, height: 844 });
    const m = await layout(page);
    expect(m.overflow).toBeLessThanOrEqual(1);
    expect(m.headingToFirstRow, "first mapping close to the heading (baseline 2,180)").toBeLessThan(900);
    expect(m.pageHeight, "page height (baseline 77,433)").toBeLessThan(20_000);
    // #281: every target now shows with no reveal click, so the busiest record
    // (25 titled CSF targets) is ~1,270-1,470px on a phone. The old 1,100px bound
    // held only because 20 of them hid behind "Show N more". Records past the
    // inline limit use a bounded window, so rows still cannot run away.
    expect(m.maxRowHeight, "no giant row (baseline 3,856)").toBeLessThan(1700);
    const labels = await page.evaluate(() => getComputedStyle(document.querySelector(".compare-results-table td"), "::before").display);
    expect(labels, "no repeated From / Maps to label in every row").toBe("none");
    const spill = await page.evaluate(() => {
      const panel = document.querySelector("#compare-results").getBoundingClientRect();
      return [...document.querySelectorAll("#compare-results .compare-answer *, #compare-results .compare-results-toolbar *")]
        .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > panel.right + 1)
        .map((el) => el.tagName);
    });
    expect(spill, "answer, export and toolbar stay inside the result panel").toEqual([]);
  });
}

// #281 "respect the click": a chosen comparison shows every target of every
// record with no reveal click. The busiest SP 800-53 -> CSF record has 25.
test("every record shows all of its targets with no reveal click", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, PAIR);
  await expect(page.getByText(/^Show \d[\d,]* more/)).toHaveCount(0);
  const rows = page.locator(ROWS);
  const counts = await rows.evaluateAll((trs) => trs.map((tr) => ({
    shown: tr.querySelectorAll(".target-mapping-item").length,
    total: Number(tr.querySelector(".mapping-row-details > summary").textContent.match(/for ([\d,]+) mapping/)[1].replace(/,/g, "")),
  })));
  expect(counts.some((row) => row.total > 5), "the page includes a one-to-many record").toBe(true);
  for (const row of counts) expect(row.shown).toBe(row.total);
});

// One DISA CCI maps to thousands of STIG rules. Such a record keeps every
// target on screen in a bounded window that states the true total and mounts
// only what is in view, so the page never renders thousands of entries.
test("an extreme one-to-many record shows its true total in a bounded window, no click", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "/#/compare/relationships?intent=frameworks&source=disa-cci&target=disa-stig&compareRun=true");
  await expect(page.getByText(/^Show \d[\d,]* more/)).toHaveCount(0);
  const windowed = page.locator(".target-window").first();
  await expect(windowed).toBeVisible();
  const caption = await windowed.locator(".target-window-caption").innerText();
  const total = Number(caption.match(/All ([\d,]+) targets/)[1].replace(/,/g, ""));
  expect(total).toBeGreaterThan(25);
  const scroller = windowed.getByRole("region");
  const mounted = await windowed.locator(".target-mapping-item").count();
  expect(mounted, "only entries in view are mounted").toBeLessThan(40);
  expect(mounted).toBeGreaterThan(0);
  await expect(windowed.locator(".target-mapping-item").first()).toHaveAttribute("aria-setsize", String(total));
  // Keyboard reaches the window and scrolls it to the last entry.
  await scroller.focus();
  await page.keyboard.press("End");
  await expect(windowed.locator(`.target-mapping-item[aria-posinset="${total}"]`)).toBeVisible();
  const pageNodes = await page.locator(".compare-results-table").evaluate((table) => table.getElementsByTagName("*").length);
  expect(pageNodes, "a page stays in the low thousands of nodes").toBeLessThan(8000);
});

test("export says what it covers and delivers every matching mapping, not the page", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, PAIR);
  const total = await mappingsIn(page);
  await expect(page.locator(".compare-export-actions small")).toHaveText(
    `Exports all ${total.toLocaleString("en-US")} mappings, not just this page.`,
  );
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
  const rows = (await readFile(await download.path(), "utf8")).split(/\r\n/).filter(Boolean);
  expect(rows.length - 1, "CSV rows equal the mapping count, more than one page holds").toBe(total);

  await page.getByLabel("Search results by ID or title").fill("AC-1");
  await expect(page.locator(".compare-mapping-total")).toContainText(/of [\d,]+ published mappings match/);
  const narrowed = await mappingsIn(page);
  expect(narrowed).toBeLessThan(total);
  await expect(page.locator(".compare-export-actions small")).toHaveText(
    `Exports all ${narrowed.toLocaleString("en-US")} ${narrowed === 1 ? "mapping" : "mappings"} matching your search and filters, not just this page.`,
  );
});

test("filtering, the taxonomy disclosure and pagination work by keyboard and keep counts honest", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, PAIR);
  const trigger = page.getByRole("button", { name: /Taxonomy context/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Taxonomy context" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Taxonomy context" })).toHaveCount(0);

  const type = page.getByLabel("Connection type");
  const before = await mappingsIn(page);
  const options = await type.locator("option").allInnerTexts();
  expect(options.length).toBeGreaterThanOrEqual(2);
  await type.selectOption({ index: 1 });
  expect(await mappingsIn(page)).toBeLessThanOrEqual(before);

  await type.selectOption({ index: 0 });
  await expect.poll(() => mappingsIn(page)).toBe(before);
  await page.getByRole("button", { name: "Next page" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("navigation", { name: "Mapping result pages" })).toContainText("Showing source records 26–50");
});

test("an empty search is truthful and recoverable, and back returns to the result", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, PAIR);
  await page.getByLabel("Search results by ID or title").fill("zzzzqq");
  await expect(page.getByRole("heading", { name: "No published mappings match this search." })).toBeVisible();
  await expect(page.getByText(/found between these selections/)).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(ROWS).first()).toBeVisible();

  await page.getByRole("button", { name: "Compare with another" }).click();
  await expect(page.locator("#compare-results")).toHaveCount(0);
  await expect(page).not.toHaveURL(/target=/);
  await page.goBack();
  await expect(page.locator("#compare-results")).toBeVisible({ timeout: 90_000 });
});

test("the result has no serious or critical accessibility violations at desktop and phone", async ({ page }) => {
  test.setTimeout(120_000);
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await open(page, PAIR, size);
    const results = await new AxeBuilder({ page }).include("#compare-results").analyze();
    expect(results.violations.filter((v) => ["serious", "critical"].includes(v.impact))).toEqual([]);
  }
});
