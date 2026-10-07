import { expect, test } from "@playwright/test";

import { dismissOnboarding, waitForAppReady } from "./support.mjs";

async function open(page, route) {
  await page.goto(route);
  await waitForAppReady(page);
  await dismissOnboarding(page);
}

const resultCount = (page) => page.locator("#library-results .workspace-result-row").first();

test("global Search from Atlas includes Resources and source publications", async ({ page }) => {
  const resourceRequests = [];
  page.on("request", (request) => {
    if (/commons-search-index|commons-resource-dataset/.test(request.url())) resourceRequests.push(request.url());
  });
  await open(page, "/#/atlas");
  expect(resourceRequests).toEqual([]);
  await page.getByRole("button", { name: "Open search" }).click();
  const dialog = page.getByRole("dialog", { name: "Search Control Atlas" });
  const query = dialog.getByRole("searchbox", { name: "Search Control Atlas" });
  await query.fill("STIG Viewer");
  const resource = dialog.locator('.search-overlay-result[href^="#/resources/"]').first();
  await expect(resource).toBeVisible();
  await expect(resource).toContainText(/STIG Viewer/);
  await query.fill("NIST");
  const source = dialog.locator('.search-overlay-result[href^="#/sources"]').first();
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute("href", /[?&]source=[^&#]+/);
  expect(resourceRequests.length).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/#\/atlas$/);
});

for (const query of ["AC-2", "AC 2", "CCI 185", "WN19 DC 000290", "SP 800-53", "CMMC", "windows server 2019", "multifactor authentication"]) {
  test(`global Search and Library agree on the leading record for ${query}`, async ({ page }) => {
    await open(page, `/#/library?q=${encodeURIComponent(query)}`);
    const first = resultCount(page).locator('a[href^="#/record/"]').first();
    await expect(first).toBeVisible();
    const destination = await first.getAttribute("href");
    await page.getByRole("button", { name: "Open search" }).click();
    const dialog = page.getByRole("dialog", { name: "Search Control Atlas" });
    await dialog.getByRole("searchbox", { name: "Search Control Atlas" }).fill(query);
    const suggestion = dialog.locator('.search-overlay-result[href^="#/record/"]').first();
    await expect(suggestion).toHaveAttribute("href", destination);
    await expect(suggestion.locator(".search-overlay-result-meta")).not.toBeEmpty();
    await page.keyboard.press("Escape");
    await expect(first).toHaveAttribute("href", destination);
  });
}

for (const version of ["2019", "2016", "2022"]) {
  test(`Library: windows server ${version} finds records instead of an empty page`, async ({ page }) => {
    await open(page, `/#/library?q=windows+server+${version}`);
    await expect(resultCount(page)).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("heading", { name: "No records found." })).toHaveCount(0);
    await expect(page.locator("main")).toContainText(new RegExp(`Windows Server ${version}`));
  });
}

test("Library: a search with one impossible word offers to drop it, with a real count", async ({ page }) => {
  await open(page, "/#/library?q=windows+server+2019+zzqxv");
  await expect(page.getByRole("heading", { name: "No records found." })).toBeVisible({ timeout: 60000 });
  const option = page.getByRole("button", { name: /^Try without “zzqxv” · [\d,]+ results$/ });
  await expect(option).toBeVisible();
  await expect(page.getByRole("button", { name: /^Try without “windows”/ })).toHaveCount(0);
  await option.click();
  await expect(page).toHaveURL(/q=windows\+server\+2019(?!\+)/);
  await expect(resultCount(page)).toBeVisible({ timeout: 60000 });
});

test("Library: a search that is empty only because of filters says what removing them would show", async ({ page }) => {
  await open(page, "/#/library?q=cmmc&filter=disa-stig");
  await expect(page.getByRole("heading", { name: "Nothing matches these filters." })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".empty-state")).toContainText(/Without the filters, this search has [\d,]+ results?\./);
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
});

test("Library: a genuine zero stays honest and offers no invented suggestions", async ({ page }) => {
  await open(page, "/#/library?q=zzqxv+kkwp");
  await expect(page.getByRole("heading", { name: "No records found." })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".empty-state__options")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear search" })).toBeVisible();
  await page.getByRole("button", { name: "Open search" }).click();
  const dialog = page.getByRole("dialog", { name: "Search Control Atlas" });
  await dialog.getByRole("searchbox", { name: "Search Control Atlas" }).fill("zzqxv kkwp");
  await expect(dialog.getByText('No records or resources match "zzqxv kkwp".')).toBeVisible();
  await expect(dialog.locator(".search-overlay-result")).toHaveCount(0);
});

test("Library: the Atlas matching-records handoff still shows the same population", async ({ page }) => {
  test.setTimeout(120_000);
  const tags = ["asset.server", "product.microsoft-windows", "program.stig"];
  const rows = page.locator("#library-results .workspace-result-row");
  const population = async () => {
    const summary = page.locator(".workspace-result-count");
    await expect(summary).toHaveText(/^[\d,]+ (?:matches|results?)\b/, { timeout: 30_000 });
    const match = (await summary.innerText()).match(/^([\d,]+) /);
    const count = Number(match[1].replace(/,/g, ""));
    expect(Number.isSafeInteger(count)).toBe(true);
    expect(count).toBeGreaterThan(0);
    return count;
  };
  const representativeRecords = async () => {
    await expect(rows.nth(2)).toBeVisible({ timeout: 30_000 });
    return rows.evaluateAll(items => items.slice(0, 3).map(item => ({
      id: item.getAttribute("data-record-id"),
      href: item.querySelector('a[href^="#/record/"]')?.getAttribute("href"),
    })));
  };
  await open(page, "/#/library?filter=disa-stig&tag=asset.server&tag=product.microsoft-windows&tag=program.stig");
  const libraryPopulation = await population();
  const baselineRecords = await representativeRecords();
  for (const record of baselineRecords) {
    expect(record.id).toBeTruthy();
    expect(record.href).toMatch(/^#\/record\//);
  }

  await page.evaluate(() => {
    window.location.hash = "/atlas?atlasLimb=atlas:LIMB-IMPLEMENTATION&atlasFramework=disa-stig&atlasContext=asset.server,product.microsoft-windows,program.stig";
  });
  await waitForAppReady(page);
  await expect(page.locator('.atl[data-route-content-ready="true"]')).toBeVisible();
  const inspector = page.locator(".atl-inspector");
  await expect(inspector.getByRole("heading", { name: "DISA STIG", exact: true })).toBeVisible();
  const matching = inspector.getByRole("region", { name: "Matching this context" });
  const atlasSummary = matching.locator(":scope > p").first();
  await expect(atlasSummary).toHaveText(/^[\d,]+ records in this publication are associated with your choices\.$/);
  const atlasPopulation = Number((await atlasSummary.innerText()).match(/^([\d,]+) /)[1].replace(/,/g, ""));
  expect(atlasPopulation).toBe(libraryPopulation);
  for (const label of ["Server", "Microsoft Windows", "STIG"]) {
    await expect(matching.locator(".atl-breakdown")).toContainText(label);
  }
  await matching.getByRole("link", { name: "View matching records" }).click();
  await expect(page).toHaveURL(/#\/library\?/);
  const params = new URL(page.url()).hash.split("?")[1];
  const selection = new URLSearchParams(params);
  expect(selection.get("filter")).toBe("disa-stig");
  expect(selection.getAll("tag").sort()).toEqual(tags.slice().sort());
  await waitForAppReady(page);
  expect(await population()).toBe(atlasPopulation);
  expect(await representativeRecords()).toEqual(baselineRecords);
});
