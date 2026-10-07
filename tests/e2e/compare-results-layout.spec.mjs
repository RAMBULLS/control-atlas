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
const DENSE = "/#/compare/relationships?intent=frameworks&source=disa-cci&target=disa-stig&compareRun=true";
// ~1.5 phone viewports at 844px tall.
const PHONE_ROW_MAX = 1266;
const COMPACT_INLINE_LIMIT = 8;

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("published baseline selections reconcile, filter and export on desktop and mobile", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const baselineRoute = "/#/compare/relationships?intent=baselines&source=nist-800-53b:MODERATE&target=fedramp-rev5:MODERATE&compareRun=true";
  await gotoApp(page, baselineRoute);
  await waitForAppReady(page); await dismissOnboarding(page);
  await expect(page.locator("[data-baseline-result]").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#compare-results")).toContainText("historical");
  await expect(page.locator("#compare-workspace")).toContainText("not a compliance failure");
  const totals = await page.locator("#compare-results > p").nth(1).innerText();
  const shared = Number(totals.match(/([\d,]+) shared/)[1].replaceAll(",", ""));
  expect(shared).toBeGreaterThan(25);
  await page.getByLabel("Result group").selectOption("shared");
  expect(await page.locator("[data-baseline-result]").count()).toBeLessThanOrEqual(25);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await readFile(await (await downloadPromise).path(), "utf8");
  expect(csv.split("\r\n")).toHaveLength(shared + 1);
  expect(csv).toContain('"Shared"'); expect(csv).not.toContain('"Only in A"');
  expect(csv).toContain("https://"); expect(csv).toContain("fedramp.gov");
  await page.getByLabel("Search results by ID or title").fill("no-such-control-zzzz");
  await expect(page.getByText("No controls match these filters.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  await page.getByLabel("Search results by ID or title").fill("");
  await page.getByLabel("Baseline B").selectOption("nist-800-53b:MODERATE");
  await expect(page.locator("#compare-results")).toContainText(/0 only in A · [\d,]+ shared · 0 only in B/);
  await page.goBack();
  await expect(page.locator("#compare-results > p").nth(1)).toHaveText(totals);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const scan = await new AxeBuilder({ page }).include("#compare-workspace").analyze();
    expect(scan.violations.filter((v) => ["serious", "critical"].includes(v.impact))).toEqual([]);
  }
  await testInfo.attach("baseline-comparison-mobile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.getByRole("tab", { name: "Frameworks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a framework", exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Publication\b/)).toHaveValue("");
  await expect(page.locator("[data-baseline-result]")).toHaveCount(0);
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
  await expect(page.getByText(/loads the full published connection data/)).toHaveCount(0);
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
    // #281: every target shows with no reveal click. On phones only rows of up
    // to 8 targets render inline; larger ones use the bounded window, so no row
    // passes ~1.5 viewports (1,266px at 844px tall).
    expect(m.maxRowHeight, "no giant row (baseline 3,856)").toBeLessThanOrEqual(PHONE_ROW_MAX);
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
  const bootstrap = JSON.parse(await readFile("dist/site/data/generated/catalog-bootstrap.json", "utf8")).catalog_bootstrap;
  const pair = bootstrap.comparison_pairs["disa-cci|disa-stig"];
  const index = JSON.parse(await readFile(`dist/site/data/generated/${pair.path}`, "utf8"));
  const pairRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/compare-data/disa-cci--disa-stig-")) pairRequests.push(request.url());
  });
  await open(page, DENSE);
  await expect(page.locator(".compare-mapping-total")).toContainText(`${pair.edge_count.toLocaleString()} published mappings`);
  expect(pairRequests.length).toBe(index.chunks.length + 1);
  expect(new Set(pairRequests).size).toBe(pairRequests.length);
  expect(Math.max(...index.chunks.map((chunk) => chunk.bytes))).toBeLessThanOrEqual(512 * 1024);
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

// Phones: 25 inline titled targets made rows ~3,400px tall. Past 8 targets a
// record uses the window straight away, with no reveal click and its true total.
for (const width of [320, 375, 390]) {
  test(`dense one-to-many rows stay bounded on a ${width}px phone`, async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, DENSE, { width, height: 844 });
    await expect(page.getByText(/^Show \d[\d,]* more/)).toHaveCount(0);
    const rows = await page.locator(ROWS).evaluateAll((trs) => trs.map((tr) => ({
      height: tr.getBoundingClientRect().height,
      inline: tr.querySelectorAll(".target-mapping-list:not(.target-window-list) > .target-mapping-item").length,
      windowed: tr.querySelector(".target-window") !== null,
      total: Number((tr.querySelector(".mapping-row-details > summary")?.textContent.match(/for ([\d,]+) mapping/) || [0, "0"])[1].replace(/,/g, "")),
    })));
    for (const row of rows) {
      expect(row.height, "no Compare row passes ~1.5 viewports").toBeLessThanOrEqual(PHONE_ROW_MAX);
      expect(row.inline, "at most 8 targets render inline on a phone").toBeLessThanOrEqual(COMPACT_INLINE_LIMIT);
      if (row.total > COMPACT_INLINE_LIMIT) expect(row.windowed, "a row above 8 targets uses the window").toBe(true);
    }
    expect(rows.some((row) => row.windowed), "the dense page includes a windowed row").toBe(true);
    const windowed = page.locator(".target-window").first();
    const caption = await windowed.locator(".target-window-caption").innerText();
    const total = Number(caption.match(/All ([\d,]+) targets/)[1].replace(/,/g, ""));
    expect(total).toBeGreaterThan(COMPACT_INLINE_LIMIT);
    await windowed.getByRole("region").focus();
    await page.keyboard.press("End");
    await expect(windowed.locator(`.target-mapping-item[aria-posinset="${total}"]`)).toBeVisible();
  });
}

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

