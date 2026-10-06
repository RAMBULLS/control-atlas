import { expect, test } from "@playwright/test";
import { AxeBuilder } from '@axe-core/playwright';
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

async function declaredNeighborhoodPath(page, nodeId) {
  const response = await page.request.get("/data/generated/atlas-neighborhood-manifest.json");
  expect(response.ok()).toBeTruthy();
  const { atlas_neighborhood_manifest: manifest } = await response.json();
  expect(Number.isInteger(manifest.shard_count) && manifest.shard_count > 0).toBeTruthy();
  const shardId = atlasNeighborhoodShardId(nodeId, manifest.shard_count);
  const shard = manifest.shards.find((entry) => entry.shard_id === shardId);
  expect(shard).toBeTruthy();
  return shard.path;
}

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
test(`complete publisher text is readable with React held and retains its node through enhancement at ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport);
  let release = () => {};
  const framework = new Promise(resolve => { release = () => resolve(undefined); });
  await page.route(/\/assets\/(?:react(?:-dom)?|client|App|ObjectDetailPage)-[^/]+\.js$/, async route => {
    await framework;
    await route.continue();
  });
  const cohorts = [];
  page.on('response', response => {
    if (/\/atlas-neighborhood\/[^/]+\.json\.gz\?/.test(response.url())) cohorts.push(response.url());
  });
  try {
    await page.goto('/#/record/nist-800-53/AC-2', { waitUntil: 'domcontentloaded' });
    const source = page.locator('[data-publisher-reader] [data-source-text="published"]');
    await expect(source).toBeVisible();
    const shardPath = await declaredNeighborhoodPath(page, 'nist-800-53:AC-2');
    const expected = await page.request.get(`/data/generated/${shardPath}`);
    expect(expected.ok()).toBeTruthy();
    const artifact = await expected.json();
    const description = artifact.atlas_neighborhood_shard.records['nist-800-53:AC-2'].center_node.metadata.description;
    expect((await source.locator('[data-source-field="description"]').innerText()).replace(/^Control statement\s*/i, '').replace(/\s+/g, ' ').trim())
      .toContain(description.replace(/\s+/g, ' ').trim());
    await expect(page.locator('[data-react-root] #app')).toHaveCount(0);
    await expect(page.getByRole('main')).toHaveCount(1);
    await page.evaluate(() => Reflect.get(globalThis, 'controlAtlasRecordReader').ready);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    const accessibility = await new AxeBuilder({ page }).include('[data-publisher-reader]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
    const before = await source.boundingBox();
    const geometry = () => [...globalThis.document.querySelectorAll('[data-static-route], #workspace, .canonical-breadcrumb, .record-title-block, .record-section-nav, [data-source-text]')].filter(element => element.getClientRects().length > 0).map(element => {
      const box = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      return { element: element.className || element.id, x: box.x, y: box.y, width: box.width, height: box.height, padding: style.padding, margin: style.margin, font: style.font };
    });
    const beforeLayout = await page.evaluate(geometry);
    await page.screenshot({ path: test.info().outputPath('reader-before.png') });
    await page.evaluate(() => {
      const root = globalThis.document.querySelector('[data-publisher-reader] [data-source-text="published"]');
      const paragraph = root?.querySelector('[data-source-field="description"] p');
      const range = globalThis.document.createRange();
      if (!paragraph) throw new Error('Complete publisher paragraph is unavailable.');
      range.selectNodeContents(paragraph);
      const selection = globalThis.getSelection();
      selection?.removeAllRanges(); selection?.addRange(range);
      Reflect.set(globalThis, 'publisherSelectedText', selection?.toString());
      const focus = root?.querySelector('a') || paragraph;
      focus?.setAttribute('tabindex', '0');
      if (focus instanceof globalThis.HTMLElement) focus.focus({ preventScroll: true });
      Reflect.set(globalThis, 'publisherFocusProbe', focus);
    });
    await page.evaluate(() => Reflect.set(globalThis, 'publisherTextProbe', globalThis.document.querySelector('[data-publisher-reader] [data-source-text="published"]')));
    release();
    await waitForAppReady(page);
    await expect(page.locator('[data-static-route]')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(globalThis, 'publisherTextProbe') === globalThis.document.querySelector('[data-react-root] [data-source-text="published"]'))).toBe(true);
    expect(cohorts).toHaveLength(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    expect(await page.evaluate(() => globalThis.getSelection()?.toString() === Reflect.get(globalThis, 'publisherSelectedText'))).toBe(true);
    await expect.poll(() => page.evaluate(() => globalThis.document.activeElement === Reflect.get(globalThis, 'publisherFocusProbe'))).toBe(true);
    const after = await page.locator('[data-react-root] [data-source-text="published"]').boundingBox();
    const afterLayout = await page.evaluate(geometry);
    await test.info().attach('reader-layout', { body: JSON.stringify({ before: beforeLayout, after: afterLayout }), contentType: 'application/json' });
    console.log('[reader-layout]', JSON.stringify({ before: beforeLayout, after: afterLayout }));
    await page.screenshot({ path: test.info().outputPath('reader-after.png') });
    expect(Math.abs((before?.width || 0) - (after?.width || 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((before?.y || 0) - (after?.y || 0))).toBeLessThanOrEqual(1);
  } finally { release(); }
});
}

test('publisher reading survives unavailable enhancement and clears on history navigation', async ({ page }) => {
  await page.route(/\/assets\/App-[^/]+\.js$/, route => route.abort());
  await page.goto('/#/record/nist-800-53/AC-2', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-publisher-reader] [data-source-field="description"]')).toBeVisible();
  await expect(page.locator('[data-publisher-reader]')).toContainText('Published text remains available');
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.evaluate(() => {
    globalThis.history.pushState(null, '', '#/resources');
    globalThis.dispatchEvent(new globalThis.Event('popstate'));
  });
  await expect(page.locator('[data-publisher-reader] [data-source-text]')).toHaveCount(0);
  await expect(page.locator('[data-publisher-reader] h1')).toHaveCount(0);
});

test('publisher reading retries a failed cohort through the existing source cache', async ({ page }) => {
  let release = () => {};
  const framework = new Promise(resolve => { release = () => resolve(undefined); });
  await page.route(/\/assets\/(?:react(?:-dom)?|client|App|ObjectDetailPage)-[^/]+\.js$/, async route => { await framework; await route.continue(); });
  let fail = true;
  await page.route(/\/data\/generated\/atlas-neighborhood\/[^/]+\.json(?:\.gz)?\?/, route => fail ? route.abort() : route.continue());
  try {
    await page.goto('/#/record/nist-800-53/AC-2', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-publisher-reader]')).toHaveAttribute('data-reader-state', 'error');
    await expect(page.locator('[data-publisher-reader] [data-source-text]')).toHaveCount(0);
    fail = false;
    await page.locator('[data-publisher-reader]').getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('[data-publisher-reader] [data-source-field="description"]')).toBeVisible();
    release();
    await waitForAppReady(page);
    await expect(page.locator('[data-react-root] [data-source-field="description"]')).toBeVisible();
  } finally { release(); }
});

test('publisher reading retires an old record immediately during rapid navigation', async ({ page }) => {
  let release = () => {};
  const framework = new Promise(resolve => { release = () => resolve(undefined); });
  await page.route(/\/assets\/(?:react(?:-dom)?|client|App|ObjectDetailPage)-[^/]+\.js$/, async route => { await framework; await route.continue(); });
  try {
    await page.goto('/#/record/nist-800-53/AC-2', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-publisher-reader] [data-record-content="nist-800-53:AC-2"]')).toBeVisible();
    await page.evaluate(() => { globalThis.location.hash = '#/record/csf-2/PR.AA-01'; });
    await expect(page.locator('[data-publisher-reader] [data-record-content="nist-800-53:AC-2"]')).toHaveCount(0);
    await expect(page.locator('[data-publisher-reader] [data-record-content="csf-2:PR.AA-01"]')).toBeVisible();
    release();
    await waitForAppReady(page);
    await expect(page.locator('[data-react-root] [data-record-content="csf-2:PR.AA-01"]')).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
  } finally { release(); }
});

test('React header navigation retires publisher reading while the detail enhancer is withheld', async ({ page }) => {
  let release = () => {};
  const detail = new Promise(resolve => { release = () => resolve(undefined); });
  await page.route(/\/assets\/ObjectDetailPage-[^/]+\.js$/, async route => { await detail; await route.continue(); });
  try {
    await page.goto('/#/record/nist-800-53/AC-2', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-publisher-reader] [data-source-text]')).toBeVisible();
    const resources = page.locator('[data-react-root] header').getByRole('link', { name: 'Resources', exact: true });
    await expect(resources).toBeVisible();
    await resources.click();
    await expect(page).toHaveURL(/#\/resources/);
    await expect(page.locator('[data-publisher-reader] [data-source-text]')).toHaveCount(0);
    await waitForAppReady(page);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.locator('[data-react-root] [data-record-content]')).toHaveCount(0);
  } finally { release(); }
});

for (const [catalog, item] of [['disa-stig', 'V-256609'], ['microsoft-zt-maturity', 'MSZT-1-1'], ['nist-zt', 'SP180035-E1B1']]) {
  test(`publisher reading retains complete primary fields for ${catalog} through enhancement`, async ({ page }) => {
    let release = () => {};
    const framework = new Promise(resolve => { release = () => resolve(undefined); });
    await page.route(/\/assets\/(?:react(?:-dom)?|client|App|ObjectDetailPage)-[^/]+\.js$/, async route => { await framework; await route.continue(); });
    try {
      await page.goto(`/#/record/${catalog}/${item}`, { waitUntil: 'domcontentloaded' });
      const owned = page.locator('[data-publisher-reader] [data-publisher-fields-owned]');
      await expect(owned.locator('[data-source-text]')).toBeVisible();
      await page.evaluate(() => Reflect.get(globalThis, 'controlAtlasRecordReader').ready);
      const complete = await owned.innerText();
      const heading = await page.getByRole('heading', { level: 1 }).innerText();
      expect(complete.length).toBeGreaterThan(0);
      release();
      await waitForAppReady(page);
      expect(await page.locator('[data-react-root] [data-publisher-fields-owned]').innerText()).toBe(complete);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await expect(page.getByRole('main')).toHaveCount(1);
    } finally { release(); }
  });
}

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

