import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

async function clickFlowNode(page, id) {
  const node = page.locator(`.react-flow__node:has([data-atlas-node-id="${id}"])`);
  await expect(node).toBeVisible();
  await node.dispatchEvent("click");
}

test("the Atlas landing shows nine honest areas and a populated area drills to its publications", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoApp(page, "/#/atlas?atlasAxis=framework");
  await waitForAppReady(page);

  await expect(page.getByRole("application", { name: "Interactive Atlas map hierarchy" })).toBeVisible();
  await expect(page.locator(".atlas-tree__areas [data-area-id]")).toHaveCount(9);
  await expect(page.locator(".atlas-tree__areas [data-area-id]:disabled")).toHaveCount(2);
  await expect(page.locator(".atlas-tree__areas").getByText("No records yet.", { exact: true })).toHaveCount(2);

  await page.locator('.atlas-tree__areas [data-area-id="atlas:LIMB-COMPLIANCE"]').click();
  await expect(page).toHaveURL(/atlasLimb=atlas(?:%3A|:)LIMB-COMPLIANCE/);
  await expect(page.getByRole("heading", { name: "Compliance", level: 2 })).toBeVisible();
});

test("a canvas branch survives refresh and its breadcrumb steps back one generation", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-COMPLIANCE&atlasFramework=nist-800-53");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page).toHaveURL(/atlasFramework=nist-800-53/);
  const breadcrumb = page.getByRole("navigation", { name: "Atlas breadcrumb" });
  await expect(breadcrumb).toContainText("Compliance");
  await expect(breadcrumb).toContainText("SP 800-53 Rev. 5 Catalog");

  await page.reload();
  await waitForAppReady(page);
  await expect(page.locator(".atlas-tree")).toHaveAttribute("data-layout-status", "ready", { timeout: 15_000 });
  await expect(breadcrumb).toContainText("SP 800-53 Rev. 5 Catalog");

  await breadcrumb.getByRole("button", { name: "Compliance", exact: true }).click();
  await expect(page).toHaveURL(/atlasLimb=atlas(?:%3A|:)LIMB-COMPLIANCE/);
  await expect(page).not.toHaveURL(/atlasFramework=/);

  await page.goBack();
  await expect(breadcrumb).toContainText("SP 800-53 Rev. 5 Catalog");
});

test("family filtering is local and an empty result explains itself", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoApp(page, "/#/atlas?atlasAxis=framework&atlasLimb=atlas%3ALIMB-COMPLIANCE&atlasFramework=nist-800-53&node=nist-800-53%3AFAMILY-AC");
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const filter = page.locator(".atlas-publisher-explorer__tools").getByLabel("Search this publication");
  await filter.fill("AC-2");
  await expect(page.locator(".atlas-publisher-explorer__list li")).not.toHaveCount(0);
  await filter.fill("definitely-not-a-control");
  await expect(
    page.getByText("No records match that search."),
  ).toBeVisible();
});
