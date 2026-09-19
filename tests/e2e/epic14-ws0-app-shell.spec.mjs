import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("WS0 direct routes own exactly one main landmark without Home stacked above them", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const routes = [
    { path: "/#/", view: "home", marker: page.locator(".home-entry") },
    { path: "/#/atlas", view: "atlas-map", marker: page.locator(".terr") },
    { path: "/#/library", view: "search", marker: page.getByRole("heading", { name: "Library", exact: true }) },
    { path: "/#/resources", view: "commons", marker: page.getByRole("heading", { name: "Resources", exact: true, level: 1 }) },
    { path: "/#/guides", view: "patterns", marker: page.getByRole("heading", { name: "Guides", exact: true }) },
    { path: "/#/record/nist-800-53/AC-2", view: "library-detail", marker: page.locator("#workspace h1") },
    { path: "/#/compare", view: "matrix" },
    { path: "/#/build", view: "templates" },
    { path: "/#/sources", view: "sources" },
    { path: "/#/about", view: "about" },
    { path: "/#/start", view: "start-here" },
  ];

  for (const { path, view, marker } of routes) {
    await gotoApp(page, path);
    await waitForAppReady(page, { allowPartial: true });

    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main#workspace")).toHaveCount(1);
    await expect(page.locator("#app")).toHaveAttribute("data-view", view);
    await expect(page.locator(".home-entry")).toHaveCount(
      view === "home" ? 1 : 0,
    );
    await expect(page.locator("[data-static-home]")).toHaveCount(
      view === "home" ? 1 : 0,
    );
    if (!marker) continue;

    await expect(marker).toBeVisible({ timeout: 30_000 });

    const top = await marker.evaluate((element) =>
      element.getBoundingClientRect().top
    );
    expect(top, `${path} content must begin in the first viewport`).toBeLessThan(900);
  }
});

test("desktop header exposes task destinations, Search, and reference overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/library");
  await waitForAppReady(page, { allowPartial: true });

  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primary.getByRole("link")).toHaveText([
    "Start here",
    "Atlas",
    "Library",
    "Compare",
    "Resources",
    "Templates",
  ]);
  await expect(page.getByRole("button", { name: "Open search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveCount(0);
  // One hidden sizer reserves the width of the longest rotating word so the
  // masthead cannot shift and no word is clipped. It must never be visible,
  // and only one word may ever be readable at a time.
  await expect(page.locator("header.site-header .brand-key-sizer")).toHaveCount(1);
  await expect(page.locator("header.site-header .brand-key-sizer:visible")).toHaveCount(0);
  await expect(page.locator("header.site-header .brand-key-word:visible")).toHaveCount(1);

  await page.getByRole("button", { name: "Open more pages" }).click();
  const overflow = page.getByRole("navigation", { name: "More pages" });
  await expect(overflow).toBeVisible();
  await expect(overflow.getByRole("link")).toHaveText([
    "Guides",
    "Sources",
    "About",
  ]);
});

test("WS0 static Home hands its one menu control to the responsive React header", async ({
  page,
}) => {
  for (const { width, openLabel, navigationLabel } of [
    { width: 1440, openLabel: "Open more pages", navigationLabel: "More pages" },
    { width: 800, openLabel: "Open navigation menu", navigationLabel: "Primary navigation (mobile)" },
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, "/#/");
    await page.reload();
    await expect(page.locator("#root")).toHaveAttribute("data-react-active", "false");
    await expect(page.locator("main")).toHaveCount(1);

    await page.getByRole("button", { name: openLabel }).click();
    await expect(page.getByRole("navigation", { name: navigationLabel })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("main")).toHaveCount(1);
  }
});

test("WS0 restores an interactive Home landmark when React boot fails", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/assets\/App-[^/]+\.js$/, (route) => route.abort());
  await gotoApp(page, "/#/");
  await page.reload();

  await page.getByRole("button", { name: "Open more pages" }).click();
  const homeMain = page.locator("[data-static-home] main#workspace");
  await expect(homeMain).toBeVisible({ timeout: 10_000 });
  await expect(homeMain).not.toHaveAttribute("inert", "");
  await expect(homeMain).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("[data-home-boot-status]")).toHaveText(
    "Interactive features did not load. Reload the page to try again.",
  );
  await expect(page.locator("main")).toHaveCount(1);
});

test("WS0 keeps the Sources identity visible until React owns the route", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  let releaseAppBundle = () => {};
  const appBundleReleased = new Promise((resolve) => {
    releaseAppBundle = () => resolve(undefined);
  });
  await page.route(/\/assets\/App-[^/]+\.js$/, async (route) => {
    await appBundleReleased;
    await route.continue();
  });

  await gotoApp(page, "/#/sources");
  const staticRoute = page.locator("[data-static-route]");
  await expect(staticRoute).toBeVisible();
  await expect(staticRoute.getByRole("heading", { level: 1 })).toHaveText("Sources");

  releaseAppBundle();
  await waitForAppReady(page, { allowPartial: true });
  await expect(staticRoute).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sources", level: 1 })).toHaveCount(1);
});

test("WS0 tablet and mobile use one navigation control with every destination", async ({
  page,
}) => {
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, "/#/about");
    await waitForAppReady(page, { allowPartial: true });

    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open more pages" })).toHaveCount(0);

    const menuButton = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const sheet = page.getByRole("navigation", { name: "Primary navigation (mobile)" });
    await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("link")).toHaveText([
        "Start here",
        "Atlas",
        "Library",
        "Compare",
        "Resources",
        "Templates",
        "Guides",
        "Sources",
        "About",
      ]);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  }
});
