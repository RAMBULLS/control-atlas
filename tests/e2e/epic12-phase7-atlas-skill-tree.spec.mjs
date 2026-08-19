import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

async function openAtlas(page, path = "/#/atlas?relationshipView=path") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoApp(page, path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator(".atlas-tree")).toBeVisible();
}

async function selectTreeNode(page, id) {
  await page
    .locator(`.react-flow__node:has([data-atlas-node-id="${id}"])`)
    .dispatchEvent("click");
}

async function drillNode(page, id) {
  await selectTreeNode(page, id);
}

test("Atlas overview hands off to publisher-native navigation and preserves history", async ({ page }) => {
  test.setTimeout(120_000);
  await openAtlas(page);

  const tree = page.locator(".atlas-tree");
  await expect(tree).toHaveAttribute("data-tree-node-count", "13");
  await expect(page.getByText("Explore areas, publications, and the published connections between them.", { exact: true })).toBeVisible();
  await expect(tree.locator('[data-atlas-node-id="atlas:TRUNK"]')).toBeVisible();
  await expect(tree.locator('[data-atlas-node-id^="authority-aggregate:"]')).toHaveCount(3);
  await expect(tree.locator('[data-atlas-node-id^="atlas:LIMB-"]')).toHaveCount(9);
  const stage = tree.locator(".atlas-tree__stage");
  await expect(stage).toHaveAttribute("data-semantic-level", "orientation");
  await page.waitForTimeout(550);
  for (let step = 0; step < 4; step += 1) await page.locator(".atlas-tree").getByTitle("Zoom in").click();
  await expect(stage).toHaveAttribute("data-semantic-level", "justification");

  await drillNode(page, "atlas:LIMB-IMPLEMENTATION");
  await expect(stage).toHaveAttribute("data-semantic-level", "justification");
  await expect(page).toHaveURL(/atlasLimb=atlas:LIMB-IMPLEMENTATION/);
  await drillNode(page, "disa-stig:CATALOG");
  await expect(page).toHaveURL(/atlasFramework=disa-stig/);
  const explorer = page.locator("[data-atlas-structural-explorer]");
  await expect(explorer.getByRole("heading", { name: "DISA STIG Catalog" })).toBeVisible();
  await expect(tree.locator(".react-flow")).toHaveCount(0);
  await expect(tree.locator("select")).toHaveCount(0);
  await explorer.getByLabel("Search this publication").fill("Oracle Linux 9");
  await explorer.getByRole("button", { name: /Oracle Linux 9/ }).click();
  await expect(page).toHaveURL(/\/#\/atlas\/disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG\?/);
  await expect(explorer.getByRole("heading", { name: /Oracle Linux 9/ })).toBeVisible();

  await page.reload();
  await waitForAppReady(page);
  await expect(page.locator("[data-atlas-structural-explorer]").getByRole("heading", { name: /Oracle Linux 9/ })).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/\/#\/atlas\/disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG/);
  await expect(page.locator("[data-atlas-structural-explorer]").getByRole("heading", { name: "DISA STIG Catalog" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/#\/atlas\/disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG\?/);
  await expect(page.locator("[data-atlas-structural-explorer]").getByRole("heading", { name: /Oracle Linux 9/ })).toBeVisible();

  await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-THREAT&atlasFramework=mitre-attack");
  await waitForAppReady(page);
  await page.locator("[data-atlas-structural-explorer]").getByRole("button", { name: /TA0001/ }).click();
  await expect(page).toHaveURL(/\/#\/atlas\/mitre-attack:TACTIC-TA0001\?/);
  await page.reload();
  await waitForAppReady(page);
  await expect(page.locator("[data-atlas-structural-explorer]").getByRole("heading", { name: /Initial Access/ })).toBeVisible();
});

test("focused trace matches the record rail and local connections never replace containment", async ({ page }) => {
  test.setTimeout(120_000);
  const monolithic = [];
  page.on("request", (request) => {
    if (/\/(nodes|edges)\.json(?:\.gz)?(?:\?|$)/.test(request.url())) monolithic.push(request.url());
  });

  await gotoApp(page, "/#/record/disa-cci/CCI-000366");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const recordTrace = await page
    .locator('[data-template="E"] [data-displayed-trace]')
    .getAttribute("data-displayed-trace");
  expect(recordTrace).toBeTruthy();

  await openAtlas(page, "/#/atlas?node=disa-cci%3ACCI-000366&relationshipView=path");
  const tree = page.locator(".atlas-tree");
  const atlasTrace = await tree.locator("[data-authority-trace]").getAttribute("data-authority-trace");
  expect(atlasTrace).toBe(recordTrace);

  await expect(tree.locator(".react-flow")).toHaveCount(0);
  const pathBefore = await tree.locator("[data-authority-trace]").getAttribute("data-authority-trace");
  await page.getByRole("button", { name: "Show local connections" }).click();
  await expect(tree.locator(".atlas-tree__overlay-highlight")).toHaveCount(24);
  await expect(tree.getByRole("button", { name: /3,467 more .* open Compare/ })).toBeVisible();
  expect(await tree.locator("[data-authority-trace]").getAttribute("data-authority-trace")).toBe(pathBefore);
  await page.getByRole("button", { name: "Show local connections" }).click();
  await expect(tree.locator(".atlas-tree__overlay-highlight")).toHaveCount(0);
  expect(monolithic).toEqual([]);
});

test("mobile Atlas keeps keyboard overview navigation and uses a structural Browse drawer", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/#/atlas?relationshipView=path");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const tree = page.getByRole("tree", { name: "Atlas map hierarchy" });
  await expect(tree).toBeVisible();
  await expect(tree.getByRole("treeitem")).toHaveCount(13);
  const compliance = tree.getByRole("treeitem", { name: /Compliance/ });
  await compliance.focus();
  await page.keyboard.press("ArrowDown");
  await expect(compliance).not.toBeFocused();
  await compliance.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/atlasLimb=atlas:LIMB-COMPLIANCE/);

  await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-IMPLEMENTATION&atlasFramework=disa-stig");
  await waitForAppReady(page);
  await page.getByRole("button", { name: "Browse structure" }).click();
  const browse = page.getByRole("navigation", { name: "Current publication structure" });
  await expect(browse).toBeVisible();
  await browse.getByLabel("Search this publication").fill("Oracle Linux 9");
  await browse.getByRole("button", { name: /BENCHMARK-ORACLE-LINUX-9-STIG/ }).click();
  await expect(page).toHaveURL(/\/#\/atlas\/disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG\?/);
  await expect(page.locator("[data-atlas-structural-explorer]").getByRole("heading", { name: /Oracle Linux 9/ })).toBeVisible();
  const reopen = page.locator(".atlas-tree__mobile-bar").getByRole("button", { name: "Browse structure" });
  await expect(reopen).toBeVisible();
  const target = await reopen.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBe(0);
});

test("two cold publication loads produce identical structural result order", async ({ browser }) => {
  test.setTimeout(120_000);
  const snapshots = [];
  for (let index = 0; index < 2; index += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-THREAT&atlasFramework=mitre-attack");
    await waitForAppReady(page);
    const explorer = page.locator("[data-atlas-structural-explorer]");
    await expect(explorer).toBeVisible();
    await expect(page.locator(".atlas-tree .react-flow")).toHaveCount(0);
    snapshots.push(await explorer.locator(".atlas-publisher-explorer__list > li").allTextContents());
    await context.close();
  }
  expect(snapshots[1]).toEqual(snapshots[0]);
});

test("opened connection filters stay inside their panel at every governed width", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
    await gotoApp(page, "/#/atlas?node=nist-800-53%3AAC-2&relationshipView=list");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page.locator(".route-transition")).toBeHidden();
    await expect(page.locator(".atlas-workspace-heading")).toHaveText("Connections");

    const disclosure = page.locator("details.atlas-connection-filters");
    if ((await disclosure.getAttribute("open")) === null) {
      await disclosure.locator("summary").click();
    }
    await expect(disclosure).toHaveAttribute("open", "");
    const panel = disclosure.getByRole("group", { name: "Connection filters" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("combobox")).toHaveCount(4);
    await expect(panel.getByRole("searchbox")).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: "Include candidate links" })).toBeVisible();

    const fit = await panel.evaluate((element) => {
      const panelRect = element.getBoundingClientRect();
      const boxes = [...element.querySelectorAll("label, select, input")].map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      return {
        panel: {
          left: panelRect.left,
          right: panelRect.right,
          top: panelRect.top,
          bottom: panelRect.bottom,
        },
        boxes,
        documentOverflow:
          globalThis.document.documentElement.scrollWidth -
          globalThis.document.documentElement.clientWidth,
        bodyOverflow:
          globalThis.document.body.scrollWidth - globalThis.document.body.clientWidth,
      };
    });

    expect(fit.documentOverflow, `${width}px document overflow`).toBe(0);
    expect(fit.bodyOverflow, `${width}px body overflow`).toBe(0);
    expect(fit.panel.left, `${width}px panel left edge`).toBeGreaterThanOrEqual(0);
    expect(fit.panel.right, `${width}px panel right edge`).toBeLessThanOrEqual(width);
    for (const [index, box] of fit.boxes.entries()) {
      expect(box.left, `${width}px control ${index} left edge`).toBeGreaterThanOrEqual(
        fit.panel.left,
      );
      expect(box.right, `${width}px control ${index} right edge`).toBeLessThanOrEqual(
        fit.panel.right,
      );
      expect(box.top, `${width}px control ${index} top edge`).toBeGreaterThanOrEqual(
        fit.panel.top,
      );
      expect(box.bottom, `${width}px control ${index} bottom edge`).toBeLessThanOrEqual(
        fit.panel.bottom,
      );
    }
  }
});

test("twenty consecutive Atlas map cold navigations resolve within five seconds", async ({ browser }) => {
  test.setTimeout(150_000);
  for (let index = 0; index < 20; index += 1) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const started = Date.now();
    await gotoApp(page, `/#/atlas?coldRun=${index}`);
    await expect(page.locator('[data-route-content-ready="true"]')).toBeVisible({ timeout: 5_000 });
    expect(Date.now() - started, `cold load ${index + 1}`).toBeLessThanOrEqual(5_000);
    await context.close();
  }
});
