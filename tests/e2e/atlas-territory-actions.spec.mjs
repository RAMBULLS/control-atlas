/* global document */
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

const CONTEXT = "asset.server,product.microsoft-windows,program.stig";
const PINS = JSON.stringify(["cmmc-2", "fedramp-rev5"]);

async function open(page, path, width = 1440) {
  attachPageDiagnostics(page);
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await gotoApp(page, path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator(".atl")).toBeVisible({ timeout: 30000 });
}
const params = (page) => new URLSearchParams(new URL(page.url()).hash.split("?")[1] || "");
const has = (page, ...keys) => keys.map((key) => params(page).has(key));

async function scene(page, extra = {}, width = 1440) {
  const manifest = await (await page.request.get("/data/generated/atlas-territory-manifest.json")).json();
  const q = new URLSearchParams({
    atlasLimb: "atlas:LIMB-IMPLEMENTATION", atlasFramework: "disa-stig", atlasPins: PINS, atlasContext: CONTEXT,
    atlasLayer: "publisher:DISA", atlasDataset: manifest.datasetId, ...extra,
  });
  await open(page, `/#/atlas?${q}`, width);
  return manifest.datasetId;
}
const PATH = { atlasResearch: "path", atlasFrom: "disa-cci", atlasTo: "disa-stig" };

test("there is no clear-everything action anywhere, on desktop or phone", async ({ page }) => {
  await scene(page, PATH);
  await expect(page.getByRole("button", { name: /reset/i })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /reset/i })).toHaveCount(0);
});

test("irrelevant clear actions are not shown on a plain overview", async ({ page }) => {
  await open(page, "/#/atlas");
  for (const name of ["Clear path", "Clear pins", "Clear layer", "Clear context", "Atlas overview"]) {
    await expect(page.locator(".atl").getByRole("button", { name: new RegExp(`^(◂ )?${name}`) })).toHaveCount(0);
  }
});

test("Clear path removes only the path", async ({ page }) => {
  const dataset = await scene(page, PATH);
  await page.getByRole("button", { name: "Clear path" }).click();
  expect(has(page, "atlasResearch", "atlasFrom", "atlasTo")).toEqual([false, false, false]);
  const p = params(page);
  expect(p.get("atlasLimb")).toBe("atlas:LIMB-IMPLEMENTATION");
  expect(p.get("atlasFramework")).toBe("disa-stig");
  expect(JSON.parse(p.get("atlasPins"))).toEqual(["cmmc-2", "fedramp-rev5"]);
  expect(p.get("atlasContext")).toBe(CONTEXT);
  expect(p.get("atlasLayer")).toBe("publisher:DISA");
  expect(p.get("atlasDataset")).toBe(dataset);
  await expect(page.getByRole("button", { name: "Clear path" })).toHaveCount(0);
  await expect(page.locator(".atl-tray")).toContainText("Pinned · 2");
  await expect(page.getByRole("region", { name: "Current context" })).toContainText("Server");
});

test("Atlas overview keeps pins, context, layer and the data version, and leaves focus and path", async ({ page }) => {
  const dataset = await scene(page, PATH);
  await page.getByRole("button", { name: /Atlas overview/ }).click();
  expect(has(page, "atlasLimb", "atlasFramework", "atlasResearch", "atlasFrom", "atlasTo")).toEqual([false, false, false, false, false]);
  const p = params(page);
  expect(JSON.parse(p.get("atlasPins"))).toEqual(["cmmc-2", "fedramp-rev5"]);
  expect(p.get("atlasContext")).toBe(CONTEXT);
  expect(p.get("atlasLayer")).toBe("publisher:DISA");
  expect(p.get("atlasDataset")).toBe(dataset);
  await expect(page.locator(".atl-tray")).toContainText("Pinned · 2");
});

test("Clear pins leaves shared ground and keeps focus, context, layer and the data version", async ({ page }) => {
  const dataset = await scene(page, { atlasResearch: "shared" });
  await page.getByRole("button", { name: "Clear pins" }).click();
  expect(has(page, "atlasPins", "atlasResearch")).toEqual([false, false]);
  const p = params(page);
  expect(p.get("atlasFramework")).toBe("disa-stig");
  expect(p.get("atlasContext")).toBe(CONTEXT);
  expect(p.get("atlasLayer")).toBe("publisher:DISA");
  expect(p.get("atlasDataset")).toBe(dataset);
  await expect(page.locator(".atl-tray")).toHaveCount(0);
});

test("Clear pins does not touch a path", async ({ page }) => {
  await scene(page, PATH);
  await page.getByRole("button", { name: "Clear pins" }).click();
  expect(params(page).has("atlasPins")).toBe(false);
  expect(params(page).get("atlasResearch")).toBe("path");
  expect(params(page).get("atlasFrom")).toBe("disa-cci");
  expect(params(page).get("atlasContext")).toBe(CONTEXT);
});

test("Clear context removes only the context", async ({ page }) => {
  const dataset = await scene(page, PATH);
  await page.getByRole("region", { name: "Current context" }).getByRole("button", { name: "Clear context" }).click();
  expect(params(page).has("atlasContext")).toBe(false);
  const p = params(page);
  expect(JSON.parse(p.get("atlasPins"))).toEqual(["cmmc-2", "fedramp-rev5"]);
  expect(p.get("atlasResearch")).toBe("path");
  expect([p.get("atlasFrom"), p.get("atlasTo")]).toEqual(["disa-cci", "disa-stig"]);
  expect(p.get("atlasFramework")).toBe("disa-stig");
  expect(p.get("atlasLayer")).toBe("publisher:DISA");
  expect(p.get("atlasDataset")).toBe(dataset);
});

test("Clear layer removes only the publisher layer", async ({ page }) => {
  const dataset = await scene(page, PATH);
  await page.getByRole("button", { name: "Clear layer" }).click();
  expect(params(page).has("atlasLayer")).toBe(false);
  const p = params(page);
  expect(JSON.parse(p.get("atlasPins"))).toEqual(["cmmc-2", "fedramp-rev5"]);
  expect(p.get("atlasContext")).toBe(CONTEXT);
  expect(p.get("atlasResearch")).toBe("path");
  expect(p.get("atlasFramework")).toBe("disa-stig");
  expect(p.get("atlasDataset")).toBe(dataset);
  await expect(page.getByRole("button", { name: "Clear layer" })).toHaveCount(0);
});

test("on a phone the same contextual actions are available and just as isolated", async ({ page }) => {
  await scene(page, PATH, 390);
  const actions = page.locator(".atl-m-actions");
  await expect(actions.getByRole("button", { name: "Atlas overview" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Clear path" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Clear layer" })).toBeVisible();
  await actions.getByRole("button", { name: "Clear path" }).click();
  expect(params(page).has("atlasResearch")).toBe(false);
  expect(params(page).get("atlasContext")).toBe(CONTEXT);
  expect(JSON.parse(params(page).get("atlasPins"))).toEqual(["cmmc-2", "fedramp-rev5"]);
  await page.locator(".atl-m-actions").getByRole("button", { name: "Clear layer" }).click();
  expect(params(page).has("atlasLayer")).toBe(false);
  expect(params(page).get("atlasContext")).toBe(CONTEXT);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