test("record source acquisition starts before the interactive entry is available", async ({ page }) => {
  let releaseEntry = () => {};
  const entryGate = new Promise((resolve) => { releaseEntry = () => resolve(undefined); });
  await page.route("**/assets/index-*.js", async (route) => {
    await entryGate;
    await route.continue();
  });
  const cohorts = [];
  const scripts = [];
  page.on("request", (request) => {
    if (/\/data\/generated\/atlas-neighborhood\/[a-f0-9]+\.json\.gz\?/.test(request.url())) cohorts.push(request.url());
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  try {
    await page.goto("/#/record/nist-800-53/AC-2", { waitUntil: "commit" });
    await expect.poll(() => cohorts.length).toBe(1);
    expect(scripts.some((url) => /\/assets\/(?:App|ObjectDetailPage|client)-/.test(url))).toBe(false);
  } finally {
    releaseEntry();
  }
  await expect(page.locator(".source-text-blocks p").first()).toContainText("Define and document");
  expect(cohorts).toHaveLength(1);
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
  const neighborhoodPath = await declaredNeighborhoodPath(page, "nist-800-53:AC-2");
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
    requested.some((url) => url.includes(neighborhoodPath)),
  ).toBeTruthy();
});

test("focused Atlas loading state avoids a content-agnostic mobile minimum height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 823 });
  const neighborhoodPath = await declaredNeighborhoodPath(page, "nist-800-53:AC-2");
  let neighborhoodIntercepted = false;
  let releaseNeighborhood = () => {};
  const neighborhoodGate = new Promise((resolve) => {
    releaseNeighborhood = () => resolve();
  });

  await page.route(`**/data/generated/${neighborhoodPath}*`, async (route) => {
    neighborhoodIntercepted = true;
    await neighborhoodGate;
    await route.continue();
  });

  let loadingHeight;
  try {
    await page.goto(
      "/#/explore?node=nist-800-53%3AAC-2&relationshipView=map",
    );
    await expect(page.locator("#app")).toHaveAttribute("data-has-subject", "true");
    await expect.poll(() => neighborhoodIntercepted).toBeTruthy();
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
    loadingHeight = await page.locator("#app").evaluate(
      (element) => element.getBoundingClientRect().height,
    );
  } finally {
    releaseNeighborhood();
  }
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
