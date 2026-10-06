import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, gotoApp, waitForAppReady } from "./support.mjs";

const SUPPORTED_ROUTES = [
  "/#/",
  "/#/atlas",
  "/#/library",
  "/#/library?q=access+control",
  "/#/compare",
  "/#/guides",
  "/#/build",
  "/#/library?kind=tools-communities",
  "/#/sources",
  "/#/about",
];

const REPRESENTATIVE_RECORD = "/#/record/nist-800-53/AC-2";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function openReady(page, route, options = {}) {
  await gotoApp(page, route);
  await waitForAppReady(page, { allowPartial: true });
  await expect(page.locator("#workspace h1")).toHaveCount(1, { timeout: 60_000 });
  if (route.startsWith("/#/record/")) {
    await expect(page.getByRole("link", { name: "View official source", exact: true }).first()).toBeVisible({ timeout: 60_000 });
  }
  if (options.settleResults) {
    await expect(page.locator(".workspace-result-row").first()).toBeVisible({ timeout: 60_000 });
  }
}

test("Phase 5 renders canonical destinations as native links with working modified clicks", async ({ context, page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReady(page, "/#/library?q=AC-2", { settleResults: true });

  const recordLinks = page.locator('[data-result-class="published-record"] .workspace-result-row__link');
  expect(await recordLinks.count()).toBeGreaterThan(0);
  for (const link of await recordLinks.all()) {
    await expect(link).toHaveJSProperty("tagName", "A");
    await expect(link).toHaveAttribute("href", /^#\/record\//);
  }

  const firstRecord = recordLinks.first();
  const expectedHref = await firstRecord.getAttribute("href");
  const [newTab] = await Promise.all([
    context.waitForEvent("page"),
    firstRecord.click({ modifiers: ["Control"] }),
  ]);
  await newTab.waitForLoadState("domcontentloaded");
  await waitForAppReady(newTab, { allowPartial: true });
  expect(new URL(newTab.url()).hash).toBe(expectedHref);
  await expect(newTab.locator("#workspace h1")).toHaveCount(1);
  await newTab.close();

  await openReady(page, "/#/library/publication/nist-800-53");
  await page.getByRole("button", { name: /^Browse all / }).click();
  const publicationRecordLinks = page.locator(".catalog-record-title");
  await expect(publicationRecordLinks.first()).toBeVisible({ timeout: 60_000 });
  await expect(publicationRecordLinks.first()).toHaveJSProperty("tagName", "A");
  await expect(publicationRecordLinks.first()).toHaveAttribute("href", /^#\/record\//);

  await openReady(page, "/#/start?goal=understand&context=federal");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/atlas?atlasJourney=controls");
  await expect(page.getByRole("link", { name: "Explore RMF & ATO" })).toHaveCount(0);

  await openReady(page, REPRESENTATIVE_RECORD);
  const officialSourceLinks = page.getByRole("link", { name: "View official source", exact: true });
  expect(await officialSourceLinks.count()).toBeGreaterThan(0);
  for (const link of await officialSourceLinks.all()) {
    await expect(link).toHaveAttribute("href", /^https:\/\//);
  }
  await expect(page.getByRole("link", { name: "See connections", exact: true })).toHaveAttribute("href", /^#\/atlas(?:\/|\?)/);

  const destinationButtons = page.locator([
    "button.brand",
    "header.site-header nav button:not([aria-controls])",
    "footer.site-footer button[role=link]",
    "button.workspace-result-row__link",
    "button.catalog-record-title",
    "button.catalog-index-row",
    "button.relationship-card",
    "button.resource-context-link",
    "button.home-tool",
    "button.learn-article-grid",
  ].join(","));
  await expect(destinationButtons).toHaveCount(0);
});

test("Phase 5 exposes one main, one h1, semantic result lists, and distinct combobox names", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const route of [...SUPPORTED_ROUTES, REPRESENTATIVE_RECORD]) {
    await test.step(route, async () => {
      await openReady(page, route);
      const structure = await page.evaluate(() => ({
        h1: globalThis.document.querySelectorAll("h1").length,
        main: globalThis.document.querySelectorAll("main").length,
        visibleMain: [...globalThis.document.querySelectorAll("main")].filter((element) => {
          const style = globalThis.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        }).length,
        workspaceMain: globalThis.document.querySelectorAll("main#workspace").length,
      }));
      expect(structure, route).toEqual({ h1: 1, main: 1, visibleMain: 1, workspaceMain: 1 });

      const names = await page.locator('select:visible, input[list]:visible, [role="combobox"]:visible').evaluateAll((controls) =>
        controls.map((control) => {
          const element = /** @type {HTMLInputElement | HTMLSelectElement} */ (control);
          const labels = element.labels
            ? Array.from(element.labels).map((label) => label.textContent?.trim()).filter(Boolean)
            : [];
          return element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || labels.join(" ");
        }),
      );
      expect(names.every((name) => Boolean(name) && name.trim().toLowerCase() !== "all"), `${route}: ${names.join(" | ")}`).toBe(true);
      expect(new Set(names).size, `${route}: ${names.join(" | ")}`).toBe(names.length);
    });
  }

  await openReady(page, "/#/library?q=access+control", { settleResults: true });
  const resultList = page.locator("ul.workspace-result-list");
  await expect(resultList).toBeVisible();
  expect(await resultList.locator(":scope > li").count()).toBeGreaterThan(0);
  await expect(resultList.locator(":scope > li article h3").first()).toBeVisible();
  await expect(resultList.locator(":scope > li article h2")).toHaveCount(0);
});

test("Phase 5 keeps every visible enabled interaction at least 44 by 44 at 375px", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 375, height: 812 });

  for (const route of [...SUPPORTED_ROUTES, REPRESENTATIVE_RECORD]) {
    await test.step(route, async () => {
      await openReady(page, route);
      const undersized = await page.evaluate(() => {
        const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary';
        return [...globalThis.document.querySelectorAll(selector)].flatMap((element) => {
          const control = /** @type {HTMLElement & { disabled?: boolean }} */ (element);
          const style = globalThis.getComputedStyle(control);
          const rect = control.getBoundingClientRect();
          const visible =
            !control.hidden &&
            !control.closest("[hidden], [inert]") &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            control.getClientRects().length > 0 &&
            rect.width > 0 &&
            rect.height > 0;
          if (
            !visible ||
            control.classList.contains("visually-hidden") ||
            control.disabled ||
            control.getAttribute("aria-disabled") === "true"
          ) return [];
          if (rect.width >= 43.5 && rect.height >= 43.5) return [];
          return [{
            height: Number(rect.height.toFixed(2)),
            label: control.getAttribute("aria-label") || control.textContent?.trim().slice(0, 80) || control.tagName,
            tag: control.tagName,
            width: Number(rect.width.toFixed(2)),
          }];
        });
      });
      expect(undersized, `${route}: ${JSON.stringify(undersized)}`).toEqual([]);
    });
  }

  await openReady(page, "/#/about");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const mobileTargets = await page.locator('#mobile-nav-sheet a[href]').evaluateAll((links) => links.map((link) => {
    const rect = link.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(mobileTargets.length).toBeGreaterThan(0);
  expect(mobileTargets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
});

test("Phase 5 closes overlays on route changes and never stacks them", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openReady(page, "/#/library?q=access+control", { settleResults: true });

  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("dialog", { name: "Library filters" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search Control Atlas" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Library filters" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);

  await page.evaluate(() => { globalThis.location.hash = "#/about"; });
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.locator("#mobile-nav-sheet")).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.locator("#mobile-nav-sheet")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Search Control Atlas" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("Phase 5 applies aria-current only to the canonical active destination", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const cases = [
    ["/#/start", "Atlas"],
    ["/#/library", "Library"],
    ["/#/library/publication/nist-800-53", "Library"],
    ["/#/build", "Templates"],
  ];
  for (const [route, label] of cases) {
    await openReady(page, route);
    const current = page.locator('header.site-header nav a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(label);
  }

  for (const [route, label] of [["/#/guides", "Guides"], ["/#/sources", "Sources"], ["/#/about", "About"]]) {
    await openReady(page, route);
    await page.getByRole("button", { name: "Open more pages" }).click();
    const current = page.getByRole("navigation", { name: "More pages" }).locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(label);
  }

  await openReady(page, REPRESENTATIVE_RECORD);
  await expect(page.locator('header.site-header nav a[aria-current="page"]')).toHaveCount(0);
});

test("Phase 5 has zero serious or critical axe violations on 11 routes plus a record", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of [...SUPPORTED_ROUTES, REPRESENTATIVE_RECORD]) {
    await test.step(route, async () => {
      await openReady(page, route);
      const results = await new AxeBuilder({ page })
        .include("#workspace")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact || ""),
      );
      expect(blocking, `${route}: ${blocking.map((entry) => entry.id).join(", ")}`).toEqual([]);
    });
  }
});
