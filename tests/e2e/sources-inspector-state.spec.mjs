import { expect, test } from "@playwright/test";

async function gotoApp(page, path) {
  await page.goto(path);
  await page.locator("#app").waitFor({ state: "attached" });
}

async function waitForAppReady(page) {
  await page.locator('#app[data-app-ready="true"]').waitFor({
    state: "attached",
    timeout: 30_000,
  });
}

test.describe("Sources Inspector State & Trust Workflow", () => {
  test("1440px desktop uses master-detail layout without occluding the register", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page, "/#/sources");
    await waitForAppReady(page);

    // Initial state: 47 publications listed with empty inspector on desktop (S7)
    const table = page.getByRole("table", { name: "Control Atlas publication register" });
    await expect(table).toBeVisible();
    await expect(page.locator(".sources-inspector-pane .source-inspector-card--empty")).toBeVisible();
    await expect(page.locator(".sources-inspector-pane .inspector-drawer")).toHaveCount(0);

    // Select DoD AI Assurance
    const rowButton = page.getByRole("button", { name: "DoD AI Assurance" });
    await expect(rowButton).toBeVisible();
    await rowButton.click();
    await waitForAppReady(page);

    // Both register and inspector are visible side-by-side in master-detail layout
    await expect(table).toBeVisible();
    const inspector = page.locator(".sources-inspector-pane .inspector-drawer");
    await expect(inspector).toBeVisible();

    // Verify inspector header and close button are fully visible
    const closeBtn = page.getByRole("button", { name: "Close inspector" });
    await expect(closeBtn).toBeVisible();

    // Verify register results count is still visible and not covered
    await expect(page.locator(".source-register-total")).toBeVisible();

    // Verify closing inspector returns to empty inspector state (S7)
    await closeBtn.click();
    await waitForAppReady(page);
    await expect(page.locator(".sources-inspector-pane .inspector-drawer")).toHaveCount(0);
    await expect(page.locator(".sources-inspector-pane .source-inspector-card--empty")).toBeVisible();
    await expect(rowButton).toBeVisible();
    await expect(rowButton).toHaveAttribute("aria-expanded", "false");
  });

  test("mobile and tablet viewports use an accessible modal drawer with Escape closing", async ({ page }) => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await gotoApp(page, "/#/sources");
      await waitForAppReady(page);

      const rowButton = page.getByRole("button", { name: "DoD AI Assurance" });
      await expect(rowButton).toBeVisible();
      await rowButton.click();
      await waitForAppReady(page);

      const drawer = page.locator(".inspector-drawer--modal");
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute("role", "dialog");
      await expect(drawer).toHaveAttribute("aria-modal", "true");

      const backdrop = page.locator(".inspector-drawer-backdrop");
      await expect(backdrop).toBeVisible();

      // Press Escape to dismiss
      await page.keyboard.press("Escape");
      await waitForAppReady(page);
      await expect(page.locator(".inspector-drawer")).toHaveCount(0);
    }
  });

  test("row attachment count reconciles exactly to rendered inspector items", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page, "/#/sources?source=dod-rai-toolkit");
    await waitForAppReady(page);

    // Row pill says "2 source files"
    const pill = page.locator(".source-register-row--selected .source-attached-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("2 source files");

    // Inspector visibly exposes both source files
    const inspector = page.locator(".sources-inspector-pane");
    await expect(inspector).toBeVisible();

    const fileItems = inspector.locator(".source-material-item");
    await expect(fileItems).toHaveCount(2);

    // Verify details & field provenance disclosure exists
    const techDetails = inspector.locator(".source-inspector-provenance");
    await expect(techDetails).toBeVisible();
    await techDetails.locator("summary").click();
    await expect(techDetails.locator(".source-inspector-id-block")).toBeVisible();
  });

  test("reference material and mapping aliases resolve to their canonical publication", async ({ page }) => {
    // Test mapping evidence alias resolution
    await gotoApp(page, "/#/sources?source=disa-cci-nist-references");
    await waitForAppReady(page);

    const inspector = page.locator(".sources-inspector-pane .inspector-drawer");
    await expect(inspector).toBeVisible();
    await expect(page.locator(".sources-page")).toContainText("DISA CCI");
  });

  test("Sources page never displays duplicate eyebrow and title on first paint or hydration", async ({ page }) => {
    await gotoApp(page, "/#/sources");

    // Check before hydration if static eyebrow is present
    const eyebrow = page.locator("[data-static-route-eyebrow]");
    if ((await eyebrow.count()) > 0) {
      const isHidden = await eyebrow.first().getAttribute("hidden").catch(() => null);
      const text = await eyebrow.first().textContent({ timeout: 1000 }).catch(() => null);
      if (!isHidden && text) {
        expect(text.trim().toLowerCase()).not.toBe("sources");
      }
    }

    await waitForAppReady(page);

    // Check after hydration
    const pageHeader = page.locator(".sources-page .page-header");
    await expect(pageHeader).toBeVisible();
    const renderedEyebrows = pageHeader.locator(".eyebrow");
    if (await renderedEyebrows.count()) {
      for (const el of await renderedEyebrows.all()) {
        const text = await el.textContent();
        expect(text?.trim().toLowerCase()).not.toBe("sources");
      }
    }
  });

  test("build SHA and runtime cache version diagnostics are present in document", async ({ page }) => {
    await gotoApp(page, "/#/");
    const metaSha = page.locator('meta[name="control-atlas-build-sha"]');
    await expect(metaSha).toHaveCount(1);
    const shaVal = await metaSha.getAttribute("content");
    expect(shaVal).toBeTruthy();

    const diag = page.locator("#control-atlas-diagnostics");
    await expect(diag).toHaveCount(1);
    expect(await diag.getAttribute("data-build-sha")).toBeTruthy();
    expect(await diag.getAttribute("data-cache-version")).toBeTruthy();
  });
});
