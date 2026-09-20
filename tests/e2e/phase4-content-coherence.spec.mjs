import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test("Phase 4 Guides provide a complete procedural handoff", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/guides?pattern=starting-an-authorization");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const article = page.getByRole("article");
  for (const heading of [
    "Goal",
    "When it matters",
    "Before you start",
    "Steps",
    "Output and checks",
    "What this means",
    "Limitations",
    "Official references",
  ]) {
    await expect(article.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
  }
  await expect(article.locator(".guide-procedure-steps > li")).toHaveCount(3);
  await expect(article.getByText("Expected output:")).toBeVisible();
  expect(await page.evaluate(() => (
    globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth
  ))).toBe(true);
});

test("Phase 4 Templates expose setup and output, then preview document structure", async ({ page }) => {
  await page.goto("/#/build/documents");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const firstDocument = page.locator(".template-card-details").first();
  await expect(firstDocument).toContainText("Setup:");
  await expect(firstDocument).toContainText("Output:");

  await page.goto("/#/build/documents/security_plan_starter?framework=nist-800-53&baseline=MODERATE");
  await waitForAppReady(page);
  const preview = page.locator(".template-document-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator(".template-document-preview-summary")).toContainText("Sections");
  await expect(preview.locator(".template-document-preview-outline li")).toHaveCount(13);
  await expect(preview.locator(".template-document-preview-outline")).toContainText("Selected Control Scope");
  await expect(preview.locator("table")).toHaveCount(1);
  const context = page.getByRole("complementary", { name: "Current document" });
  const controlSource = context.locator(".compare-scope-list > div").filter({ hasText: "Control source" });
  const templateBasis = context.locator(".compare-scope-list > div").filter({ hasText: "Template basis" });
  await expect(controlSource).toContainText("SP 800-53 Rev. 5");
  await expect(templateBasis).toContainText("FedRAMP Consolidated Rules for 2026");
  await expect(context).not.toContainText("Source publication");
  await expect(page.getByText("Include STIG/SRG cross-reference table")).toHaveCount(0);
});

test("Phase 4 Library sort stays in place without route-blocking feedback", async ({ page }) => {
  await page.goto("/#/library?q=access");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await page.evaluate(() => {
    globalThis.__phase4TransitionCount = 0;
    globalThis.addEventListener("control-atlas:route-transition-start", () => {
      globalThis.__phase4TransitionCount += 1;
    });
  });

  await page.getByRole("combobox", { name: "Sort Library results" }).selectOption("title");
  await expect(page).toHaveURL(/sort=title/);
  await expect(page.locator(".route-transition")).toBeHidden();
  expect(await page.evaluate(() => globalThis.__phase4TransitionCount)).toBe(0);
});

test("Phase 4 route feedback honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await page.evaluate(() => {
    globalThis.__phase4MotionProbe = null;
    globalThis.addEventListener("control-atlas:route-transition-start", () => {
      const overlay = globalThis.document.querySelector("[data-route-transition]");
      const mark = overlay?.querySelector(".route-transition__mark");
      globalThis.__phase4MotionProbe = {
        overlay: overlay ? globalThis.getComputedStyle(overlay).animationName : "missing",
        mark: mark ? globalThis.getComputedStyle(mark).animationName : "missing",
      };
    }, { once: true });
  });

  await page.getByRole("link", { name: "Atlas", exact: true }).click();
  await waitForAppReady(page);
  expect(await page.evaluate(() => globalThis.__phase4MotionProbe)).toEqual({
    overlay: "none",
    mark: "none",
  });
});

test("Phase 4 Search teaches its real keyboard shortcut in context", async ({ page }) => {
  await page.goto("/#/");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("button", { name: "Open search" }).click();
  const dialog = page.getByRole("dialog", { name: "Search Control Atlas" });
  await expect(dialog).toContainText("Ctrl+K opens search from anywhere. Esc closes it.");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
