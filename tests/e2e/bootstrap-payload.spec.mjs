import { expect, test } from "@playwright/test";
import { atlasNeighborhoodShardId } from "../../src/app/atlas-neighborhood.mjs";

import {
  attachPageDiagnostics,
  clickAtlasPublication,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

function graphArtifactUrls(urls) {
  return urls.filter(
    (url) => url.includes("nodes.json") || url.includes("edges.json"),
  );
}

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("Resources keeps its identity until the lazy directory is usable", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 823 });
  await page.clock.install();
  let releaseDirectory = () => {};
  const directoryReleased = new Promise(resolve => { releaseDirectory = () => resolve(undefined); });
  await page.route(/\/assets\/CommonsPage-[^/]+\.js$/, async route => {
    await directoryReleased;
    await route.continue();
  });
  try {
    await page.goto("/#/resources");
    const shell = page.locator("[data-static-route]");
    await expect(shell).toBeVisible();
    await expect(shell.getByRole("heading", { level: 1 })).toHaveText("Resources");
    await expect(page.locator('[data-route-suspense-pending="true"]')).toHaveCount(1);
    await expect(page.locator('[data-route-suspense-pending="true"]')).not.toBeVisible();
    await page.clock.fastForward(16_000);
    await expect(page.locator("#root")).not.toHaveAttribute("data-route-hydrated", "true");
    releaseDirectory();
    await expect(page.locator("#root")).toHaveAttribute("data-route-hydrated", "true");
    await expect(page.getByRole("heading", { name: "Resources", exact: true, level: 1 })).toHaveCount(1);
    await expect(shell).not.toHaveAttribute("role", "status");
    await expect(page.getByRole("searchbox", { name: "Find resources" })).toBeVisible();
    await expect(page.getByRole("main", { name: "Resources" })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("searchbox", { name: "Find resources" }).fill("zero trust");
    await page.getByRole("searchbox", { name: "Find resources" }).press("Enter");
    await expect(page).toHaveURL(/q=zero\+trust/);
    await expect(page.getByRole("heading", { name: "Resources", exact: true, level: 1 })).toHaveCount(1);
    await expect(page.getByRole("searchbox", { name: "Find resources" })).toBeFocused();
    await page.locator('#workspace a[href="#/guides"]').first().click();
    await expect(shell).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Guides", exact: true })).toBeVisible();
    await expect(page.locator("#workspace")).not.toHaveAttribute("aria-labelledby", "static-route-title");
    await page.locator('.site-header a[href="#/resources"]').click();
    await expect(shell.getByRole("heading", { level: 1 })).toBeFocused();
    await page.goBack();
    await expect(shell).not.toBeVisible();
    await page.goBack();
    await expect(shell).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Find resources" })).toHaveValue("zero trust");
    await expect(page.getByRole("heading", { name: "Resources", exact: true, level: 1 })).toHaveCount(1);
  } finally {
    releaseDirectory();
  }
});

test("Resources exposes recovery when a delayed page module fails", async ({ page }) => {
  await page.clock.install();
  let releaseDirectory = () => {};
  const directoryReleased = new Promise(resolve => { releaseDirectory = () => resolve(undefined); });
  await page.route(/\/assets\/CommonsPage-[^/]+\.js$/, async route => {
    await directoryReleased;
    await route.abort();
  });
  try {
    await page.goto("/#/resources");
    await expect(page.locator('[data-route-suspense-pending="true"]')).toHaveCount(1);
    await page.clock.fastForward(16_000);
    releaseDirectory();
    await expect(page.getByText("This workspace stopped unexpectedly. The rest of Control Atlas is still available.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try loading again" })).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("data-route-hydrated", "true");
  } finally {
    releaseDirectory();
  }
});

