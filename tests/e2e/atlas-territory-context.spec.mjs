/* global document */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

const CONTEXT = ["program.stig", "product.microsoft-windows", "asset.server"];
const contextUrl = (extra = "") => `/#/atlas?atlasContext=${encodeURIComponent(CONTEXT.join(","))}${extra}`;

async function open(page, path = "/#/atlas", width = 1440) {
  attachPageDiagnostics(page);
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await gotoApp(page, path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator(".atl")).toBeVisible({ timeout: 30000 });
}
const query = (page) => new URLSearchParams(new URL(page.url()).hash.split("?")[1] || "");
const geography = (page) => page.evaluate(() => JSON.stringify({
  dots: [...document.querySelectorAll(".lm .lm__dot")].map((e) => [e.closest(".lm").getAttribute("data-landmark"), e.getAttribute("cx"), e.getAttribute("cy")]),
  shapes: [...document.querySelectorAll(".district__shape")].map((e) => [e.closest(".district").getAttribute("data-district"), e.getAttribute("d")]),
}));
const openContext = async (page) => {
  const button = page.getByRole("button", { name: /^Context/ });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
};
const choose = async (page, label) => {
  await openContext(page);
  await page.getByRole("dialog", { name: "Context" }).getByRole("button", { name: new RegExp(`^${label}`) }).click();
};

