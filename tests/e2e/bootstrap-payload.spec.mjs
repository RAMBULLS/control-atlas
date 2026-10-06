import { expect, test } from "@playwright/test";

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

test("record source hints reuse the initial transfers before page code loads", async ({ page }) => {
  const names = ["sources.json", "catalog-bootstrap.json", "atlas-neighborhood-manifest.json"];
  const responses = [];
  page.on("response", (response) => {
    if (names.some((name) => response.url().includes(`/data/generated/${name}.gz?`))) {
      responses.push(response.url());
    }
  });
  await page.goto("/#/record/nist-800-53/AC-2");
  await expect(page.locator(".source-text-blocks p").first()).toBeVisible();
  const evidence = await page.evaluate((initialNames) => {
    const version = globalThis.document.querySelector('meta[name="control-atlas-runtime-cache-version"]').getAttribute("content");
    const entries = globalThis.performance.getEntriesByType("resource");
    const pageCode = entries.find((entry) => /\/assets\/ObjectDetailPage-/.test(entry.name));
    return initialNames.map((name) => {
      const url = new URL(`./data/generated/${name}.gz`, globalThis.document.baseURI);
      url.searchParams.set("v", version);
      return {
        url: url.href,
        hinted: !!globalThis.document.querySelector(`link[rel="preload"][as="fetch"][href="${url.href}"]`),
        early: entries.some((entry) => entry.name === url.href && entry.startTime < pageCode.startTime),
      };
    });
  }, names);
  for (const artifact of evidence) {
    expect(artifact.hinted).toBe(true);
    expect(artifact.early).toBe(true);
    expect(responses.filter((url) => url === artifact.url), artifact.url).toHaveLength(1);
  }
});

test("a failed hinted compressed source retains the plain source fallback", async ({ page }) => {
  const plain = [];
  page.on("response", (response) => {
    if (/\/data\/generated\/sources\.json\?/.test(response.url()) && response.ok()) {
      plain.push(response.url());
    }
  });
  await page.route("**/data/generated/sources.json.gz*", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/#/record/nist-800-53/AC-2");
  await expect(page.locator(".source-text-blocks p").first()).toContainText("Define and document");
  await expect(page.locator("[data-route-render-error]")).toHaveCount(0);
  expect(plain).toHaveLength(1);
});

test("record code hints reuse emitted modules and styles without other route chunks", async ({ page }) => {
  const responses = [];
  page.on("response", (response) => {
    if (response.url().includes("/assets/")) responses.push(response.url());
  });
  await page.goto("/#/record/nist-800-53/AC-2");
  await expect(page.locator(".source-text-blocks p").first()).toBeVisible();
  const hints = await page.evaluate(() => {
    const manifest = JSON.parse(globalThis.document.getElementById("control-atlas-record-modules").textContent);
    return [...manifest.modules, ...manifest.styles].map((href) => new URL(href, globalThis.document.baseURI).href);
  });
  expect(hints.length).toBeGreaterThan(0);
  for (const href of hints) {
    expect(href).not.toMatch(/\/assets\/(?!ObjectDetailPage-)[\w]+Page-/);
    expect(responses.filter((url) => url === href), href).toHaveLength(1);
  }
  for (const url of responses) expect(url).not.toMatch(/\/assets\/(?!ObjectDetailPage-)[\w]+Page-/);
  await expect(page.locator('link[rel="modulepreload"][href*="ObjectDetailPage-"]')).toHaveCount(1);
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
    requested.some((url) => url.includes("atlas-neighborhood/32.json")),
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

  await page.route("**/data/generated/atlas-neighborhood/32.json*", async (route) => {
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