test("record supporting information can retry while preserving usable source text", async ({ page }) => {
  let failContext = true;
  let releaseRetry = () => {};
  const retryReleased = new Promise(resolve => { releaseRetry = () => resolve(undefined); });
  let observeRetry = () => {};
  const retryRequested = new Promise(resolve => { observeRetry = () => resolve(undefined); });
  await page.route("**/data/generated/atlas-spine.json*", async route => {
    if (failContext) await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    else {
      observeRetry();
      await retryReleased;
      await route.continue();
    }
  });
  await page.goto("/#/record/nist-800-53/AC-2");
  const published = page.locator('[data-record-section="official-text"]');
  await expect(published).toBeVisible();
  const originalText = await published.innerText();
  expect(originalText).toContain("Define and document the types of accounts allowed");
  await expect(page.locator("[data-record-context-error]")).toBeVisible();
  failContext = false;
  const recoveredSpine = page.waitForResponse(response => response.url().includes("atlas-spine.json.gz") && response.status() === 200);
  await page.locator("[data-record-context-error]").getByRole("button", { name: "Try loading again" }).click();
  await retryRequested;
  await expect(published).toBeVisible();
  await expect(published).toHaveText(originalText, { useInnerText: true });
  releaseRetry();
  await recoveredSpine;
  await expect(page.locator("[data-record-context-error]")).toHaveCount(0);
  await expect(published).toHaveText(originalText, { useInnerText: true });
});

test("home bootstrap avoids graph JSON artifacts", async ({ page }) => {
  const requested = [];
  const scripts = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/data/generated/")) {
      requested.push(url);
    }
    if (request.resourceType() === "script") scripts.push(url);
  });

  await page.goto("/");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  expect(graphArtifactUrls(requested)).toEqual([]);
  expect(requested).toEqual([]);
  // Home requests no route or graph payload until the reader leaves the static
  // front door, and its script graph stays small: the shell that sets route
  // identity before first paint, the deferred interactive entry, and the
  // shared chunks that entry pulls in.
  //
  // This asserted exactly two scripts. The bundler now emits its runtime and
  // the shared header data as their own chunks, so main has been loading four
  // for some time and this test has been red on main without anyone seeing it
  // — it is not in test:e2e:smoke, so CI never runs it on a pull request. A
  // fixed count tracks the bundler's chunking, not the thing worth protecting.
  // The budget is what protects Home: no route chunk, no page code.
  expect(scripts.length, `Home loaded ${scripts.length} scripts: ${scripts.join(", ")}`).toBeLessThanOrEqual(4);
  for (const script of scripts) {
    expect(script, "Home must not load a route chunk").not.toMatch(
      /\/assets\/(?:AtlasTerritoryPage|ExplorePage|ComparePage|TemplatesPage|SourcesPage|CatalogDetailPage|ObjectDetailPage|CommonsPage|PlaybooksPage|AboutPage|StartHerePage)-/,
    );
  }

  await page.getByRole("link", { name: "All records", exact: true }).click();
  await waitForAppReady(page);
  await expect(page).toHaveURL(/#\/library/);
  expect(scripts.length).toBeGreaterThan(1);
});

test("explore bootstrap avoids graph JSON until record open", async ({
  page,
}) => {
  const requested = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/data/generated/")) {
      requested.push(url);
    }
  });

  await page.goto("/?view=explore&q=AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(
    page.locator("#library-results .workspace-result-row").first(),
  ).toBeVisible({
    timeout: 15000,
  });

  expect(graphArtifactUrls(requested)).toEqual([]);

  const openDetail = page
    .locator("#library-results .workspace-result-row__link")
    .first();
  await expect(openDetail).toBeEnabled({ timeout: 15000 });
  await openDetail.click();
  await expect(page).toHaveURL(/library-detail|record\//);
  await waitForAppReady(page);
  // Re-baselined 2026-08-01: records now carry their own path to the trunk
  // (attachAncestorPaths in scripts/build-framework-data.mjs), so opening one
  // no longer needs the monolithic graph at all. The budget only tightened.
  expect(graphArtifactUrls(requested)).toEqual([]);
});

