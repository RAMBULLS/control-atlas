/* global document */
import { readFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import readXlsxFile from "read-excel-file/node";
import { dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

const EXACT = "/#/compare/relationships?source=csf-2&target=nist-zt&intent=frameworks&compareRun=true";
const IMPLEMENTATION = EXACT.replace("intent=frameworks", "intent=implementation");
const pairRequest = (url) => url.includes("/compare-data/csf-2--nist-zt-");
const fullGraphRequest = (url) => /\/data\/generated\/(?:graph-data\/)?(?:nodes|edges|evidence)(?:\/|\.json)/.test(url)
  || /\/data\/generated\/library-search/.test(url);
const results = (page) => page.locator(".compare-results-table tbody tr");
async function open(page, route) {
  await gotoApp(page, route);
  await waitForAppReady(page);
  await dismissOnboarding(page);
}

for (const width of [320, 390, 1440]) {
  test(`CSF / NIST Zero Trust scope is explicit and bounded at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await open(page, EXACT);
    if (width <= 480) {
      const tabList = page.getByRole("tablist", { name: "Comparison mode" });
      await expect(tabList.getByRole("tab")).toHaveCount(3);
      const tabs = await tabList.getByRole("tab").all();
      const bounds = await Promise.all(tabs.map((tab) => tab.boundingBox()));
      expect(bounds).toHaveLength(3);
      expect(bounds.every(Boolean)).toBe(true);
      expect(bounds[0].x + bounds[0].width).toBeLessThanOrEqual(bounds[1].x + 1);
      expect(bounds[2].y).toBeGreaterThanOrEqual(bounds[0].y + bounds[0].height - 1);
      for (const tab of tabs) {
        expect(await tab.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      }
    }
    await expect(page.getByRole("heading", { name: "These are implementation mappings, not a framework crosswalk." })).toBeVisible();
    expect(requests.some(pairRequest)).toBe(false);
    expect(requests.some(fullGraphRequest)).toBe(false);
    await expect(results(page)).toHaveCount(0);
    await page.getByRole("button", { name: "View component mappings", exact: true }).click();
    await expect(results(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/intent=implementation/);
    await expect(page.getByText("Published component-support mappings, not framework equivalence.", { exact: true })).toBeVisible();
    await expect(page.locator(".compare-mapping-total")).toContainText("632 published mappings");
    expect(requests.some(fullGraphRequest)).toBe(false);
    const paths = requests.filter((url) => url.includes("/compare-data/")).map((url) => new URL(url).pathname);
    expect(paths.length).toBe(7); // Pair index and all six bounded chunks.
    expect(new Set(paths).size).toBe(7);
    expect(paths.every((path) => path.includes("/csf-2--nist-zt-"))).toBe(true);
    expect(await results(page).count()).toBeLessThanOrEqual(25);
    await expect(page.locator(".compare-results-table").getByText("Supported by", { exact: true }).first()).toBeVisible();
    // Measure the link's content box; inline strong elements have clientWidth 0.
    const overflowingLabels = await page.locator(".target-mapping-line a, .compare-answer button").evaluateAll(
      (elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent),
    );
    expect(overflowingLabels, "component IDs and export labels fit their controls").toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.reload();
    await expect(results(page).first()).toBeVisible({ timeout: 30_000 });
    await page.goBack();
    await expect(page.getByRole("button", { name: "View component mappings", exact: true })).toBeVisible();
  });
}

test("a failed pair request preserves Compare and retries a fresh request", async ({ page }) => {
  test.setTimeout(90_000);
  let fail = true;
  await page.route("**/compare-data/**", (route) => fail ? route.abort("failed") : route.continue());
  await open(page, IMPLEMENTATION);
  await expect(page.getByRole("heading", { name: "Unable to load these mappings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change source", exact: true })).toBeVisible();
  await expect(results(page)).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(results(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/source=csf-2/);
  await expect(page).toHaveURL(/target=nist-zt/);
});

test("unsupported pairs stop before mapping requests and remain accessible", async ({ page }) => {
  test.setTimeout(90_000);
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await open(page, EXACT.replace("target=nist-zt", "target=microsoft-zt-maturity"));
  await expect(page.getByRole("heading", { name: "No published mapping is available for this pair." })).toBeVisible();
  expect(requests.some((url) => url.includes("/compare-data/"))).toBe(false);
  expect(requests.some(fullGraphRequest)).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("reversing the selected publications reverses the displayed support predicate", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, IMPLEMENTATION.replace("source=csf-2&target=nist-zt", "source=nist-zt&target=csf-2"));
  await expect(results(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".compare-results-table").getByText("Supports", { exact: true }).first()).toBeVisible();
  await page.locator(".mapping-row-details > summary").first().click();
  await expect(page.locator(".mapping-evidence-list").first()).toContainText(/Supports|Is supported by/i);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("reversed Zero Trust exports retain the native assertion in CSV and Excel", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, IMPLEMENTATION);
  await expect(page.locator(".compare-mapping-total")).toContainText("632 published mappings");
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", { name: "CSV", exact: true }).click(),
  ]);
  const csv = await readFile(await csvDownload.path(), "utf8");
  expect(csv).toContain('"Published Source ID","Published Relationship","Published Target ID","Publisher Relationship Text"');
  expect(csv).toContain("Is supported by");

  const [xlsxDownload] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", { name: "Excel workbook" }).click(),
  ]);
  const parsed = /** @type {any} */ (await readXlsxFile(await xlsxDownload.path()));
  const rows = Array.isArray(parsed) && parsed[0]?.data ? parsed[0].data : parsed.data || parsed;
  expect(rows.length - 1).toBe(632);
  expect(rows[0].slice(13)).toEqual([
    "Published Source ID", "Published Relationship", "Published Target ID", "Publisher Relationship Text",
  ]);
  expect(rows.some((row) => row[4] === "supports" && row[14] === "supported_by" && row[16])).toBe(true);
});
