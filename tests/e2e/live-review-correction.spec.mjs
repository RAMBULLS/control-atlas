import { expect, test } from "@playwright/test";

async function waitForReady(page) {
  await expect(page.locator('#app[data-app-ready="true"], #app[data-app-ready="partial"]')).toBeVisible({ timeout: 30000 });
}

async function visibleCollisions(locator, gap = 4) {
  return locator.evaluateAll((elements, safeGap) => {
    const boxes = elements.map((element) => ({
      label: element.textContent?.trim() || element.className,
      box: element.getBoundingClientRect(),
    }));
    return boxes.flatMap((left, index) =>
      boxes.slice(index + 1).flatMap((right) =>
        left.box.right + safeGap <= right.box.left ||
        right.box.right + safeGap <= left.box.left ||
        left.box.bottom + safeGap <= right.box.top ||
        right.box.bottom + safeGap <= left.box.top
          ? []
          : [[left.label, right.label]],
      ),
    );
  }, gap);
}

test("primary clicks expose transition feedback before the route replaces stale content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/assets/*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.goto("/#/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-static-home] [data-app-ready="true"]')).toBeVisible();
  await page.evaluate(() => {
    globalThis.__transitionProbe = { clickAt: 0, shownAt: 0, inert: false, visible: false };
    globalThis.document.addEventListener("click", () => { globalThis.__transitionProbe.clickAt = performance.now(); }, { capture: true, once: true });
    globalThis.addEventListener("control-atlas:route-transition-start", () => {
      const root = globalThis.document.getElementById("root");
      const transition = root?.querySelector("[data-route-transition]");
      globalThis.__transitionProbe.shownAt = performance.now();
      globalThis.__transitionProbe.visible = Boolean(transition && !transition.hasAttribute("hidden"));
      globalThis.__transitionProbe.inert = Boolean(root?.querySelector("main[inert]"));
    }, { once: true });
  });
  await page.getByRole("link", { name: "Atlas", exact: true }).click();
  await waitForReady(page);
  const probe = await page.evaluate(() => globalThis.__transitionProbe);
  expect(probe.shownAt - probe.clickAt).toBeLessThanOrEqual(100);
  expect(probe.visible).toBe(true);
  expect(probe.inert).toBe(true);
  // The Atlas link lands on the unscoped landing, which is the board of
  // groups. The assertion is that the destination's own content replaced the
  // stale route, so it tracks whatever the landing actually renders.
  await expect(page.locator(".terr")).toBeVisible();
});

