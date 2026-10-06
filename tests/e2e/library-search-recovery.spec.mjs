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
  await open(page, "/#/library?filter=disa-stig&tag=asset.server&tag=product.microsoft-windows&tag=program.stig");
  await expect(page.locator("main")).toContainText(/1,289/, { timeout: 60000 });
});
