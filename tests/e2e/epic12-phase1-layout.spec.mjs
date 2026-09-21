import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

const ROUTES = [
  "/#/",
  "/#/explore",
  "/#/catalog",
  "/#/search?q=access+control",
  "/#/record/fips-200/AC",
  "/#/compare",
  "/#/learn",
  "/#/build",
  "/#/sources",
  "/#/about",
  "/#/start",
];

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "laptop", width: 1024, height: 768 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "mobile", width: 375, height: 812 },
];

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

for (const viewport of VIEWPORTS) {
  test(`Epic 12 Phase 1 keeps chrome and content ordered at ${viewport.label}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of ROUTES) {
      await test.step(route, async () => {
        await gotoApp(page, route);
        await waitForAppReady(page, { allowPartial: true });

        if (route === "/#/explore") {
          const sheet = page.locator(".atl");
          await expect(sheet).toBeVisible();
          // Labelled controls at every width, and no canvas or disclosure
          // standing between the visitor and the corpus.
          await expect(page.locator("canvas")).toHaveCount(0);
          await expect(page.locator("#atlas-search")).toBeVisible();
        }

        await expect(page.locator(".static-route-shell")).toHaveCount(0);
        await expect(page.locator("#workspace h1")).toHaveCount(1, {
          timeout: 15_000,
        });
        if (route !== "/#/") {
          await expect(
            page.locator("#workspace [data-route-primary-header]"),
          ).toHaveCount(1, { timeout: 15_000 });
        }
        const pageHeaderHeight = route === "/#/"
          ? null
          : await page
              .locator("#workspace [data-route-primary-header]")
              .evaluate((element) => element.getBoundingClientRect().height);

        const layout = await page.evaluate(() => {
          const header = globalThis.document.querySelector("header.site-header");
          const firstHeading = globalThis.document.querySelector("#workspace h1");
          const appShell = globalThis.document.querySelector("#app");
          const appBox = appShell?.getBoundingClientRect();
          const outOfBounds = appBox
            ? [...appShell.querySelectorAll("*")]
                .filter((element) => {
                  const box = element.getBoundingClientRect();
                  const style = globalThis.getComputedStyle(element);
                  return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    box.width > 0 &&
                    (box.right > appBox.right + 2 || box.left < appBox.left - 2)
                  );
                })
                .map((element) => {
                  const box = element.getBoundingClientRect();
                  return {
                    className: element.className || "",
                    left: box.left,
                    right: box.right,
                    tagName: element.tagName,
                    text: element.textContent?.trim().slice(0, 80) || "",
                  };
                })
                .slice(0, 10)
            : [];
          const overflows = [...globalThis.document.querySelectorAll("body *")]
            .filter((element) => {
              const style = globalThis.getComputedStyle(element);
              const overflowX = style.overflowX;
              return (
                element.clientWidth > 100 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.textOverflow !== "ellipsis" &&
                overflowX !== "auto" &&
                overflowX !== "scroll" &&
                element.scrollWidth > element.clientWidth + 2
              );
            })
            .map((element) => ({
              className: element.className || "",
              clientWidth: element.clientWidth,
              id: element.id || "",
              parentClassName: element.parentElement?.className || "",
              scrollWidth: element.scrollWidth,
              tagName: element.tagName,
              text: element.textContent?.trim().slice(0, 80) || "",
            }));

          return {
            firstHeadingY: firstHeading?.getBoundingClientRect().y ?? null,
            headerCount: globalThis.document.querySelectorAll("header.site-header").length,
            headerY: header?.getBoundingClientRect().y ?? null,
            landmarkCounts: {
              footer: globalThis.document.querySelectorAll("footer").length,
              h1: globalThis.document.querySelectorAll("h1").length,
              main: globalThis.document.querySelectorAll("main").length,
              skipLink: globalThis.document.querySelectorAll(".skip-link").length,
            },
            outOfBounds,
            overflows,
          };
        });

        expect(layout.headerCount, `${route} header count`).toBe(1);
        expect(layout.headerY, `${route} header y`).toBe(0);
        expect(layout.landmarkCounts, `${route} landmark counts`).toEqual({
          footer: 1,
          h1: 1,
          main: 1,
          skipLink: 1,
        });
        expect(
          layout.firstHeadingY,
          `${route} first meaningful content y`,
        ).not.toBeNull();
        expect(layout.firstHeadingY).toBeLessThan(viewport.width === 375 ? 480 : 400);
        if (route !== "/#/") {
          expect(pageHeaderHeight, `${route} primary pagehead`).not.toBeNull();
          // Record pages carry the accepted title, identity and status block, and long titles wrap
          // at tablet width, so they get a taller budget than a plain page header.
          const tabletBudget = route.startsWith("/#/record/") ? 260 : 220;
          expect(pageHeaderHeight).toBeLessThanOrEqual(viewport.width === 375 ? 300 : tabletBudget);
        }
        expect(
          layout.overflows,
          `${route} overflowing elements; out of bounds: ${JSON.stringify(layout.outOfBounds)}`,
        ).toEqual([]);
      });
    }
  });
}

test("compact Sources header stays opaque while content scrolls beneath it", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await gotoApp(page, "/#/sources");
    await waitForAppReady(page, { allowPartial: true });
    await page.evaluate(() => globalThis.scrollTo(0, 700));

    const compactHeader = await page.locator("header.site-header").evaluate((header) => {
      const style = globalThis.getComputedStyle(header);
      const background = style.backgroundColor;
      const alphaMatch = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(background);
      return {
        alpha: alphaMatch ? Number(alphaMatch[1]) : 1,
        backdropFilter: style.backdropFilter,
        background,
        top: header.getBoundingClientRect().top,
      };
    });

    expect(compactHeader.top).toBe(0);
    expect(compactHeader.alpha, compactHeader.background).toBe(1);
    expect(compactHeader.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(["", "none"]).toContain(compactHeader.backdropFilter);
  }
});

test("record template leads with publisher text and omits generated guidance", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, "/#/record/nist-800-53/AC-2");
  await waitForAppReady(page, { allowPartial: true });
  await expect(page.locator('[data-template="E"]')).toBeVisible({ timeout: 15_000 });

  const firstMainSection = page.locator(".record-template-main > .record-official-text > section").first();
  await expect(firstMainSection).toHaveAttribute("data-source-field", "description");
  await expect(firstMainSection.getByRole("heading", { name: "Control Statement" })).toBeVisible();
  await expect(page.locator(".record-guidance, .record-developer-details")).toHaveCount(0);
  await expect(page.locator('[data-record-section="related-records"]')).toBeVisible();
});