for (const viewport of [
  { width: 320, height: 740 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 900, height: 1000 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`responsive Atlas shell is collision and overflow free at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas?atlasLimb=atlas%3ALIMB-COMPLIANCE");
    await waitForReady(page);
    const dimensions = await page.evaluate(() => ({
      clientWidth: globalThis.document.documentElement.clientWidth,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    const atlas = page.locator(".atl");
    await expect(atlas).toBeVisible();
    expect(await visibleCollisions(atlas.locator(".atl-top > *:visible, .atl-m-head > *:visible"))).toEqual([]);
    if (viewport.width < 1024) {
      const search = page.getByRole("button", { name: "Open search" });
      const menu = page.getByRole("button", { name: "Open navigation menu" });
      for (const control of [search, menu]) {
        const box = await control.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
}

for (const zoom of [
  { label: "100%", width: 1440, height: 900 },
  { label: "125%", width: 1152, height: 720 },
  { label: "200%", width: 720, height: 450 },
]) {
  test(`desktop-equivalent ${zoom.label} zoom preserves navigation and content`, async ({ page }) => {
    await page.setViewportSize({ width: zoom.width, height: zoom.height });
    await page.goto("/#/start");
    await waitForReady(page);
    const dimensions = await page.evaluate(() => ({
      clientWidth: globalThis.document.documentElement.clientWidth,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    await expect(page.getByRole("heading", { name: "Start here", level: 1 })).toBeVisible();
  });
}

test("reduced motion keeps the complete Atlas visible without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/atlas");
  await waitForReady(page);
  const atlas = page.locator(".terr");
  await expect(atlas).toBeVisible();
  const animatedDescendants = await atlas.locator("*").evaluateAll((elements) =>
    elements
      .filter((element) => globalThis.getComputedStyle(element).animationName !== "none")
      .map((element) => `${element.tagName.toLowerCase()}.${element.className.baseVal ?? element.className}`),
  );
  expect(animatedDescendants).toEqual([]);
});

test("Atlas first paint is a semantic map with drill-down and history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/atlas");
  await waitForReady(page);
  const atlas = page.locator(".terr");
  await expect(atlas).toBeVisible();
  // Every territory and landmark is on screen at first paint, labelled.
  await expect(atlas.locator(".district")).toHaveCount(9);
  await expect(atlas.locator(".lm")).toHaveCount(28);

  // The map paints before its handlers are attached; WebKit on a shared runner can click in that gap. Retry the click, not the assertion.
  await expect(async () => {
    await atlas.locator('[data-landmark="mitre-attack"]').click();
    await expect(page).toHaveURL(/atlasFramework=mitre-attack/, { timeout: 4_000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.locator(".atl-inspector")).toContainText("ATT&CK");

  // History still walks back out of the map one level at a time.
  await page.reload();
  await waitForReady(page);
  await expect(page).toHaveURL(/atlasFramework=mitre-attack/);
  await page.goBack();
  await expect(page).not.toHaveURL(/atlasFramework=/);
});

test("focused Atlas record stays collision and overflow free across desktop and compact layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/atlas?node=nist-800-53%3AAC-2&relationshipView=map");
  await waitForReady(page);
  await expect(page.locator(".atl-inspector")).toContainText("AC-2", { timeout: 20000 });
  // Header, journeys, actions and map are stacked blocks; the details panel sits inside the map.
  expect(await visibleCollisions(page.locator(".atl > *:visible"), 0)).toEqual([]);
  expect(await visibleCollisions(page.locator(".atl-inspector, .atl-pill--other"), 4)).toEqual([]);
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#atl-focus")).toContainText("AC-2");
  expect(await visibleCollisions(page.locator(".atl--mobile > *:visible"), 4)).toEqual([]);
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("global Search handles empty, IME, exact-ID, Enter, Clear, Close, and Escape", async ({ page }) => {
  await page.goto("/#/about");
  await waitForReady(page);
  await page.getByRole("button", { name: "Open search" }).click();
  const dialog = page.getByRole("dialog", { name: "Search Control Atlas" });
  const search = dialog.getByRole("searchbox", { name: "Search Control Atlas" });
  await search.focus();
  await expect(dialog.locator(".search-overlay-input")).toHaveCSS("outline-style", "solid");
  await expect(dialog.locator(".search-overlay-input")).toHaveCSS("box-shadow", "none");
  await expect(search).toHaveCSS("outline-style", "none");
  await expect(search).toHaveCSS("box-shadow", "none");
  await search.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Enter an identifier");
  await search.fill("T1195.002");
  await expect(dialog.getByRole("button", { name: "Clear search" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close search" })).toBeVisible();
  await search.dispatchEvent("compositionstart");
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/about/);
  await search.dispatchEvent("compositionend");
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/library\?q=T1195\.002/);
  await waitForReady(page);
  const title = await page.locator('.workspace-result-row[data-result-class="published-record"] h3').first().innerText();
  expect((title.match(/T1195\.002/gi) || []).length).toBe(1);
  await page.getByRole("button", { name: "Open search" }).click();
  await page.getByRole("dialog", { name: "Search Control Atlas" }).getByRole("searchbox").fill("access control");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search Control Atlas" })).toHaveCount(0);
});

test("ranked search exposes desktop filters, sort, active chips, and mobile drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/search?q=access&kind=requirements&sort=identifier");
  await waitForReady(page);
  await expect(page.locator(".workspace-facet-rail")).toBeVisible();
  await expect(page.locator(".workspace-result-count")).toContainText(/match/);
  await expect(page.getByLabel("Sort Library results")).toHaveValue("identifier");
  await expect(page.locator(".search-result-groups")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Requirements/ }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("dialog", { name: "Library filters" })).toBeVisible();
  await page.getByRole("button", { name: "Close filters" }).click();
});

test("Start Here preserves answers across URL history and names its destination", async ({ page }) => {
  await page.goto("/#/start");
  await waitForReady(page);
  await page.getByRole("button", { name: "Secure or build a system" }).click();
  await expect(page).toHaveURL(/goal=implement/);
  await page.getByRole("button", { name: "CUI contractor environment" }).click();
  await expect(page).toHaveURL(/goal=implement.*context=cui|context=cui.*goal=implement/);
  await expect(page.getByRole("heading", { name: "Start with SP 800-171 Rev. 2" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/goal=implement/);
  await expect(page).not.toHaveURL(/context=/);
  await page.goForward();
  await expect(page).toHaveURL(/context=cui/);
  await page.reload();
  await waitForReady(page);
  await expect(page.getByRole("heading", { name: /Start with SP 800-171/ })).toBeVisible();
  await page.getByRole("link", { name: /Open SP 800-171/ }).click();
  await expect(page).toHaveURL(/#\/library\/publication\/nist-800-171-rev2/);
});

test("desktop primary navigation remains visible and retired mode parameters canonicalize away", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=novice#");
  await expect(page).not.toHaveURL(/mode=novice/);
  for (const label of ["Start here", "Atlas", "Library", "Compare", "Resources", "Templates"]) {
    await expect(page.locator(".site-header .primary-nav:visible").getByRole("link", { name: label, exact: true })).toBeVisible();
  }
});