test("context: STIG + Microsoft Windows + Server highlights only publications with matching records and moves nothing", async ({ page }) => {
  await open(page);
  const before = await geography(page);
  await choose(page, "STIG");
  await choose(page, "Microsoft Windows");
  await choose(page, "Server");
  expect(query(page).get("atlasContext")).toBe(CONTEXT.slice().sort().join(","));
  await page.keyboard.press("Escape");

  const bar = page.getByRole("region", { name: "Current context" });
  await expect(bar).toContainText("Showing material for:");
  for (const name of ["Remove STIG", "Remove Microsoft Windows", "Remove Server"]) await expect(bar.getByRole("button", { name })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Clear context" })).toBeVisible();

  // Only publications that contain matching records are highlighted; everything else is dimmed, and nothing moved.
  await expect(page.locator(".lm.is-match")).toHaveCount(1);
  await expect(page.locator('.lm.is-match[data-landmark="disa-stig"]')).toHaveCount(1);
  expect(await page.locator(".lm.is-dim").count()).toBe(28 - (await page.locator(".lm.is-match").count()));
  expect(await geography(page), "coordinates drift").toBe(before);

  const card = page.locator(".atl-inspector");
  await expect(card).toContainText("Showing publications containing records associated with this context.");
  await expect(card).toContainText("does not mean the publication itself has these choices");
  const count = (await card.innerText()).match(/([\d,]+) records match/);
  expect(count, "the card states the matching record count").not.toBeNull();
  await expect(page.locator(".lm.is-match .lm__count")).toContainText(count[1]);
  for (const label of ["STIG", "Microsoft Windows", "Server"]) await expect(card.locator(".atl-breakdown")).toContainText(`${label} · `);
});

test("context copy never uses internal vocabulary", async ({ page }) => {
  await open(page, contextUrl());
  await openContext(page);
  const text = await page.locator(".atl").innerText();
  expect(text).not.toMatch(/taxonom|facet|governed context|semantic projection|source-backed/i);
  expect(text).not.toMatch(/nothing applies/i);
});

test("context + a selected publication explains why it matched and hands off to Library with the same choices", async ({ page }) => {
  await open(page, contextUrl());
  await page.locator('[data-landmark="disa-stig"]').click();
  const card = page.locator(".atl-inspector");
  await expect(card.getByRole("region", { name: "Matching this context" })).toContainText("associated with your choices");
  expect(await geography(page)).toContain("disa-stig");
  await card.getByRole("link", { name: "View matching records" }).click();
  await expect(page).toHaveURL(/#\/library\?/);
  const params = query(page);
  expect(params.get("filter")).toBe("disa-stig");
  expect(params.getAll("tag").sort()).toEqual(CONTEXT.slice().sort());
});

test("a context with no matching records says so plainly and offers to clear one choice or all", async ({ page }) => {
  await open(page, `/#/atlas?atlasContext=${encodeURIComponent("program.cmmc,product.microsoft-windows")}`);
  const card = page.locator(".atl-inspector");
  await expect(card).toContainText("No records match this context");
  await expect(card).not.toContainText(/nothing applies/i);
  await expect(page.locator(".lm.is-match")).toHaveCount(0);
  await card.getByRole("button", { name: "Clear CMMC" }).click();
  await expect(page.locator(".lm.is-match").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Current context" })).not.toContainText("CMMC");
  await page.getByRole("region", { name: "Current context" }).getByRole("button", { name: "Clear context" }).click();
  await expect(page.getByRole("region", { name: "Current context" })).toHaveCount(0);
  expect(query(page).get("atlasContext")).toBeNull();
});

test("choices within one dimension widen, and choosing another kind of choice narrows", async ({ page }) => {
  const total = async (path) => {
    await open(page, path);
    const match = (await page.locator(".atl-inspector").innerText()).match(/CONTEXT · ([\d,]+) RECORDS/i);
    return Number(match[1].replace(/,/g, ""));
  };
  const windows = await total(`/#/atlas?atlasContext=${encodeURIComponent("product.microsoft-windows")}`);
  const either = await total(`/#/atlas?atlasContext=${encodeURIComponent("product.microsoft-windows,product.red-hat-enterprise-linux")}`);
  const narrowed = await total(`/#/atlas?atlasContext=${encodeURIComponent("product.microsoft-windows,asset.server")}`);
  expect(either).toBeGreaterThan(windows);
  expect(narrowed).toBeLessThanOrEqual(windows);
});

test("share this view: copies the scene only after the clipboard accepts it, and a fresh page restores it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const manifest = await (await page.request.get("/data/generated/atlas-territory-manifest.json")).json();
  await open(page, `/#/atlas?atlasLimb=atlas:LIMB-IMPLEMENTATION&atlasFramework=disa-stig&atlasContext=${encodeURIComponent(CONTEXT.join(","))}&atlasPins=${encodeURIComponent('["disa-stig","cmmc-2"]')}`);
  await expect(page.locator(".atl-tray")).toContainText("Pinned · 2");
  await expect(page.locator(".atl-copied")).toHaveCount(0);
  await page.getByRole("button", { name: "Share this view" }).click();
  await expect(page.getByText("Link copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const shared = new URLSearchParams(new URL(copied).hash.split("?")[1]);
  expect(shared.get("atlasFramework")).toBe("disa-stig");
  expect(shared.get("atlasContext")).toBe(CONTEXT.slice().sort().join(","));
  expect(JSON.parse(shared.get("atlasPins"))).toEqual(["disa-stig", "cmmc-2"]);
  expect(shared.get("atlasDataset")).toBe(manifest.datasetId);
  expect(copied).not.toMatch(/atlasHops|hop/i);

  const fresh = await context.newPage();
  attachPageDiagnostics(fresh);
  await fresh.setViewportSize({ width: 1440, height: 900 });
  await fresh.goto(copied);
  await waitForAppReady(fresh);
  await dismissOnboarding(fresh);
  await expect(fresh.getByRole("region", { name: "Current context" })).toContainText("Microsoft Windows");
  await expect(fresh.locator(".atl-tray")).toContainText("Pinned · 2");
  await expect(fresh.locator(".atl-inspector")).toContainText("DISA STIG");
  await expect(fresh.locator('.lm.is-match[data-landmark="disa-stig"]')).toHaveCount(1);
  await expect(fresh.getByText(/different data version/)).toHaveCount(0);
});

test("share this view: a clipboard failure is stated honestly and never reported as copied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("blocked")) } });
  });
  await open(page, contextUrl());
  await page.getByRole("button", { name: "Share this view" }).click();
  await expect(page.getByText(/Copy failed/)).toBeVisible();
  await expect(page.getByText("Link copied")).toHaveCount(0);
});

test("back and forward restore context changes", async ({ page }) => {
  await open(page);
  await choose(page, "STIG");
  await choose(page, "Server");
  await expect(page.getByRole("region", { name: "Current context" })).toContainText("Server");
  await page.goBack();
  await expect(page.getByRole("region", { name: "Current context" })).not.toContainText("Server");
  await expect(page.getByRole("region", { name: "Current context" })).toContainText("STIG");
  await page.goBack();
  await expect(page.getByRole("region", { name: "Current context" })).toHaveCount(0);
  await page.goForward();
  await page.goForward();
  await expect(page.getByRole("region", { name: "Current context" })).toContainText("Server");
});

test("a view made with a different data version is stated neutrally, keeps its source, and offers no invented change view", async ({ page }) => {
  await open(page, contextUrl("&atlasDataset=000000000000"));
  await expect(page.getByText("This link was made with a different data version, so results may differ from what its sender saw.")).toBeVisible();
  // An unknown but valid id says only that it differs; it never claims to be earlier or older.
  expect(await page.locator(".atl").innerText()).not.toMatch(/earlier|older|outdated|stale|newer/i);
  expect(query(page).get("atlasDataset")).toBe("000000000000");
  await page.locator('[data-landmark="disa-stig"]').click();
  expect(query(page).get("atlasDataset"), "the saved dataset survives navigation").toBe("000000000000");
  await expect(page.locator(".atl").getByRole("button", { name: /changes/i })).toHaveCount(0);
  await expect(page.locator(".atl").getByRole("link", { name: /changes/i })).toHaveCount(0);

  const manifest = await (await page.request.get("/data/generated/atlas-territory-manifest.json")).json();
  await open(page, contextUrl(`&atlasDataset=${manifest.datasetId}`));
  await expect(page.getByText(/different data version/)).toHaveCount(0);
});

for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`active context and its results have no horizontal overflow at ${width}px`, async ({ page }) => {
    await open(page, contextUrl(), width);
    await expect(page.getByRole("region", { name: "Current context" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.goto(`${page.url().split("#")[0]}${contextUrl("&atlasLimb=atlas:LIMB-IMPLEMENTATION&atlasFramework=disa-stig").slice(1)}`);
    await expect(page.getByRole("region", { name: "Matching this context" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const control of await page.locator(".atl button:visible, .atl select:visible, .atl input:visible").all()) {
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(43.5);
    }
  });
}

test("on a phone the context results come right after the current context", async ({ page }) => {
  await open(page, contextUrl(), 390);
  const order = await page.evaluate(() => {
    const at = (selector) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
    return { bar: at(".atl-context"), results: at("#atl-focus"), area: at("#atl-where") };
  });
  expect(order.bar).toBeGreaterThan(0);
  expect(order.results).toBeGreaterThan(order.bar);
  expect(order.area).toBeGreaterThan(order.results);
});

test("context menu and results have no serious accessibility violations", async ({ page }) => {
  await open(page, contextUrl("&atlasLimb=atlas:LIMB-IMPLEMENTATION&atlasFramework=disa-stig"));
  await openContext(page);
  const results = await new AxeBuilder({ page }).include(".atl").analyze();
  expect(results.violations.filter((v) => ["serious", "critical"].includes(v.impact))).toEqual([]);
});