test("the Atlas territory sheet uses its own small index without monolithic graph JSON", async ({
  page,
}) => {
  const requested = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/data/generated/")) requested.push(url);
  });

  await page.goto("/#/atlas");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const sheet = page.locator(".terr");
  await expect(sheet).toBeVisible();
  expect(requested.some((url) => url.includes("atlas-territory"))).toBeTruthy();
  expect(requested.some((url) => /atlas-network|atlas-spine|atlas-research\//.test(url))).toBe(false);
  expect(graphArtifactUrls(requested)).toEqual([]);

  // Opening a territory and then a publication inside it needs no further artifact.
  await sheet.locator('[data-district="atlas:LIMB-COMPLIANCE"] .district__shape').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/atlasLimb=/);
  await clickAtlasPublication(page, "nist-800-53");
  await expect(page).toHaveURL(/atlasFramework=nist-800-53/);
  expect(graphArtifactUrls(requested)).toEqual([]);
});

test("Atlas reaches its first usable source map within the local render budget", async ({
  page,
}) => {
  await page.goto("/#/atlas");
  await waitForAppReady(page);
  await expect(page.locator(".terr")).toBeVisible();

  const firstUsableMs = await page.evaluate(() =>
    Math.round(globalThis.performance.now()),
  );
  console.log(`[atlas-perf] first usable source map: ${firstUsableMs} ms`);
  expect(firstUsableMs).toBeLessThan(5_000);
});

test("focused Atlas loads one neighborhood without monolithic graph JSON", async ({
  page,
}) => {
  const requested = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/data/generated/")) requested.push(url);
  });

  await page.goto(
    "/#/explore?node=nist-800-53%3AAC-2&relationshipView=map",
  );
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator(".atl-inspector")).toContainText("AC-2", { timeout: 20000 });
  await expect(page.locator(".terr")).toBeVisible();

  expect(graphArtifactUrls(requested)).toEqual([]);
  expect(
    requested.some((url) => url.includes(`atlas-neighborhood/${atlasNeighborhoodShardId("nist-800-53:AC-2")}.json`)),
  ).toBeTruthy();
});

test("focused Atlas loading state avoids a content-agnostic mobile minimum height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 823 });
  let releaseNeighborhood = () => {};
  const neighborhoodGate = new Promise((resolve) => {
    releaseNeighborhood = () => resolve();
  });

  await page.route(`**/data/generated/atlas-neighborhood/${atlasNeighborhoodShardId("nist-800-53:AC-2")}.json*`, async (route) => {
    await neighborhoodGate;
    await route.continue();
  });

  await page.goto(
    "/#/explore?node=nist-800-53%3AAC-2&relationshipView=map",
  );
  await expect(page.locator("#app")).toHaveAttribute("data-has-subject", "true");
  // Re-baselined 2026-08-01: with the record's shard gated, the wait now
  // happens in the loader, so the shared skeleton holds the surface rather
  // than the page-level .atlas-loading block. The guarantee is unchanged —
  // whatever is shown while loading must be sized to its content, not to a
  // fixed viewport-height minimum.
  await expect
    .poll(() =>
      page
        .locator("#app")
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(0);
  const loadingHeight = await page.locator("#app").evaluate(
    (element) => element.getBoundingClientRect().height,
  );

  releaseNeighborhood();
  await expect(page.locator("#atl-focus")).toContainText("AC-2", {
    timeout: 30000,
  });
  const loadedHeight = await page.locator("#app").evaluate(
    (element) => element.getBoundingClientRect().height,
  );

  expect(loadingHeight).toBeLessThanOrEqual(823);
  expect(loadedHeight).toBeGreaterThan(loadingHeight);
});

test("catalog identity renders before its full record payload arrives", async ({
  page,
}) => {
  let releaseRecords = () => {};
  const recordsGate = new Promise((resolve) => {
    releaseRecords = () => resolve();
  });

  await page.route(
    "**/data/generated/catalog-records/nist-800-53.json*",
    async (route) => {
      await recordsGate;
      await route.continue();
    },
  );

  await page.goto("/#/catalog/nist-800-53");
  await expect(
    page.getByRole("heading", { level: 1, name: "SP 800-53 Rev. 5" }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("Loading this publication's records…")).toBeVisible();

  releaseRecords();
  await expect(page.getByText("Loading this publication's records…")).toBeHidden({
    timeout: 15000,
  });
  await expect(page.locator("#catalog-records-title")).toContainText(
    "SP 800-53 Rev. 5",
  );
});