test("dense mapping evidence stays bounded and reaches the same final target by keyboard", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, DENSE);
  await page.getByLabel("Search results by ID or title").fill("CCI-000366");
  const rows = page.locator(ROWS);
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  const targets = row.locator(".target-window");
  const total = Number((await targets.locator(".target-window-caption").innerText()).match(/All ([\d,]+) targets/)[1].replace(/,/g, ""));
  expect(total).toBeGreaterThan(1000);
  await targets.getByRole("region").focus();
  await page.keyboard.press("End");
  const finalTarget = targets.locator(`[aria-posinset="${total}"]`);
  await expect(finalTarget).toBeVisible();
  const finalIdentity = await finalTarget.locator("strong").innerText();
  const evidence = row.locator(".mapping-row-details");
  await evidence.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(evidence.locator(".mapping-evidence-list > section")).toHaveCount(25);
  expect(await row.evaluate(element => element.getElementsByTagName("*").length)).toBeLessThan(2000);
  const sourceUrl = page.url();
  const pager = evidence.getByRole("navigation", { name: "Evidence pages for CCI-000366" });
  await pager.getByRole("button", { name: "Last page" }).focus();
  await page.keyboard.press("Enter");
  await expect(evidence.locator(".mapping-evidence-list > section")).toHaveCount(total % 25 || 25);
  await expect(evidence.locator(".mapping-evidence-list > section > strong").last()).toHaveText(finalIdentity);
  await expect(pager.getByRole("button", { name: "Previous page" })).toBeFocused();
  await expect(page).toHaveURL(sourceUrl);
  expect(await row.evaluate(element => element.getElementsByTagName("*").length)).toBeLessThan(2000);
  await evidence.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(evidence.locator(".mapping-evidence-list")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(evidence.locator(".mapping-evidence-list > section > strong").last()).toHaveText(finalIdentity);
  await pager.getByRole("button", { name: "Previous page" }).click();
  await expect(evidence.locator(".mapping-evidence-list > section")).toHaveCount(25);
});

test("filtering, the taxonomy disclosure and pagination work by keyboard and keep counts honest", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, PAIR);
  const trigger = page.getByRole("button", { name: /Related tags/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Related tags" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Related tags" })).toHaveCount(0);

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
