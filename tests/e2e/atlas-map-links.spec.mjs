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

test("selected publications expose their verified official destinations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The official destination is the publication a practitioner can cite, which
  // is not always the register's browse field: for SP 800-53 that field is the
  // CPRT tool home while the publication page sits in artifact_url.
  const cases = [
    {
      source: "nist-800-53",
      href: "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
    },
    {
      source: "mitre-d3fend-ontology",
      href: "https://d3fend.mitre.org/",
    },
  ];

  for (const fixture of cases) {
    await gotoApp(page, `/#/sources?source=${fixture.source}`);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const inspector = page.locator(
      ".sources-inspector-pane .source-inspector--inline",
    );
    await expect(inspector).toBeVisible();
    await expect(
      // The accessible name also says which publication opens, and that it opens in a new tab.
      inspector.getByRole("link", { name: /^Open official publication for .+ \(opens in a new tab\)$/ }),
    ).toHaveAttribute("href", fixture.href);
  }
});

test("publication rows reconcile their source-file count to the inspector", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, "/#/sources?source=dod-rai-toolkit");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  // The row and the inspector must agree. Assert that reconciliation rather
  // than a literal count, which drifts whenever a publisher's files change.
  const pill = page.locator(".source-register-row--selected .source-attached-pill");
  await expect(pill).toBeVisible();
  const pillText = await pill.getAttribute("title");
  const declaredFiles = Number(pillText.match(/^(\d+) source file/)[1]);
  expect(declaredFiles).toBeGreaterThan(0);
  const inspector = page.locator(
    ".sources-inspector-pane .source-inspector--inline",
  );
  const sourceFiles = inspector
    .locator("details.source-inspector-section")
    .filter({ hasText: /^Source files \(\d+\)/ })
    .locator(".source-material-item");
  await expect(sourceFiles).toHaveCount(declaredFiles);
  await expect(sourceFiles).toContainText("CDAO Responsible AI Resource Reconciliation Artifact");

  const references = inspector
    .locator("details.source-inspector-section")
    .filter({ hasText: /^Reference material \(\d+\)/ });
  await expect(references.locator(".source-material-item")).toHaveCount(1);
  await expect(references).toContainText("DoD AI Assurance Toolkit Artifact");
  await expect(references).toContainText("Reference only");
  await references.locator("summary").click();
  await expect(references.getByRole("link", { name: "View reference page" })).toHaveAttribute(
    "href",
    "https://rai.acqbot.com/executive-summary",
  );
  const technicalDetails = inspector.locator(".source-inspector-provenance");
  await technicalDetails.locator("summary").click();
  await expect(technicalDetails).toContainText("Stable Source ID");
});

test("Sources preserves useful search and publisher state without legacy layers", async ({ page }) => {
  await gotoApp(page, "/#/sources?q=DISA&publisher=DISA");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("searchbox", { name: "Search publications" })).toHaveValue(
    "DISA",
  );
  await expect(page.getByLabel("Publisher", { exact: true })).toHaveValue("DISA");
  await expect(
    page.getByRole("table", { name: "Control Atlas publication register" }),
  ).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Source register layers" })).toHaveCount(0);
  await expect(page.locator(".calibration-rail")).toContainText(/Showing 1–\d+ of \d+/);
});

test("compact Sources opens a modal inspector without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/#/sources");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("button", { name: "DoD AI Assurance", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".source-register-row").first().locator(".source-mobile-meta")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth -
        globalThis.document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Sources avoids redundant map-inclusion badges", async ({ page }) => {
  await gotoApp(page, "/#/sources");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByText(/Used in map:/i)).toHaveCount(0);
  await expect(page.locator(".source-card .badge.tone-success")).toHaveCount(0);
});
