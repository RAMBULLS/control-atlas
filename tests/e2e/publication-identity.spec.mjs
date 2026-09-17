import { expect, test } from "@playwright/test";

import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from "./support.mjs";

const publicationRecords = [
  ["nist-800-53", "AC-1", "NIST SP 800-53 Rev. 5", "NIST OSCAL Content"],
  ["nist-800-53a", "AC-1", "NIST SP 800-53A Assessment Procedures", "NIST OSCAL Content"],
  ["nist-800-171", "3.1.1", "NIST SP 800-171 Rev. 3", "NIST OSCAL Content"],
  [
    "csf-2",
    "CATEGORY-DE.AE",
    "NIST Cybersecurity Framework 2.0",
    "NIST OSCAL Content",
  ],
  [
    "nist-ssdf",
    "GROUP-PREPARE-THE-ORGANIZATION",
    "NIST SP 800-218 Secure Software Development Framework",
    "NIST SSDF OSCAL Content",
  ],
];

const publicationRoutes = [
  ["nist-800-53", "NIST SP 800-53 Rev. 5", "NIST", "family", "families"],
  ["csf-2", "NIST Cybersecurity Framework 2.0", "NIST", "category", "categories"],
];

test("publication pages use official human identity and publisher-native tiers", async ({
  page,
}) => {
  test.setTimeout(120_000);
  attachPageDiagnostics(page);

  for (const [catalog, title, publisher, tier, tiers] of publicationRoutes) {
    await gotoApp(page, `/#/library/publication/${catalog}`);
    await waitForAppReady(page, { allowPartial: true });
    await dismissOnboarding(page);

    const publication = page.locator(".catalog-detail-page");
    await expect(publication).toBeVisible();
    await expect(publication).not.toHaveClass(/\bpanel\b/);
    await expect(publication.getByText("PUBLICATION", { exact: true })).toBeVisible();
    await expect(publication.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(publication.locator(".catalog-publisher")).toHaveText(publisher);
    await expect(
      publication.getByRole("link", { name: "Open official publication", exact: true }),
    ).toBeVisible();
    await expect(publication.locator(`[data-published-tier="${tier}"]`).first()).toBeVisible();
    await expect(
      publication.getByRole("searchbox", { name: `Search ${title} ${tiers}` }),
    ).toBeVisible();
    await expect(publication).not.toContainText("Control Atlas note:");
    await expect(publication).not.toContainText("Published group");
  }
});

test("OSCAL-fed records display exact publication identity, not ingestion identity", async ({
  page,
}) => {
  attachPageDiagnostics(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const [catalog, item, publication, ingestion] of publicationRecords) {
    await gotoApp(page, `/#/record/${catalog}/${item}`);
    await waitForAppReady(page);
    await dismissOnboarding(page);

    // The exact source identity now has one home in About, not a repeated
    // publisher line above the source text. Keep the identity distinction strict.
    const about = page.locator('[data-rail-section="about-this-record"]');
    const sourceIdentity = about.locator(".record-source-facts > div").filter({
      has: page.locator("dt", { hasText: /^Publication$/ }),
    }).locator("dd");
    await expect(sourceIdentity).toBeVisible();
    await expect(sourceIdentity).toContainText(publication);
    await expect(sourceIdentity).not.toContainText(ingestion);
    await expect(about.getByRole("link", { name: "View source details" })).toBeVisible();
    await expect(page.locator(".record-template-main")).not.toContainText("Publisher source ·");
  }
});

test("a missing publication identity fails closed without guessed attribution", async ({
  page,
}) => {
  attachPageDiagnostics(page);
  await page.route("**/data/generated/sources.json*", async (route) => {
    if (route.request().url().includes(".json.gz")) {
      await route.fulfill({
        status: 200,
        contentType: "application/gzip",
        body: "invalid gzip fixture",
      });
      return;
    }
    const response = await route.fetch();
    const artifact = await response.json();
    artifact.sources = artifact.sources.filter(
      (source) => source.id !== "nist-csf-2",
    );
    await route.fulfill({ response, json: artifact });
  });

  await gotoApp(page, "/#/record/csf-2/CATEGORY-DE.AE");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(
    page.getByText("Source identity unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Can't confirm which publisher this came from, so it isn't shown as official yet.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/Source excerpt from/i)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /view official source/i }),
  ).toHaveCount(0);
});
