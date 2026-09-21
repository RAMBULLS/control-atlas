import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, gotoApp, waitForAppReady } from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("a cold deep link resolves from one complete search artifact", async ({
  page,
}) => {
  let searchArtifactRequests = 0;
  let retiredShardRequests = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("library-search.json")) {
      searchArtifactRequests += 1;
    }
    if (url.includes("/library-search/")) {
      retiredShardRequests += 1;
    }
  });

  await gotoApp(page, "/#/record/cmmc-2/LEVEL-2");
  await waitForAppReady(page);

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /LEVEL-2|Level 2/i,
  );
  // Re-baselined 2026-08-01: a record deep link now resolves from its own
  // catalog artifact and neighborhood shard. It no longer pulls the whole
  // search index, and it never fans out over the retired per-letter shards.
  expect(searchArtifactRequests).toBe(0);
  expect(retiredShardRequests).toBe(0);
});

test("a failed complete search artifact uses the app retry path", async ({
  page,
}) => {
  // Re-baselined 2026-08-01: the record route no longer depends on the search
  // index, so the retry path is exercised against the artifacts it does load.
  let shouldFail = true;
  await page.route("**/data/generated/**", async (route) => {
    if (shouldFail) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/#/record/cmmc-2/LEVEL-2");
  await expect(page.getByRole("button", { name: "Try loading again" })).toBeVisible({
    timeout: 15000,
  });

  shouldFail = false;
  await page.getByRole("button", { name: "Try loading again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /LEVEL-2|Level 2/i,
    { timeout: 15000 },
  );
});

test("shared search URLs keep position; submitted searches move focus to results", async ({
  page,
}) => {
  await page.goto("/#/search?q=AC-2");
  await expect(page.locator("#library-results")).toBeVisible({
    timeout: 15000,
  });
  expect(await page.evaluate(() => globalThis.window.scrollY)).toBeLessThan(10);
  await expect(page.locator("#library-results")).not.toBeFocused();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator("#library-results")).toBeFocused();
});

test("a complete Library search fetches each index shard exactly once", async ({
  page,
}) => {
  // The corpus grows with every publisher refresh, so the shard count is data. What
  // the runtime must guarantee is that it reads the published shard list once and
  // never re-requests a shard.
  const manifest = await (await page.request.get("/data/generated/library-search-index.json")).json();
  const published = manifest.sharded_collection.shards.length;
  expect(published).toBeGreaterThan(0);
  const shardRequests = [];
  page.on("request", (request) => {
    const match = request.url().match(/\/data\/generated\/library-search-index\/([^/?]+?)\.json(?:\.gz)?(?:\?|$)/);
    if (match) shardRequests.push(match[1]);
  });

  await gotoApp(page, "/#/search?q=access%20control");
  await expect(page.locator("#library-results .workspace-result-row").first()).toBeVisible({
    timeout: 15000,
  });
  expect(new Set(shardRequests).size, "no shard is requested twice").toBe(shardRequests.length);
  expect(shardRequests.length).toBe(published);
});
