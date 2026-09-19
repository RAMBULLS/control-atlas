import { expect, test } from "@playwright/test";

import { dismissOnboarding, waitForAppReady } from "./support.mjs";

async function open(page, route) {
  await page.goto(route);
  await waitForAppReady(page);
  await dismissOnboarding(page);
}

const resultCount = (page) => page.locator("#library-results .workspace-result-row").first();

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
});

test("Library: the Atlas matching-records handoff still shows the same population", async ({ page }) => {
  await open(page, "/#/library?filter=disa-stig&tag=asset.server&tag=product.microsoft-windows&tag=program.stig");
  await expect(page.locator("main")).toContainText(/1,289/, { timeout: 60000 });
});
