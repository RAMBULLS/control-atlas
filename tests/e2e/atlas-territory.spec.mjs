import { gzipSync } from "node:zlib";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";
/* global document, getComputedStyle */

const START = "disa-stig:V-205646";
const CCI_LABEL = "CCI-000185";

async function open(page, path = "/#/atlas", width = 1440) {
  attachPageDiagnostics(page);
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await gotoApp(page, path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator(".atl")).toBeVisible({ timeout: 30000 });
}
// The NIST destination is whatever the accepted graph returns for the trail, never an assumed endpoint.
async function discoverEnd(page) {
  await open(page, `/#/atlas?atlasResearch=upstream&atlasFrom=${encodeURIComponent(START)}`);
  const steps = page.locator(".atl-steps");
  await expect(steps).toContainText(CCI_LABEL, { timeout: 90000 });
  const label = (await steps.locator("li").last().locator("b").innerText()).trim();
  await expect(steps.locator("li").last()).toContainText("800-53");
  return { id: `nist-800-53:${label}`, label };
}
async function goHash(page, hash) {
  await page.evaluate((h) => { globalThis.location.hash = h; }, hash);
}
const query = (page) => new URLSearchParams(new URL(page.url()).hash.split("?")[1] || "");

test("overview names only reviewed major landmarks and mutes empty territories", async ({ page }) => {
  await open(page);
  await expect(page.locator(".terr")).toBeVisible();
  const named = await page.locator(".lm .lm__name").allTextContents();
  expect(named).toEqual(expect.arrayContaining(["SP 800-53 Rev. 5", "CSF 2.0", "CMMC 2.0", "DISA STIG", "ATT&CK Enterprise"]));
  expect(named).not.toContain("DISA CCI");
  expect(await page.locator(".district.is-empty").count()).toBe(2);
  expect(await page.locator(".dname.is-empty").count(), "empty territories show no name at rest").toBe(0);
  await expect(page.getByRole("button", { name: /Authority · \d+/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Other publications · 2/ })).toBeVisible();
  await expect(page.locator(".atl-inspector")).toHaveCount(0);
});

test("no relationship network or research index loads for the ordinary Atlas", async ({ page }) => {
  const seen = [];
  page.on("request", (r) => seen.push(r.url()));
  await open(page);
  expect(seen.filter((u) => /atlas-network|atlas-research\/|atlasResearch\.worker|atlas-spine/.test(u))).toEqual([]);
});

test("a hub shows a bounded set first, then the complete set on request", async ({ page }) => {
  await open(page);
  await page.locator('[data-district="atlas:LIMB-COMPLIANCE"] .district__shape').click();
  await expect(page).toHaveURL(/atlasLimb=atlas(%3A|:)LIMB-COMPLIANCE/);
  await page.locator('[data-landmark="nist-800-53"]').click();
  await expect(page.locator(".atl-inspector")).toContainText("SP 800-53 Rev. 5");
  await expect(page.locator(".route--sel")).toHaveCount(4);
  await page.getByRole("button", { name: /Show all \d+/ }).click();
  const total = await page.locator(".route--sel").count();
  expect(total).toBeGreaterThan(4);
  await page.getByRole("button", { name: /^Maps to/ }).click();
  expect(await page.locator(".route--sel").count()).toBeLessThan(total);
});

test("a route opens its published evidence", async ({ page }) => {
  await open(page, "/#/atlas?atlasLimb=atlas:LIMB-COMPLIANCE&atlasFramework=nist-800-53");
  await page.locator(".atl-inspector .atl-chips button", { hasText: "DISA CCI" }).click();
  await expect(page.locator(".atl-inspector")).toContainText("Why connected");
  await expect(page.locator(".atl-inspector")).toContainText("Example location");
  expect(query(page).get("atlasResearch")).toBe("path");
});

test("pins, honest zero shared ground, Compare handoff and clear", async ({ page }) => {
  await open(page, `/#/atlas?atlasPins=${encodeURIComponent('["cmmc-2","fedramp-rev5"]')}&atlasResearch=shared`);
  await expect(page.locator(".atl-inspector")).toContainText("Nothing is shared");
  const compare = page.getByRole("link", { name: /Compare CMMC 2.0 and FedRAMP Rev. 5/ });
  await expect(compare).toHaveAttribute("href", /compare\/relationships\?.*source=cmmc-2.*target=fedramp-rev5/);
  await page.getByRole("button", { name: "Clear pins" }).click();
  await expect(page.locator(".atl-tray")).toHaveCount(0);
  expect(query(page).get("atlasPins")).toBeNull();
});

test("pinning survives refresh, back and forward", async ({ page }) => {
  await open(page, "/#/atlas?atlasLimb=atlas:LIMB-COMPLIANCE&atlasFramework=csf-2");
  await page.getByRole("button", { name: "Pin CSF 2.0" }).click();
  await expect(page.locator(".atl-tray")).toContainText("Pinned · 1");
  await page.reload();
  await expect(page.locator(".atl-tray")).toContainText("Pinned · 1");
  await page.goBack();
  await expect(page.locator(".atl-tray")).toHaveCount(0);
  await page.goForward();
  await expect(page.locator(".atl-tray")).toContainText("Pinned · 1");
});

