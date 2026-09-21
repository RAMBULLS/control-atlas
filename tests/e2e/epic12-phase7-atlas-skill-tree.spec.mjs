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

async function openNetwork(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Straight to a publisher's own columns: this suite is about navigating
  // publisher-native structure, which begins one level below the board.
  await gotoApp(page, "/#/atlas?atlasLanding=publishers&atlasLimb=ecosystem%3Anist");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.getByTestId("atlas-map")).toBeVisible();
}

test("semantic Atlas hands off to explicit publisher-native navigation and preserves history", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-IMPLEMENTATION&atlasFramework=disa-stig&relationshipView=path");
  await waitForAppReady(page);
  const tree = page.locator(".atlas-tree");
  const explorer = page.locator("[data-react-root] [data-atlas-structural-explorer]:visible");
  await expect(explorer.getByRole("heading", { name: "DISA STIG Catalog" })).toBeVisible();
  await expect(tree.locator(".react-flow")).toHaveCount(0);
  await expect(tree.locator("select")).toHaveCount(0);
  await explorer.getByRole("button", {
    name: "Open Active_Directory_Domain — Active Directory Domain Security Technical Implementation Guide",
    exact: true,
  }).click();
  await expect(page).toHaveURL(/\/#\/atlas\/disa-stig:BENCHMARK-ACTIVE-DIRECTORY-DOMAIN\?/);
  await expect(page.locator(".atlas-workspace-heading")).toHaveText("Connections");

  await page.reload();
  await waitForAppReady(page);
  await expect(page.locator(".atlas-workspace-heading")).toHaveText("Connections");

  await page.goBack();
  await expect(page).not.toHaveURL(/\/#\/atlas\/disa-stig:BENCHMARK-ACTIVE-DIRECTORY-DOMAIN/);
  await expect(page.locator("[data-react-root] [data-atlas-structural-explorer]:visible").getByRole("heading", { name: "DISA STIG Catalog" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/#\/atlas\/disa-stig:BENCHMARK-ACTIVE-DIRECTORY-DOMAIN\?/);
  await expect(page.locator(".atlas-workspace-heading")).toHaveText("Connections");

  await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-THREAT&atlasFramework=mitre-attack&relationshipView=path");
  await waitForAppReady(page);
  await page.locator("[data-react-root] [data-atlas-structural-explorer]:visible").getByRole("button", { name: /TA0001/ }).click();
  await expect(page).toHaveURL(/\/#\/atlas\/mitre-attack:TACTIC-TA0001\?/);
  await page.reload();
  await waitForAppReady(page);
  await expect(page.locator(".atlas-workspace-heading")).toHaveText("Connections");
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

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/atlas?node=disa-cci%3ACCI-000366&relationshipView=path");
  await waitForAppReady(page);
  const focused = page.getByRole("region", { name: "Focused Atlas record" });
  const atlasTrace = await focused.locator("[data-displayed-trace]").getAttribute("data-displayed-trace");
  expect(atlasTrace).toBe(recordTrace);

  await expect(page.locator(".react-flow")).toHaveCount(0);
  // The publisher adds rules under this CCI on refresh, so the count is read, not pinned.
  const implementation = focused.getByRole("button", { name: /^Implementation [\d,]+/ });
  const count = (await implementation.textContent()).match(/^Implementation ([\d,]+)/)[1];
  await implementation.click();
  expect(await focused.locator("[data-displayed-trace]").getAttribute("data-displayed-trace")).toBe(recordTrace);
  await expect(focused.getByRole("button", { name: new RegExp(`View all ${count} in List`) })).toBeVisible();
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

  await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-IMPLEMENTATION&atlasFramework=disa-stig&relationshipView=path");
  await waitForAppReady(page);
  const openBrowse = page.getByRole("button", { name: "Browse structure" });
  const target = await openBrowse.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  await openBrowse.click();
  const browse = page.getByRole("navigation", { name: "Current publication structure" });
  await expect(browse).toBeVisible();
  await browse.getByLabel("Search this publication").fill("Oracle Linux 9");
  await browse.getByRole("button", {
    name: "Open Oracle_Linux_9_STIG — Oracle Linux 9 Security Technical Implementation Guide",
    exact: true,
  }).click();
  await expect(page).toHaveURL(/\/#\/atlas\/disa-stig:BENCHMARK-ORACLE-LINUX-9-STIG\?/);
  await expect(page.locator(".atlas-workspace-heading")).toHaveText("Connections");
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBe(0);
});

test("two cold publication loads produce identical structural result order", async ({ browser }) => {
  test.setTimeout(120_000);
  const snapshots = [];
  for (let index = 0; index < 2; index += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-THREAT&atlasFramework=mitre-attack&relationshipView=path");
    await waitForAppReady(page);
    const explorer = page.locator("[data-react-root] [data-atlas-structural-explorer]:visible");
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
