import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

const FOCUSED_ATLAS = "/#/atlas/nist-800-53:AC-2";
const CONNECTION_LIST = "/#/atlas/nist-800-53:AC-2?relationshipView=list";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

async function assertNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => {
    const clientWidth = globalThis.document.documentElement.clientWidth;
    const offenders = Array.from(globalThis.document.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter(({ left, right }) => left < -1 || right > clientWidth + 1)
      .slice(0, 12);
    return {
      clientWidth,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      offenders,
    };
  });
  expect(
    dimensions.scrollWidth,
    `Overflowing elements: ${JSON.stringify(dimensions.offenders)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test("release evidence: focused Atlas keeps the record beside its map on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(FOCUSED_ATLAS);
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const details = page.locator(".atl-inspector");
  const map = page.locator(".terr");
  await expect(details).toContainText("AC-2", { timeout: 20000 });
  await expect(map).toBeVisible();
  await expect(details.getByRole("link", { name: "Full connection list" })).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: "artifacts/release-readiness/atlas-desktop-map.png",
  });
});

test("release evidence: focused Atlas stacks safely on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(FOCUSED_ATLAS);
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const focused = page.locator("#atl-focus");
  await expect(focused).toContainText("AC-2", { timeout: 20000 });
  await expect(page.locator(".terr")).toHaveCount(0);
  await assertNoPageOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: "artifacts/release-readiness/atlas-mobile-map.png",
  });
});

test("release evidence: the full connection list is one bounded table on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(CONNECTION_LIST);
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("table", { name: "Relationship table" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("status").filter({ hasText: /Showing \d+ of \d+ connections/ })).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: "artifacts/release-readiness/atlas-desktop-connections.png",
  });
});

test("release evidence: Atlas reflows at the 200 percent zoom equivalent", async ({
  page,
}) => {
  // A 1440px desktop viewport at 200% browser zoom exposes 720 CSS pixels.
  await page.setViewportSize({ width: 720, height: 500 });
  for (const path of [FOCUSED_ATLAS, CONNECTION_LIST, "/#/atlas?atlasJourney=rmf"]) {
    await page.goto(path);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page.locator(".atl--mobile")).toBeVisible();
    await assertNoPageOverflow(page);
  }
});

test("release evidence: Atlas fits a 375 by 667 compact viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(FOCUSED_ATLAS);
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.locator("#atl-focus")).toContainText("AC-2", { timeout: 20000 });
  await assertNoPageOverflow(page);
});

test("release evidence: reduced motion keeps every Atlas control available", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(FOCUSED_ATLAS);
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const journey = page.getByRole("button", { name: "RMF & ATO", exact: true });
  await expect(journey).toBeVisible();
  await expect(page.getByRole("link", { name: "Full connection list" })).toBeVisible({ timeout: 20000 });
  const duration = await journey.evaluate(
    (element) => globalThis.getComputedStyle(element).transitionDuration,
  );
  expect(["0s", "0.00001s"]).toContain(duration);
});
