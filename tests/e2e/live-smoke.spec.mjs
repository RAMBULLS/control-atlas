import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";
import { RUNTIME_CACHE_VERSION } from "../../src/shared/runtime-cache-version.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("live smoke: current Home contract and AC-2 record path", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  if (process.env.PLAYWRIGHT_BASE_URL) {
    expect(page.url()).toContain("/control-atlas/");
  }
  await expect(
    page.getByRole("heading", {
      name: "Make federal cybersecurity make sense.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search Control Atlas" })).toBeVisible();
  await expect(page.locator(".home-search").getByRole("button", { name: "Search" })).toBeVisible();
  await expect(page.locator(".home-tools .home-tool")).toHaveCount(3);
  await expect(page.locator(".site-header .brand-key-word")).toBeVisible();
  await expect(page.locator(".home-lead")).toContainText(
    "trace where requirements come from, see how they relate, and know what to do next.",
  );
  await expect(page.locator(".home-library__list .home-library__item")).toHaveCount(5);
  await expect(page.locator(".home-trust-boundary")).toHaveCount(0);

  await gotoApp(page, "/#/library?q=AC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const controlResult = page.locator('[data-record-id="nist-800-53:AC-2"]');
  await expect(controlResult).toBeVisible({ timeout: 30000 });
  await controlResult.locator(".workspace-result-row__link").click();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator('[data-template="E"]')).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("heading", { name: "NIST AC-2", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Control Statement", exact: true })).toBeVisible();
  await expect(page.locator('[data-editorial-boundary="explicit"]')).toHaveCount(0);
  const officialSource = page.getByRole("link", {
    name: "View official source",
    exact: true,
  });
  await expect(officialSource).toHaveCount(1);
  await expect(officialSource).toBeVisible();
});

test("live smoke: Resources and Atlas workbench are first-class routes", async ({ page }) => {
  await gotoApp(page, "/#/resources?q=OSCAL");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page).toHaveURL(/#\/resources\?q=OSCAL/);
  await expect(page.getByRole("heading", { name: "Resources", level: 1 })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Find resources" })).toHaveValue("OSCAL");
  await expect(page.locator(".workspace-result-row--resource").first()).toBeVisible();

  // An old bookmarked landing URL must still resolve into the Territory Edition.
  await gotoApp(page, "/#/atlas?atlasLanding=publishers");
  await waitForAppReady(page);
  const territoryMap = page.getByRole("group", { name: /Control Atlas territory map/ });
  await expect(territoryMap).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atlas", level: 1 })).toBeVisible();
  // Nine territories, each a labelled control, and a known major landmark by name.
  await expect(territoryMap.getByRole("button", { name: /territory.*Zoom in/ })).toHaveCount(9);
  await expect(territoryMap.getByRole("button", { name: /^SP 800-53 Rev\. 5, / })).toBeVisible();
  await expect(page.getByText("The Atlas could not load")).toHaveCount(0);
  await expect(page.getByText("Record not found")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(
    await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth),
    "horizontal overflow",
  ).toBeLessThanOrEqual(0);
});

test("live smoke: compare hub loads", async ({ page }) => {
  await gotoApp(page, "/#/compare");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.getByRole("heading", { name: "Compare", level: 1 })).toBeVisible();
  await expect(page.getByText("See how frameworks connect using published crosswalks.", { exact: true })).toBeVisible();
});

test("live smoke: baseline comparison filters and exports complete selections", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/#/compare/relationships?intent=baselines&source=nist-800-53b:MODERATE&target=fedramp-rev5:MODERATE&compareRun=true");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const rows = page.locator("[data-baseline-result]");
  await expect(rows.first()).toBeVisible({ timeout: 90000 });
  await expect(page.locator("#compare-results")).toContainText("historical");
  await expect(page.locator("#compare-workspace")).toContainText("not a compliance failure");
  const totals = await page.locator("#compare-results > p").nth(1).innerText();
  const sharedMatch = totals.match(/([\d,]+) shared/);
  expect(sharedMatch).not.toBeNull();
  const shared = Number(sharedMatch[1].replaceAll(",", ""));
  expect(shared).toBeGreaterThan(25);

  await page.getByLabel("Result group").selectOption("shared");
  await expect(page.locator('[data-baseline-result]:not([data-baseline-result="shared"])')).toHaveCount(0);
  expect(await rows.count()).toBeLessThanOrEqual(25);
  await rows.first().getByText("Selection evidence", { exact: true }).click();
  await expect(rows.first().getByRole("link", { name: /official source/ })).toHaveCount(2);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await readFile(await (await downloadPromise).path(), "utf8");
  expect(csv.split("\r\n")).toHaveLength(shared + 1);
  expect(csv).toContain('"Shared"');
  expect(csv).not.toContain('"Only in A"');
  expect(csv).not.toContain('"Only in B"');
  expect(csv).toContain("https://");
  expect(csv).toContain("fedramp.gov");
  await page.getByLabel("Search results by ID or title").fill("no-such-control-zzzz");
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
});

test("live smoke: deployed runtime cache version matches source", async ({
  request,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    "deployed runtime version check only runs against the live site",
  );
  const home = await request.get(process.env.PLAYWRIGHT_BASE_URL);
  expect(home.ok()).toBeTruthy();
  const html = await home.text();
  const deployedVersion = html.match(
    /<meta name="control-atlas-runtime-cache-version" content="([^"]+)">/,
  )?.[1];
  expect(deployedVersion).toBe(RUNTIME_CACHE_VERSION);
});

test("live smoke: deployed artifact matches the expected commit", async ({
  request,
}) => {
  const expectedSha = process.env.EXPECTED_DEPLOY_SHA;
  test.skip(!expectedSha, "exact deployment SHA check only runs after Pages deploys");
  expect(expectedSha).toMatch(/^[0-9a-f]{40}$/i);
  const response = await request.get(
    new URL("release.json", process.env.PLAYWRIGHT_BASE_URL).toString(),
  );
  expect(response.ok()).toBeTruthy();
  const release = await response.json();
  expect(release).toMatchObject({ schema_version: "1.1", commit_sha: expectedSha });
  expect(release.released_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(release.source_data_generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});



test("live smoke: content inventories and sourced literal comparisons load", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/#/compare/relationships?intent=content&source=nist-800-171-rev2&target=nist-800-171&compareRun=true");
  await waitForAppReady(page); await dismissOnboarding(page);
  const rows = page.locator("[data-content-result]");
  await expect(rows.first()).toBeVisible({ timeout: 90000 });
  await expect(page.locator("#compare-workspace")).toContainText("do not prove they describe the same requirement");
  await rows.first().getByText("Compared fields and sources", { exact: true }).click();
  await expect(rows.first().getByRole("link", { name: /official source/ }).first()).toBeVisible();
  await page.getByLabel("Result group").selectOption("unavailable");
  await expect(page.locator('[data-content-result]:not([data-content-result="unavailable"])')).toHaveCount(0);
  await page.getByLabel("Search results by ID or title").fill("no-such-record-zzzz");
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
});
