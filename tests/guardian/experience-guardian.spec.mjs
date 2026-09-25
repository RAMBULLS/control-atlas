import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const matrix = JSON.parse(
  await readFile("config/experience-guardian/route-matrix.json", "utf8"),
);
const outputDir = join(process.cwd(), "artifacts", "experience-guardian");
const screenshotDir = join(outputDir, "screenshots");

await mkdir(screenshotDir, { recursive: true });

const cases = matrix.states.flatMap((state) =>
  state.viewports.map((viewport) => ({
    state,
    viewport,
    size: matrix.viewports[viewport],
  })),
);

test.describe("Control Atlas Experience Guardian", () => {
  for (const reviewCase of cases) {
    const { state, viewport, size } = reviewCase;
    test(`${state.breakpointSample ? "[family] " : ""}${state.id} · ${viewport}`, async ({ page }) => {
      await page.setViewportSize(size);

      if (state.scenario === "loading") {
        await page.route("**/catalog-bootstrap.json", async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await route.continue();
        });
        await page.goto(state.path, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(350);
      } else {
        await page.goto(state.path);
        await expect(page.locator('[data-app-ready="true"]')).toBeVisible({
          timeout: 30000,
        });
      }

      const screenshot = join(screenshotDir, `${state.id}--${viewport}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });

      if (state.scenario === "loading") {
        await expect(page.locator("body")).toContainText(/loading|opening|search/i);
        return;
      }

      await expect(page.locator("h1:visible").first()).toBeVisible();
      if (state.expectedIdentity) {
        await expect(
          page.locator(`[data-visual-identity="${state.expectedIdentity}"]`).first(),
        ).toBeVisible();
      }
      if (state.expectedTemplate) {
        await expect(
          page.locator(`[data-page-template="${state.expectedTemplate}"], [data-template="${state.expectedTemplate}"]`).first(),
        ).toBeVisible();
      }

      const visibleHeaders = await page.locator(".site-header:visible").count();
      expect(visibleHeaders, "Static and React shells must expose exactly one visible global header").toBe(1);

      if (viewport === "desktop") {
        await expect(page.locator(".site-header .primary-nav:visible")).toBeVisible();
      }

      if (state.id === "atlas-overview") {
        await expect(page.getByRole("button", { name: "RMF & ATO" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Policy & directives" })).toBeVisible();
        await expect(page.locator(viewport === "desktop" ? ".terr" : ".atl--mobile")).toBeVisible();
      }

      if (state.id === "atlas-focused") {
        await expect(page.getByRole("link", { name: "Full connection list" })).toBeVisible({ timeout: 20000 });
      }

      if (["mixed-search", "exact-search", "filtered-search"].includes(state.id)) {
        await expect(page.locator(".search-result-count")).toBeVisible();
        await expect(page.locator(".search-sort select")).toBeVisible();
        await expect(page.locator(".search-result-groups")).toHaveCount(0);
        if (viewport === "desktop") {
          await expect(page.locator(".search-filter-rail")).toBeVisible();
        } else {
          await page.getByRole("button", { name: /Filters/ }).click();
          await expect(page.getByRole("dialog", { name: "Filter search results" })).toBeVisible();
          await page.getByRole("button", { name: "Close filters" }).click();
        }
      }

      if (["compare", "guides", "templates", "resource-detail"].includes(state.id)) {
        const deadSpace = await page.evaluate(() => {
          const main = globalThis.document.querySelector("#workspace");
          const footer = globalThis.document.querySelector("footer");
          if (!main || !footer) return 0;
          const visible = [...main.querySelectorAll("*")].filter((element) => {
            const style = globalThis.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.height > 0;
          });
          const contentBottom = Math.max(main.getBoundingClientRect().top, ...visible.map((element) => element.getBoundingClientRect().bottom));
          return Math.max(0, Math.round(footer.getBoundingClientRect().top - contentBottom));
        });
        expect(deadSpace, `Unexpected ${deadSpace}px gap before the footer`).toBeLessThanOrEqual(160);
      }

      if (state.officialBeforeEditorial && viewport === "mobile") {
        const order = await page.evaluate(() => {
          const official = globalThis.document.querySelector(
            '.record-template-main [data-record-section="official-text"]',
          );
          const context = globalThis.document.querySelector(".record-template-sidebar");
          if (!official || !context) return "missing";
          return official.compareDocumentPosition(context) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING
            ? "official-first"
            : "context-first";
        });
        expect(order).toBe("official-first");
      }

      const cards = await page.locator(".result-card, .summary-card, .card").count();
      const signatures = await page
        .locator(".result-card, .summary-card, .card")
        .evaluateAll((elements) => new Set(elements.map((element) => element.className)).size);
      if (cards >= 14 && signatures / cards < 0.2) {
        console.warn(
          `Guardian warning: ${state.path} at ${viewport} has ${cards} card-like regions across ${signatures} class signatures.`,
        );
      }

      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact),
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }

});
