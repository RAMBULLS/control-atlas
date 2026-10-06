import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

const ROUTE_GROUPS = [
  {
    label: "entry and guidance",
    routes: [
      "/#/",
      "/#/search?q=AC-2",
      "/#/explore",
      "/#/explore?node=nist-800-53%3AAC-2&relationshipView=path",
      "/#/explore?node=nist-800-53%3AAC-2&relationshipView=map",
      "/#/explore?node=nist-800-53%3AAC-2&relationshipView=list",
    ],
  },
  {
    label: "catalog and records",
    routes: [
      "/#/catalog",
      "/#/catalog/nist-800-53",
      "/#/catalog/nist-800-53?browseAll=true",
      "/#/record/nist-800-53/AC-2",
    ],
  },
  {
    label: "build and resources",
    routes: [
      "/#/build",
      "/#/build/documents",
      "/#/build/documents/security_plan_starter",
      "/#/resources",
      "/#/resources/official-nist-oscal",
    ],
  },
  {
    label: "workbenches and trust",
    routes: [
      "/#/compare",
      "/#/learn",
      "/#/sources",
      "/#/about",
      "/#/does-not-exist",
    ],
  },
];

const VIEWPORTS = [
  { label: "mobile", width: 375, height: 812 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "laptop", width: 1280, height: 800 },
  { label: "desktop", width: 1440, height: 900 },
];

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

for (const viewport of VIEWPORTS) {
  for (const group of ROUTE_GROUPS) {
    test(`responsive audit: ${group.label} fit the ${viewport.label} viewport`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      for (const route of group.routes) {
        try {
          await test.step(route, async () => {
            await gotoApp(page, route);
            await waitForAppReady(page);
            await dismissOnboarding(page);
            await expect(
              page.locator("h1:visible, main h2:visible").first(),
              route,
            ).toBeVisible();

            if (route === "/#/") {
              const search = page.getByRole("search");
              const wordmark = page.locator(".site-header:visible .brand-name").last();
              await expect(search).toBeVisible();
              await expect(wordmark).toBeVisible();
              expect(
                (await search.boundingBox())?.y,
                "Home Search must start inside the first viewport",
              ).toBeLessThan(viewport.height);
            }

            const overflow = await page.evaluate(() => ({
              body:
                globalThis.document.body.scrollWidth -
                globalThis.document.body.clientWidth,
              document:
                globalThis.document.documentElement.scrollWidth -
                globalThis.document.documentElement.clientWidth,
            }));
            expect(
              overflow,
              `${route} must not create document-level horizontal overflow`,
            ).toEqual({ body: 0, document: 0 });

            const misalignedCompactControls = await page.evaluate(() => {
              const selectors = [
                '.ca-button',
                '.ca-tab',
                '.active-filter-chip',
                '.clear-filter-link',
                '.workbench-toggle button',
                '.relationship-view-tabs .tab',
                '.atlas-view-tabs button',
                '.source-view-toggle button',
                '.library-view-toggle button',
                '.workspace-view-toggle button',
                '.resource-type-chips button',
                '.resources-filter-toggle',
                '.search-mobile-filter-button',
                '.workspace-mobile-filter-button',
                '.drawer-tab',
                '.compare-mode-tab',
                '.atlas-decomp__orientation-button',
              ];
              return [...globalThis.document.querySelectorAll(selectors.join(','))]
                .filter((control) => {
                  const box = control.getBoundingClientRect();
                  return box.width > 0 && box.height > 0;
                })
                .map((control) => {
                  const style = globalThis.getComputedStyle(control);
                  const controlBox = control.getBoundingClientRect();
                  const icon = control.querySelector(':scope > svg');
                  const iconBox = icon?.getBoundingClientRect();
                  return {
                    selector: `${control.tagName.toLowerCase()}.${[...control.classList].join('.')}`,
                    display: style.display,
                    alignItems: style.alignItems,
                    justifyContent: style.justifyContent,
                    iconOffset: iconBox
                      ? Math.abs(
                          (controlBox.top + controlBox.height / 2) -
                            (iconBox.top + iconBox.height / 2),
                        )
                      : 0,
                  };
                })
                .filter(
                  ({ display, alignItems, justifyContent, iconOffset }) =>
                    !['flex', 'inline-flex'].includes(display) ||
                    alignItems !== 'center' ||
                    justifyContent !== 'center' ||
                    iconOffset > 1.5,
                );
            });
            expect(
              misalignedCompactControls,
              `${route} compact controls must keep labels and icons centered`,
            ).toEqual([]);

            const controlOwners = await page.evaluate(() =>
              [...globalThis.document.querySelectorAll("[data-controls-for]")].map(
                (surface) => {
                  const targetId = surface.getAttribute("data-controls-for") || "";
                  const targets = globalThis.document.querySelectorAll(
                    `#${globalThis.CSS.escape(targetId)}`,
                  );
                  const target = targets[0];
                  const surfaceBox = surface.getBoundingClientRect();
                  const targetBox = target?.getBoundingClientRect();
                  return {
                    targetId,
                    targetCount: targets.length,
                    visiblyOwned:
                      Boolean(target) &&
                      (surface.contains(target) ||
                        target.contains(surface) ||
                        (targetBox?.top || 0) >= surfaceBox.bottom - 1),
                  };
                },
              ),
            );
            for (const owner of controlOwners) {
              expect(owner.targetCount, `${owner.targetId} must exist once`).toBe(1);
              expect(
                owner.visiblyOwned,
                `${owner.targetId} must stay attached to its control surface`,
              ).toBe(true);
            }

            if (route.includes("/#/catalog/nist-800-53")) {
              const sourceAction = page.locator(".catalog-source-link");
              const toolbar = page.locator(".catalog-record-toolbar");
              await expect(sourceAction).toBeVisible();
              await expect(toolbar).toBeVisible();
              const sourceBox = await sourceAction.boundingBox();
              expect(sourceBox?.height).toBeGreaterThanOrEqual(44);
              expect(sourceBox?.width).toBeLessThanOrEqual(viewport.width);
            }
          });
        } catch (error) {
          await testInfo.attach("route-group-failure.json", {
            body: Buffer.from(JSON.stringify({
              group: group.label,
              route,
              viewport,
              url: page.url(),
              title: await page.title(),
            }, null, 2)),
            contentType: "application/json",
          });
          throw error;
        }
      }
    });
  }
}