test("the publisher layer is the only layer, styles the map and never moves a landmark", async ({ page }) => {
  await open(page);
  const before = await page.locator('[data-landmark="disa-stig"] .lm__dot').evaluate((el) => [el.getAttribute("cx"), el.getAttribute("cy")]);
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(page.getByLabel("Layers")).not.toContainText(/Lifecycle|Product|Changes|Security domain/);
  await page.getByLabel("Publisher").selectOption("DISA");
  await expect(page.locator(".lm.is-layer").first()).toBeVisible();
  expect(query(page).get("atlasLayer")).toBe("publisher:DISA");
  const after = await page.locator('[data-landmark="disa-stig"] .lm__dot').evaluate((el) => [el.getAttribute("cx"), el.getAttribute("cy")]);
  expect(after).toEqual(before);
});

test("search finds a record by identifier and a publication by alias", async ({ page }) => {
  await open(page);
  await page.locator("#atlas-search").click();
  await page.keyboard.type("V-205646", { delay: 20 });
  await expect(page.locator("#atlas-results")).toContainText("V-205646", { timeout: 30000 });
  await page.locator("#atlas-search").fill("cmmc");
  await page.locator("#atlas-results button", { hasText: "Certification program" }).first().click();
  await expect(page.locator(".atl-inspector")).toContainText("CMMC 2.0");
});

test("Authority and Other publications are visible lists, not buried drawers", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Authority · \d+/ }).click();
  await expect(page.getByRole("region", { name: "Authority documents" })).toContainText("no routes lead to them");
  await page.getByRole("button", { name: /Other publications · 2/ }).click();
  await expect(page.getByRole("dialog", { name: "Other publications" })).toBeVisible();
});

for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await open(page, "/#/atlas", width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto(`${page.url().split("#")[0]}#/atlas?atlasLimb=atlas:LIMB-COMPLIANCE&atlasFramework=nist-800-53`);
    await expect(page.locator(".atl")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("phone is list first: territories are listed and the mini map picks one", async ({ page }) => {
  await open(page, "/#/atlas", 390);
  await expect(page.locator(".atl--mobile")).toBeVisible();
  await expect(page.locator(".terr")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Compliance/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Compliance territory" }).click();
  await expect(page.getByText("Current area · Compliance")).toBeVisible();
});

test("keyboard reaches a landmark and opens it", async ({ page }) => {
  await open(page);
  await page.locator('[data-landmark="csf-2"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".atl-inspector")).toContainText("CSF 2.0");
});

test("reduced motion removes decorative animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const animated = await page.locator(".district").first().evaluate((el) => getComputedStyle(el).animationName);
  expect(animated).toBe("none");
});

test("the territory sheet has no serious accessibility violations", async ({ page }) => {
  await open(page, "/#/atlas?atlasLimb=atlas:LIMB-COMPLIANCE&atlasFramework=nist-800-53");
  const results = await new AxeBuilder({ page }).include(".atl").analyze();
  expect(results.violations.filter((v) => ["serious", "critical"].includes(v.impact))).toEqual([]);
});

test("flagship: search a STIG rule, trace upstream through the CCI to the accepted NIST control, and inspect the evidence", async ({ page }) => {
  await open(page);
  await page.locator("#atlas-search").click();
  await page.keyboard.type("V-205646", { delay: 20 });
  await page.locator("#atlas-results button").first().click();
  await expect(page.locator(".atl-inspector")).toContainText("V-205646");
  await expect(page.locator(".rec[data-record]")).toHaveCount(1);
  await page.getByRole("button", { name: "Trace upstream" }).click();
  const steps = page.locator(".atl-steps");
  await expect(steps).toContainText("CCI-000185", { timeout: 90000 });
  await expect(steps.locator("li").last()).toContainText("800-53");
  expect(query(page).get("atlasResearch")).toBe("upstream");
  expect(query(page).get("atlasFrom")).toBe(START);
  expect(page.url()).not.toContain("nist-800-53");
  await expect(page.locator(".seg")).toHaveCount(2);
  await page.locator(".atl-steps__seg").first().click();
  await expect(page.locator(".atl-inspector")).toContainText("Why connected");
  await expect(page.locator(".atl-inspector")).toContainText("Exact location");
  await page.getByRole("button", { name: "Back to path" }).click();
  await page.reload();
  await expect(page.locator(".atl-steps")).toContainText(CCI_LABEL, { timeout: 90000 });
});

test("a record path from the URL is recomputed, never stored", async ({ page }) => {
  const end = await discoverEnd(page);
  await goHash(page, `#/atlas?atlasResearch=path&atlasFrom=${encodeURIComponent(START)}&atlasTo=${encodeURIComponent(end.id)}`);
  await expect(page.locator(".atl-steps")).toContainText(end.label, { timeout: 90000 });
  expect(page.url()).not.toContain("atlasHops");
});

test("record pins share ground through the CCI, and mixing pin kinds is refused plainly", async ({ page }) => {
  const end = await discoverEnd(page);
  await goHash(page, `#/atlas?atlasResearch=shared&atlasPins=${encodeURIComponent(JSON.stringify([START, end.id]))}`);
  await expect(page.locator(".atl-inspector")).toContainText("CCI-000185", { timeout: 90000 });
  await expect(page.locator(".atl").getByRole("link", { name: /^Compare/ })).toHaveCount(0);
  await page.locator('[data-landmark="csf-2"]').click();
  await page.getByRole("button", { name: "Pin CSF 2.0" }).click();
  await expect(page.getByText(/Pin publications together or records together/).first()).toBeVisible();
});

const upstreamUrl = `/#/atlas?atlasResearch=upstream&atlasFrom=${encodeURIComponent(START)}`;

test("missing records are recoverable and never reported as an unconnected pair", async ({ page }) => {
  await open(page, `/#/atlas?atlasResearch=path&atlasFrom=${encodeURIComponent(START)}&atlasTo=does-not-exist`);
  await expect(page.locator(".atl-inspector")).toContainText("not in the connection data", { timeout: 90000 });
  await expect(page.locator(".atl-inspector")).not.toContainText("No published path");
});

test("invalid connection data never becomes a false no-path result and retry restores the trail", async ({ page }) => {
  let broken = true;
  await page.context().route("**/atlas-research-manifest.json", async (route) => {
    if (broken) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 999 }) });
    else await route.continue();
  });
  await open(page, upstreamUrl);
  await expect(page.locator(".atl-warn")).toContainText("does not mean there is no connection", { timeout: 60000 });
  await expect(page.locator(".atl-inspector")).not.toContainText("No published");
  broken = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".atl-steps")).toContainText(CCI_LABEL, { timeout: 90000 });
});

