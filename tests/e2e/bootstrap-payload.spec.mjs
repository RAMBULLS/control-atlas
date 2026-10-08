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

test("record navigation waits for its own neighborhood and never announces stale absence", async ({ page }) => {
  const firstId = "nist-800-53:AC-2";
  const nextId = "fedramp-2026:IEC-CSO-EFI";
  const nextShard = atlasNeighborhoodShardId(nextId);
  expect(nextShard).not.toBe(atlasNeighborhoodShardId(firstId));
  await page.goto("/#/record/nist-800-53/AC-2");
  await expect(page.locator(`[data-record-content="${firstId}"]`)).toBeVisible();
  let held = false;
  let release = () => {};
  const released = new Promise(resolve => { release = () => resolve(undefined); });
  await page.route(`**/data/generated/atlas-neighborhood/${nextShard}.json*`, async route => {
    held = true;
    await released;
    await route.continue();
  });
  try {
    await page.goto("/#/record/fedramp-2026/IEC-CSO-EFI", { waitUntil: "domcontentloaded" });
    await expect.poll(() => held).toBe(true);
    await expect(page.locator('[data-record-content]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Record not found", exact: true })).toHaveCount(0);
    await expect(page).toHaveTitle("Loading record — Control Atlas");
    await expect(page.locator("#app")).toHaveAttribute("data-app-ready", "false");
    await page.goto("/#/");
    await waitForAppReady(page);
    release();
    await expect(page.locator('[data-record-content]')).toHaveCount(0);
    await page.goto("/#/record/fedramp-2026/IEC-CSO-EFI");
    await expect(page.locator(`[data-record-content="${nextId}"]`)).toBeVisible();
    await expect(page.locator('[data-source-field="discussion"]')).toContainText("All incidents must be assigned a default PAIN-5");
    // Accepted absence still produces the real recovery page.
    await page.goto("/#/record/fedramp-2026/NOT-A-PUBLISHED-RECORD");
    await expect(page.getByRole("heading", { name: "Record not found", exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test("record data requests start before the route import burst after the loader becomes available", async ({ page }) => {
  const requested = [];
  page.on("request", request => requested.push(request.url()));
  let loaderWaiting = false;
  let releaseLoader = () => {};
  const loaderReleased = new Promise(resolve => { releaseLoader = () => resolve(undefined); });
  await page.route(/\/assets\/runtimeLoader-[^/]+\.js$/, async route => {
    loaderWaiting = true;
    await loaderReleased;
    await route.continue();
  });
  const routeScript = url => /\/assets\/(?:App|ObjectDetailPage|record-ui|client)-[^/]+\.js$/.test(url);
  try {
    await page.goto("/#/record/nist-800-53/AC-2", { waitUntil: "domcontentloaded" });
    await expect.poll(() => loaderWaiting).toBe(true);
    expect(requested.filter(routeScript), "UI imports must wait for the data loader module").toEqual([]);
    releaseLoader();
    await expect(page.locator('[data-record-section="official-text"]')).toContainText("Define and document the types of accounts allowed");
    const shardIndex = requested.findIndex(url => /atlas-neighborhood\/[0-9a-f]+\.json\.gz/.test(url));
    const firstUiIndex = requested.findIndex(routeScript);
    expect(shardIndex).toBeGreaterThanOrEqual(0);
    expect(firstUiIndex).toBeGreaterThan(shardIndex);
  } finally {
    releaseLoader();
  }
});

test("returning Home during the initial loader wait never commits the stale record", async ({ page }) => {
  const requested = [];
  page.on("request", request => requested.push(request.url()));
  let loaderWaiting = false;
  let releaseLoader = () => {};
  const loaderReleased = new Promise(resolve => { releaseLoader = () => resolve(undefined); });
  await page.route(/\/assets\/runtimeLoader-[^/]+\.js$/, async route => {
    loaderWaiting = true;
    await loaderReleased;
    await route.continue();
  });
  const loaderResponse = page.waitForResponse(response => /\/assets\/runtimeLoader-[^/]+\.js$/.test(response.url()));
  try {
    await page.goto("/#/record/nist-800-53/AC-2", { waitUntil: "domcontentloaded" });
    await expect.poll(() => loaderWaiting).toBe(true);
    await page.evaluate(() => { globalThis.location.hash = "/"; });
    releaseLoader();
    const response = await loaderResponse;
    expect(response.ok()).toBe(true);
    await page.evaluate(async url => {
      await import(url);
      await new Promise(resolve => setTimeout(resolve, 0));
    }, response.url());
    await waitForAppReady(page);
    await expect(page.locator('[data-static-home]')).toBeVisible();
    await expect(page.locator('[data-record-content]')).toHaveCount(0);
    await expect(page.locator('[data-route-suspense-pending="true"]')).toHaveCount(0);
    expect(requested.filter(url => /atlas-neighborhood|\/assets\/ObjectDetailPage-/.test(url))).toEqual([]);
    await page.getByRole("link", { name: "All records", exact: true }).click();
    await waitForAppReady(page);
    await expect(page).toHaveURL(/#\/library/);
    await expect(page.locator('[data-record-content]')).toHaveCount(0);
  } finally {
    releaseLoader();
  }
});

for (const width of [412, 1440]) {
test(`Resources keeps its identity and heading geometry at ${width}px until the lazy directory is usable`, async ({ page }) => {
  await page.setViewportSize({ width, height: 823 });
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
    await expect(shell.getByRole("navigation", { name: "Resource companions" })).toBeVisible();
    const beforeHeading = await shell.getByRole("heading", { level: 1 }).boundingBox();
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
    const afterHeading = await shell.getByRole("heading", { level: 1 }).boundingBox();
    expect(Math.abs(afterHeading.x - beforeHeading.x), "masthead horizontal handoff").toBeLessThanOrEqual(1);
    expect(Math.abs(afterHeading.y - beforeHeading.y), "masthead vertical handoff").toBeLessThanOrEqual(1);
    expect(Math.abs(afterHeading.height - beforeHeading.height), "masthead height handoff").toBeLessThanOrEqual(1);
    expect(Math.abs(afterHeading.width - beforeHeading.width), "masthead width handoff").toBeLessThanOrEqual(1);
    const companions = page.getByRole("navigation", { name: "Resource companions" });
    await expect(companions).toHaveCount(1);
    const headerBox = await shell.locator("header").boundingBox();
    const searchBox = await page.locator(".workspace-search").boundingBox();
    expect(headerBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    const searchGap = searchBox.y - (headerBox.y + headerBox.height);
    expect(searchGap, "search does not overlap its masthead").toBeGreaterThanOrEqual(0);
    expect(searchGap, "search follows the single masthead").toBeLessThanOrEqual(28);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("searchbox", { name: "Find resources" }).fill("zero trust");
    await page.getByRole("searchbox", { name: "Find resources" }).press("Enter");
    await expect(page).toHaveURL(/q=zero\+trust/);
    await expect(page.getByRole("heading", { name: "Resources", exact: true, level: 1 })).toHaveCount(1);
    await expect(page.getByRole("searchbox", { name: "Find resources" })).toBeFocused();
    await companions.getByRole("link", { name: /Browse Templates/ }).click();
    await expect(shell).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Templates", exact: true, level: 1 })).toBeVisible();
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
}

test("client navigation to Resources retains its complete React masthead", async ({ page }) => {
  await page.goto("/#/guides");
  await waitForAppReady(page);
  await page.locator('.site-header a[href="#/resources"]').click();
  await expect(page.getByRole("searchbox", { name: "Find resources" })).toBeVisible();
  await expect(page.locator("[data-static-route]")).toHaveCount(0);
  await expect(page.locator(".workspace-template > .page-header")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resources", exact: true, level: 1 })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Resource companions" })).toHaveCount(1);
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

test("record commits official content without a whole-tree or Resources download, then supports search", async ({ page }) => {
  const resourceRequests = [];
  let spineRequests = 0;
  page.on("request", request => {
    if (/commons-search-index|commons-resource-dataset/.test(request.url())) resourceRequests.push(request.url());
    if (/atlas-spine/.test(request.url())) spineRequests += 1;
  });
  let releaseRecord = () => {};
  const recordReleased = new Promise(resolve => { releaseRecord = () => resolve(undefined); });
  await page.route(/\/assets\/ObjectDetailPage-[^/]+\.js$/, async route => {
    await recordReleased;
    await route.continue();
  });
  const neighborhood = page.waitForResponse(response => /atlas-neighborhood\/[0-9a-f]+\.json\.gz/.test(response.url()));
  try {
    await page.goto("/#/record/nist-800-53/AC-2", { waitUntil: "domcontentloaded" });
    await neighborhood;
    await expect(page.locator('[data-route-suspense-pending="true"]')).toHaveCount(1);
    expect(spineRequests).toBe(0);
    releaseRecord();
    await expect(page.locator('[data-record-content="nist-800-53:AC-2"]')).toHaveAttribute("data-record-context-ready", "true");
    await expect(page.locator('[data-record-content="nist-800-53:AC-2"]')).toHaveAttribute("data-record-commit", /^\d+$/);
    await expect(page.locator('[data-record-section="official-text"]')).toContainText("Define and document the types of accounts allowed");
    expect(spineRequests, "the complete record authority chain needs no whole-tree download").toBe(0);
    expect(resourceRequests, "a closed-search record needs no Resources payload").toEqual([]);
    const coldTransfer = await page.evaluate(() => {
      const entries = /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType("resource"));
      return {
        totalEncodedBytes: entries.reduce((total, entry) => total + entry.encodedBodySize, 0),
        recordArtifacts: entries.filter(entry => /atlas-neighborhood/.test(entry.name))
          .map(entry => ({ path: new URL(entry.name).pathname, encodedBytes: entry.encodedBodySize })),
      };
    });
    console.log(`[record-cold-transfer] ${JSON.stringify(coldTransfer)}`);
    expect(coldTransfer.recordArtifacts).toHaveLength(2);
    expect(coldTransfer.recordArtifacts.every(entry => entry.encodedBytes > 0)).toBe(true);
    await page.getByRole("button", { name: "Open search" }).click();
    await page.getByRole("searchbox", { name: "Search Control Atlas" }).fill("NISTControls");
    await expect(page.getByRole("link", {
      name: "Reddit /r/NISTControls Practitioner Community", exact: true,
    })).toBeVisible();
    expect(resourceRequests.some(url => url.includes("commons-search-index"))).toBe(true);
    expect(resourceRequests.some(url => url.includes("commons-resource-dataset"))).toBe(true);
  } finally {
    releaseRecord();
  }
});

test("a fulfilled record warm-up renders accepted text without another route fallback", async ({ page }) => {
  let releaseData = () => {};
  const dataReleased = new Promise(resolve => { releaseData = () => resolve(undefined); });
  await page.route("**/data/generated/atlas-neighborhood/*.json*", async route => {
    await dataReleased;
    await route.continue();
  });
  const moduleResponse = page.waitForResponse(response =>
    /\/assets\/ObjectDetailPage-[^/]+\.js$/.test(new URL(response.url()).pathname),
  );
  try {
    await page.goto("/#/record/nist-800-53/AC-2", { waitUntil: "domcontentloaded" });
    const response = await moduleResponse;
    expect(response.ok()).toBe(true);
    // Await evaluation of the exact module warmed by the entry, including its
    // dependencies. A completed network response alone does not prove readiness.
    await page.evaluate(async url => {
      await import(url);
      await new Promise(resolve => setTimeout(resolve, 0));
    }, response.url());
    await page.evaluate(() => {
      const marker = '[data-route-suspense-pending="true"]';
      const observe = () => {
        if (document.querySelector(marker)) document.documentElement.dataset.recordFallbackObserved = "true";
      };
      observe();
      const observer = new MutationObserver(records => {
        // Inspect removed nodes too: a fallback inserted and removed in one
        // browser task must still fail this contract.
        for (const record of records) {
          for (const node of [...record.addedNodes, ...record.removedNodes]) {
            if (node instanceof Element && (node.matches(marker) || node.querySelector(marker))) {
              document.documentElement.dataset.recordFallbackObserved = "true";
            }
          }
        }
        observe();
      });
      const root = document.getElementById("root");
      if (!root) throw new Error("Record root is missing");
      observer.observe(root, { childList: true, subtree: true });
      document.addEventListener("test:stop-record-fallback-observation", () => observer.disconnect(), { once: true });
    });
    releaseData();
    const record = page.locator('[data-record-content="nist-800-53:AC-2"]');
    const published = page.locator('[data-record-section="official-text"]');
    await expect(published).toBeVisible();
    await expect(published).toContainText("Define and document the types of accounts allowed");
    const acceptedText = await published.textContent();
    const acceptedCommit = await record.getAttribute("data-record-commit");
    expect(acceptedCommit).toMatch(/^\d+$/);
    const acceptedNode = await published.elementHandle();
    await expect(record).toHaveAttribute("data-record-context-ready", "true");
    await expect(record).toHaveAttribute("data-record-commit", acceptedCommit);
    expect(await published.textContent()).toBe(acceptedText);
    expect(await acceptedNode.evaluate(node => node === document.querySelector('[data-record-section="official-text"]'))).toBe(true);
    await acceptedNode.dispose();
    await expect(page.locator("html")).not.toHaveAttribute("data-record-fallback-observed", "true");
    await expect(page.locator('[data-route-suspense-pending="true"]')).toHaveCount(0);
  } finally {
    releaseData();
    await page.evaluate(() => document.dispatchEvent(new Event("test:stop-record-fallback-observation")));
  }
});

test("a failed required record source can retry without inventing official text", async ({ page }) => {
  let failContext = true;
  let releaseRetry = () => {};
  const retryReleased = new Promise(resolve => { releaseRetry = () => resolve(undefined); });
  let observeRetry = () => {};
  const retryRequested = new Promise(resolve => { observeRetry = () => resolve(undefined); });
  await page.route("**/data/generated/atlas-neighborhood/*.json*", async route => {
    if (failContext) await route.abort();
    else {
      observeRetry();
      await retryReleased;
      await route.continue();
    }
  });
  await page.goto("/#/record/nist-800-53/AC-2");
  const published = page.locator('[data-record-section="official-text"]');
  await expect(page.getByText("Unable to load data", { exact: true })).toBeVisible();
  await expect(published).toHaveCount(0);
  failContext = false;
  const recoveredRecord = page.waitForResponse(response => /atlas-neighborhood\/[0-9a-f]+\.json\.gz/.test(response.url()) && response.status() === 200);
  await page.getByRole("button", { name: "Try loading again" }).click();
  await retryRequested;
  await expect(published).toHaveCount(0);
  releaseRetry();
  await recoveredRecord;
  await expect(page.getByText("Unable to load data", { exact: true })).toHaveCount(0);
  await expect(published).toBeVisible();
  await expect(published).toContainText("Define and document the types of accounts allowed");
});

test("a bounded render handoff failure retains accepted record text during retry", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.id = "test-delayed-record-visibility";
      style.textContent = "[data-record-content] { visibility: hidden !important; }";
      document.head.append(style);
    }, { once: true });
  });
  await page.goto("/#/record/nist-800-53/AC-2");
  const record = page.locator('[data-record-content="nist-800-53:AC-2"]');
  const published = page.locator('[data-record-section="official-text"]');
  await expect(published).toBeAttached();
  const acceptedText = await published.textContent();
  await page.clock.fastForward(12_100);
  await expect(page.locator("[data-record-context-error]")).toBeAttached();
  await page.evaluate(() => document.getElementById("test-delayed-record-visibility").remove());
  await expect(published).toBeVisible();
  const acceptedCommit = await record.getAttribute("data-record-commit");
  let releaseRetry = () => {};
  const retryReleased = new Promise(resolve => { releaseRetry = () => resolve(undefined); });
  let observeRetry = () => {};
  const retryRequested = new Promise(resolve => { observeRetry = () => resolve(undefined); });
  await page.route("**/data/generated/atlas-neighborhood/*.json*", async route => {
    observeRetry();
    await retryReleased;
    await route.continue();
  });
  try {
    await page.locator("[data-record-context-error]").getByRole("button", { name: "Try loading again" }).click();
    await retryRequested;
    await expect(published).toBeVisible();
    expect(await published.textContent()).toBe(acceptedText);
    await expect(record).toHaveAttribute("data-record-commit", acceptedCommit);
    releaseRetry();
    await expect(record).toHaveAttribute("data-record-context-ready", "true");
    await expect(page.locator("[data-record-context-error]")).toHaveCount(0);
    expect(await published.textContent()).toBe(acceptedText);
  } finally {
    releaseRetry();
  }
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
      /\/assets\/(?:AtlasTerritoryPage|ExplorePage|ComparePage|TemplatesPage|SourcesPage|CatalogDetailPage|ObjectDetailPage|CommonsPage|PlaybooksPage|AboutPage)-/,
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
