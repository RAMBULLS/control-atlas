import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

// 2026-08-03: the owner asked for a genuine two-step guided flow here,
// superseding the earlier "fixed list, no questions" design. The boundary
// that design was protecting is unchanged and still enforced below: the flow
// routes to public material, it never determines applicability.
test("Start here asks two questions without making a determination", async ({
  page,
}) => {
  await page.goto("/#/start");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("heading", { name: "Start here", exact: true })).toBeVisible();
  await expect(page.locator('[data-visual-identity="task-intake-compass"].mission-page')).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Step progress" })).toBeVisible();
  const activeWork = page.locator(".compare-flow-grid > .compare-flow-task");
  const supportRail = page.locator(".compare-flow-grid > .compare-flow-support");
  await expect(activeWork).toBeVisible();
  await expect(supportRail).toBeVisible();
  const activeBox = await activeWork.boundingBox();
  const supportBox = await supportRail.boundingBox();
  expect(activeBox?.width || 0).toBeGreaterThan(supportBox?.width || 0);
  await expect(
    page.getByRole("heading", { name: "What are you trying to do?" }),
  ).toBeVisible();
  // Step 2 only appears once a goal is chosen.
  await expect(
    page.getByRole("heading", { name: "What kind of system are you working with?" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("System type")).toHaveCount(0);
  await expect(page.getByLabel("Data sensitivity")).toHaveCount(0);
  await expect(page.getByLabel("Operational environment")).toHaveCount(0);
});

test("Start here produces a plan traceable to real publications", async ({
  page,
}) => {
  await page.goto("/#/start");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("button", { name: "Assess or authorize" }).click();
  await expect(
    page.getByRole("heading", { name: "What kind of system are you working with?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "FedRAMP cloud service" }).click();

  await expect(page.getByRole("heading", { name: /^Start with/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open FedRAMP/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Then review/ })).toBeVisible();
  // Control Atlas does not decide applicability; the plan only routes.
  await expect(
    page.getByText("Use Control Atlas for research, not compliance or authorization decisions.", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: /^Open FedRAMP/ }).click();
  await expect(page).toHaveURL(/#\/library\/publication\/fedramp-rev5/);
});

// #281: the plan carries its own first move. It used to live only in the side
// rail, which on a phone sits below Back and Start over.
for (const width of [1440, 390, 320]) {
  test(`at ${width}px the plan's primary action is in the plan, ahead of Back and Start over`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/start?goal=assess&context=fedramp");
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const plan = page.locator(".start-here-plan");
    const open = plan.getByRole("link", { name: /^Open FedRAMP/ });
    await expect(open).toBeVisible();
    await expect(page.getByRole("link", { name: /^Open FedRAMP/ })).toHaveCount(1);
    const [o, back] = await Promise.all([open.boundingBox(), plan.getByRole("button", { name: "Back to context" }).boundingBox()]);
    expect(o.y).toBeLessThan(back.y);
    const nav = page.getByRole("navigation", { name: "Step progress" });
    await expect(nav.locator('[aria-current="step"]')).toContainText("Your plan");
    await expect(nav.locator("a, button")).toHaveCount(0);
  });
}

test("retired questionnaire parameters are removed with visible recovery", async ({
  page,
}) => {
  await page.goto(
    "/#/start?systemType=Cloud+SaaS&dataSensitivity=CUI&environment=Contractor&step=results",
  );
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page).toHaveURL(/#\/start$/);
  await expect(
    page.getByText(/unsupported link settings were removed/i),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start here", exact: true })).toBeVisible();
});

test("Start here's chosen goal and context survive reload and back navigation", async ({
  page,
}) => {
  await page.goto("/#/start?goal=assess&context=fedramp");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("heading", { name: /^Start with/ })).toContainText(
    "FedRAMP Rev. 5",
  );
  await expect(page.getByRole("link", { name: /^Then review/ })).toContainText(
    "SP 800-53A Rev. 5",
  );
});

test("catalog detail keeps source context and opens a specific record", async ({
  page,
}) => {
  await page.goto("/#/catalog/nist-800-171-rev2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(
    page.getByRole("heading", { name: "SP 800-171 Rev. 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /(?:Open|Download) official publication/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Family Access Control/ }).click();
  await page.getByRole("searchbox", { name: "Search SP 800-171 Rev. 2" }).fill("3.1.1");
  await page.getByRole("button", { name: "Search records" }).click();
  const row = page
    .locator(".catalog-record-row")
    .filter({ hasText: "3.1.1" })
    .first();
  await row.getByRole("link", { name: /Open NIST AC 3\.1\.1$/ }).click();
  await expect(page).toHaveURL(/#\/record\/nist-800-171-rev2\/3.1.1/);
});
