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

    // Initial state: the register uses the full workspace until a row is selected.
    const table = page.locator(".source-table");
    await expect(table).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sources");
    await expect(page.locator(".sources-page .page-header")).toContainText(
      "Who published each source Control Atlas uses, which edition it holds, and how recently it was checked.",
    );
    await expect(table.getByRole("columnheader")).toHaveText([
      "Publication",
      "Publisher",
      "Version / current through",
      "Source freshness",
      "Status",
    ]);
    await expect(page.locator(".sources-page")).not.toContainText("Catalog profile");
    await expect(page.locator(".sources-inspector-pane")).toHaveCount(0);
    await expect(page.locator(".sources-inspector-pane .source-inspector")).toHaveCount(0);

    // Select the CDAO publication: the practitioner name leads, the official title sits beside it.
    const rowButton = page.getByRole("button", { name: "DoD AI Assurance", exact: true });
    await expect(page.locator(".source-register-row").filter({ has: rowButton })).toContainText("CDAO AI Assurance Toolkit");
    await expect(rowButton).toBeVisible();
    await rowButton.click();
    await waitForAppReady(page);

    // Both register and inspector are visible side-by-side in master-detail layout
    await expect(table).toBeVisible();
    const inspector = page.locator(".sources-inspector-pane .source-inspector--inline");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Close publication details" })).toBeVisible();

    // The register measurement stays visible and is not covered.
    await expect(page.locator(".calibration-rail")).toBeVisible();
    await expect(inspector).not.toHaveAttribute("role", "dialog");
  });

  test("1024px moves publication details to a modal instead of cramping the register", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await gotoApp(page, "/#/sources");
    await waitForAppReady(page);

    await page.getByRole("button", { name: "DoD AI Assurance", exact: true }).click();
    await waitForAppReady(page);

    // The register remains visually present behind the modal, but the modal's
    // inert boundary correctly removes it from the accessibility tree.
    const table = page.locator(".source-table");
    await expect(table).toBeVisible();
    await expect(page.locator(".sources-inspector-pane .source-inspector--inline")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveClass(/source-inspector--modal/);
  });

  test("390px uses a focus-trapped modal inspector and returns focus to the row", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, "/#/sources");
    await waitForAppReady(page);

    const rowButton = page.getByRole("button", { name: "DoD AI Assurance", exact: true });
    await expect(rowButton).toBeVisible();
    await rowButton.click();
    await waitForAppReady(page);

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveClass(/source-inspector--modal/);
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".source-inspector-dialog-backdrop")).toBeVisible();
    await expect(page.locator("#app")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#app")).toHaveAttribute("inert", "");

    const closeButton = drawer.getByRole("button", { name: "Close inspector" });
    await expect(closeButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await page.locator(".source-inspector--modal :focus").count()).toBe(1);

    await page.keyboard.press("Escape");
    await waitForAppReady(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rowButton).toBeFocused();

    await expect(page.locator(".source-register-row").nth(0).locator(".source-mobile-meta")).toBeVisible();
    expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("search commits immediately on Enter without duplicating result counts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page, "/#/sources");
    await waitForAppReady(page);

    const search = page.getByRole("searchbox", { name: "Search publications" });
    await search.fill("DoD AI Assurance");
    await search.press("Enter");

    await expect(page).toHaveURL(/q=DoD(?:%20|\+)AI(?:%20|\+)Assurance/);
    await expect(page.locator(".calibration-rail")).toHaveCount(1);
    await expect(page.locator(".calibration-rail")).toContainText("Showing 1–1 of 1");
    await expect(page.getByRole("button", { name: "DoD AI Assurance", exact: true })).toBeVisible();
  });

  test("zero results use a truthful count and one primary recovery action", async ({ page }) => {
    await gotoApp(page, "/#/sources?q=zzzz-no-publication");
    await waitForAppReady(page);

    await expect(page.locator(".calibration-rail")).toContainText("0 publications");
    await expect(page.getByRole("heading", { name: "No publications match these filters." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear publication filters" })).toHaveCount(1);
  });

  test("register rows use the same publication identity as the inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page, "/#/sources?q=DISA%20STIG");
    await waitForAppReady(page);

    const publication = page.getByRole("button", { name: "DISA STIG", exact: true });
    await expect(publication).toBeVisible();
    await expect(page.locator(".source-register-row").filter({ has: publication })).toContainText("DISA Public STIG Library");
    await publication.click();
    const inspector = page.locator(".sources-inspector-pane .source-inspector--inline");
    await expect(inspector.getByRole("heading", { name: "DISA STIG", level: 2 })).toBeVisible();
    await expect(inspector.locator("[data-official-title]")).toContainText("DISA Public STIG Library");
    await expect(inspector).toContainText("Defense Information Systems Agency (DISA)");
    await expect(page.getByRole("region", { name: "Page context" })).toHaveCount(0);
  });

  test("768px keeps publication details in the modal inspector", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await gotoApp(page, "/#/sources");
    await waitForAppReady(page);

    await page.getByRole("button", { name: "DoD AI Assurance", exact: true }).click();
    await waitForAppReady(page);

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".sources-inspector-pane .source-inspector--inline")).toHaveCount(0);
  });

  test("row attachment count reconciles exactly to rendered inspector items", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page, "/#/sources?source=dod-rai-toolkit");
    await waitForAppReady(page);

    // The row count must reconcile to the normalized source ledger.
    const pill = page.locator(".source-register-row--selected .source-attached-pill");
    await expect(pill).toBeVisible();
    const pillTitle = await pill.getAttribute("title");
    const sourceCount = Number(pillTitle?.match(/^(\d+) source files?/)?.[1]);
    expect(sourceCount).toBeGreaterThan(0);

    // The inspector visibly exposes exactly that many source files.
    const inspector = page.locator(".sources-inspector-pane .source-inspector--inline");
    await expect(inspector).toBeVisible();

    const fileItems = inspector
      .locator("details.source-inspector-section")
      .filter({ hasText: /^Source files \(\d+\)/ })
      .locator(".source-material-item");
    await expect(fileItems).toHaveCount(sourceCount);

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

    const inspector = page.locator(".sources-inspector-pane .source-inspector--inline");
    await expect(inspector).toBeVisible();
    await expect(page.locator(".sources-page")).toContainText("DISA CCI");
  });

  test("Sources page never displays duplicate eyebrow and title on first paint or hydration", async ({ page }) => {
    await gotoApp(page, "/#/sources");

    // Check before hydration if static eyebrow is present
    const eyebrow = page.locator("[data-static-route-eyebrow]");
    if ((await eyebrow.count()) > 0) {
      const isHidden = await eyebrow.first().getAttribute("hidden", { timeout: 1000 }).catch(() => null);
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
