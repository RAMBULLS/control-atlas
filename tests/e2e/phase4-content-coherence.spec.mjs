import { AxeBuilder } from "@axe-core/playwright";
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
  await expect(preview.locator(".template-document-preview-outline li")).toHaveCount(16);
  await expect(preview.locator(".template-document-preview-outline")).toContainText("Selected Control Scope");
  await expect(preview.locator("table")).toHaveCount(1);
  const context = page.getByRole("complementary", { name: "Current document" });
  const selectedContext = context.locator(".compare-scope-list > div").filter({ hasText: "Selected context" });
  const artifactBasis = context.locator(".compare-scope-list > div").filter({ hasText: "Artifact basis" });
  await expect(selectedContext).toContainText("SP 800-53 Rev. 5");
  await expect(selectedContext).toContainText("Moderate baseline");
  // The file is built on NIST RMF concepts. A FedRAMP source that happens to be
  // first in a list must not be presented as the basis of an SP 800-53 file.
  await expect(artifactBasis).toContainText("NIST SP 800-37 Rev. 2");
  await expect(artifactBasis).not.toContainText("FedRAMP");
  // The published-source list follows the same rule: no FedRAMP resources on an
  // SP 800-53 file until FedRAMP is the selected program.
  await expect(context.locator(".template-sources-panel")).not.toContainText("FedRAMP");
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

test("Phase 4 STIG worksheet needs a chosen STIG, then lists that STIG's rules", async ({ page }) => {
  await page.goto("/#/build/documents/stig_evidence_checklist?format=xlsx");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const download = page.locator("#document-download-action");
  await expect(download).toBeDisabled();
  await expect(page.locator("#document-download-reason")).toContainText("Choose STIG");
  // The step bar names the three things the page really does.
  const steps = page.getByRole("navigation", { name: "Step progress" });
  await expect(steps).toContainText("Choose");
  await expect(steps).toContainText("Set up");
  await expect(steps).toContainText("Review & download");

  await page.getByLabel("Find a STIG").fill("Windows 10 Security");
  const picker = page.getByRole("combobox", { name: "STIG", exact: true });
  const choices = picker.locator("option:not([value=''])");
  expect(await choices.count()).toBeGreaterThan(0);
  expect(await choices.count()).toBeLessThan(10);
  await picker.selectOption({ index: 1 });

  await expect(download).toBeEnabled();
  const preview = page.locator(".template-document-preview");
  await expect(preview).toContainText("STIG Viewer CSV Import Rows");
  await expect(page).toHaveURL(/stig=BENCHMARK-/);
  const context = page.getByRole("complementary", { name: "Current document" });
  await expect(context).toContainText("Windows 10");
});

const READY_HARDWARE = "/#/build/documents/hardware_baseline?environment=Generic&format=xlsx";

test("Phase 4 a template download fires once per click, even on a fast double click", async ({ page }) => {
  await page.goto(READY_HARDWARE);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const download = page.locator("#document-download-action");
  await expect(download).toBeEnabled();

  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await download.dispatchEvent("click");
  await download.dispatchEvent("click");
  await expect(page.getByText(/Download started for hardware-baseline-.*\.xlsx/)).toBeVisible();
  await expect(download).toContainText("Download Hardware Baseline");
  await page.waitForTimeout(600);
  expect(downloads).toBe(1);
});

test("Phase 4 a failed file build says so and can be retried", async ({ page }) => {
  await page.route(/office-export[^/]*\.js/, (route) => route.abort());
  await page.goto(READY_HARDWARE);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const download = page.locator("#document-download-action");
  await expect(download).toBeEnabled();
  await download.click();
  await expect(page.getByText("The document could not be prepared in this browser")).toBeVisible();
  await expect(download).toBeEnabled();
});

test("Phase 4 the template workflow fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/#/build/documents/implementation_statement_worksheet?framework=nist-800-53&baseline=MODERATE&format=xlsx");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator("#document-download-action")).toBeEnabled();
  await expect(page.getByRole("navigation", { name: "Step progress" })).toContainText("Review & download");
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const context = page.getByRole("complementary", { name: "Current document" });
  await expect(context).toContainText("Moderate baseline");
});

test("Phase 4 the ready template page has no serious accessibility violations on a phone and a desktop", async ({ page }) => {
  for (const size of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(size);
    await page.goto("/#/build/documents/implementation_statement_worksheet?framework=nist-800-53&baseline=MODERATE&format=xlsx");
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page.locator("#document-download-action")).toBeEnabled();
    const results = await new AxeBuilder({ page }).include("#workspace").withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""));
    expect(blocking, `${size.width}px: ${blocking.map((entry) => `${entry.id} -> ${entry.nodes.map((node) => `${node.target.join(" ")} ${node.any[0]?.message || ""}`).join(" | ")}`).join("; ")}`).toEqual([]);
  }
});

test("Phase 4 Templates start from the job to be done and say what each file is not", async ({ page }) => {
  await page.goto("/#/build/documents");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const nav = page.getByRole("navigation", { name: "Template sections" });
  await expect(nav.getByRole("link")).toHaveText(["By task", "All working files"]);
  await expect(nav.getByRole("link", { name: "Resources" })).toHaveCount(0);
  for (const heading of ["Build hardware and software baselines", "Draft control implementation", "Prepare PPSM information"]) {
    await expect(page.getByRole("heading", { name: heading, level: 3 })).toBeVisible();
  }
  await expect(page.getByText("Not a replacement for:").first()).toBeVisible();
  await expect(page.locator("body")).toContainText("Your CMDB or eMASS.");
});