test("an unavailable worker produces an honest recovery state", async ({ page }) => {
  await page.addInitScript(() => {
    const Native = globalThis.Worker;
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: class extends Native { constructor(url, options) { if (String(url).includes("atlasResearch")) throw new Error("worker unavailable fixture"); super(url, options); } } });
  });
  await open(page, upstreamUrl);
  await expect(page.locator(".atl-warn")).toContainText("does not mean there is no connection", { timeout: 30000 });
  await expect(page.locator(".atl")).toBeVisible();
});

test("tampered connection bytes fail integrity validation without a false result", async ({ page }) => {
  await page.context().route("**/atlas-research/*.json.gz", (route) => route.fulfill({ status: 200, contentType: "application/gzip", body: gzipSync(Buffer.from('{"schemaVersion":1}')) }));
  await open(page, upstreamUrl);
  await expect(page.locator(".atl-warn")).toContainText("does not mean there is no connection", { timeout: 60000 });
  await expect(page.locator(".atl-steps")).toHaveCount(0);
});

test("shared record connections keep separate source evidence for every pin", async ({ page }) => {
  const end = await discoverEnd(page);
  await goHash(page, `#/atlas?atlasResearch=shared&atlasPins=${encodeURIComponent(JSON.stringify([START, end.id]))}`);
  const row = page.locator(".atl-inspector .atl-list > li").filter({ hasText: "CCI-000185" });
  await expect(row).toHaveCount(1, { timeout: 90000 });
  await row.getByRole("button", { name: /^With / }).last().click();
  await expect(page.locator(".atl-inspector")).toContainText("Why connected");
  await expect(page.locator(".atl-inspector")).toContainText("Exact location");
});

for (const width of [320, 390, 768, 1440]) {
  test(`the record trail and its evidence are usable at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await open(page, upstreamUrl, width);
    await expect(page.locator(".atl-steps")).toContainText(CCI_LABEL, { timeout: 90000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const control of await page.locator(".atl button:visible, .atl select:visible, .atl input:visible").all()) {
      const box = await control.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    await page.locator(".atl-steps__seg").last().click();
    await expect(page.locator(".atl-inspector, #atl-focus").first()).toContainText("Why connected");
    if (width < 760) {
      await expect(page.locator("#atl-focus")).toBeFocused();
      await expect(page.locator("#atl-focus")).toBeInViewport();
    }
  });
}

test("the record trail has no serious accessibility violations", async ({ page }) => {
  await open(page, upstreamUrl);
  await expect(page.locator(".atl-steps")).toContainText(CCI_LABEL, { timeout: 90000 });
  const results = await new AxeBuilder({ page }).include(".atl").analyze();
  expect(results.violations.filter((v) => ["serious", "critical"].includes(v.impact))).toEqual([]);
});

test("evidence names its published source even when research is entered from inside the app", async ({ page }) => {
  await open(page);
  await page.evaluate((from) => { globalThis.location.hash = `#/atlas?atlasResearch=upstream&atlasFrom=${encodeURIComponent(from)}`; }, START);
  await expect(page.locator(".atl-steps")).toContainText(CCI_LABEL, { timeout: 90000 });
  await page.locator(".atl-steps__seg").last().click();
  await expect(page.locator(".atl-inspector")).toContainText("Why connected");
  await expect(page.locator(".atl-inspector")).not.toContainText("Source details unavailable");
  await expect(page.locator(".atl-inspector").getByRole("link", { name: "View source details" })).toBeVisible();
});
