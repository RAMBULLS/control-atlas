import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, OFFICIAL_SOURCE_ACTION, waitForAppReady } from "./support.mjs";

/** @type {Array<[string, string, string, string, string?]>} */
const records = [
  ["control", "/#/record/nist-800-53/AC-1", "AC-1", "Control Statement"],
  ["STIG rule", "/#/record/disa-stig/V-222387", "V-222387", "Discussion"],
  ["SRG rule", "/#/record/disa-srg/V-202013", "V-202013", "Discussion"],
  ["ATT&CK technique", "/#/record/mitre-attack-ics/T0800", "T0800", "Technique Description"],
  ["assessment procedure", "/#/record/nist-800-53a/AC-1", "AC-1", "Assessment Procedure", "procedure_text"],
  // D3-AA was the last record type with an empty description (MITRE D3FEND
  // technique/all.json omits d3f:definition; the full ontology graph carries
  // it — docs/PAGE_CONTRACTS.md). No graph node currently has
  // an empty description, so there is no real fixture left for the
  // "no narrative description" fallback branch in ObjectDetailPage.tsx.
  ["MITRE D3FEND countermeasure", "/#/record/mitre-d3fend/D3-AA", "D3-AA", "Countermeasure Description"],
];

/** @type {Array<[string, number, number]>} */
const viewports = [
  ["mobile", 375, 812],
  ["desktop", 1440, 1000],
];

for (const [label, width, height] of viewports) {
  test.describe(`source-first record detail at ${label}`, () => {
    test.use({ viewport: { width, height } });

    for (const [recordType, route, itemId, sourceHeading, sourceField = "description"] of records) {
      test(`${recordType} shows only source-backed record content`, async ({ page }) => {
        attachPageDiagnostics(page);
        await page.goto(route);
        await waitForAppReady(page);
        await dismissOnboarding(page);

        await expect(page.locator("h1")).toContainText(itemId);
        const sourceSection = page.locator(`[data-source-field="${sourceField}"]`);
        await expect(sourceSection.getByRole("heading", { name: sourceHeading, exact: true })).toBeVisible();
        await expect(sourceSection.locator("p")).not.toBeEmpty();
        await expect(page.getByRole("link", { name: OFFICIAL_SOURCE_ACTION })).toHaveCount(1);
        await expect(page.getByText(/What this is|What you need to do|How to satisfy it/i)).toHaveCount(0);
        await expect(page.locator("[data-record-source-error]")).toHaveCount(0);
      });
    }
  });
}

test('NIST SP 1800-35 collaborator and mapping-contributor pages fold into vendor search', async ({ page }) => {
  // Both are helper entities: the official collaborator roster entry carries the
  // same boilerplate for every vendor and the mapping-workbook label only parents
  // product components. The graph keeps both; the public destination is the
  // vendor's product components.
  for (const route of [
    '/#/record/nist-zt/COLLABORATOR-APPGATE-835EC7F121',
    '/#/record/nist-zt/MAPPING-CONTRIBUTOR-APPGATE-835EC7F121',
  ]) {
    attachPageDiagnostics(page);
    await page.goto(route);
    await waitForAppReady(page, { allowPartial: true });
    await dismissOnboarding(page);
    await expect(page, route).toHaveURL(/#\/library\?q=Appgate/);
    await expect(page.locator('[data-record-source-error]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Appgate Headless Client/ }).first(), route).toBeVisible();
    await expect(page.locator('main'), route).not.toContainText('Technology collaborator');
    await expect(page.locator('main'), route).not.toContainText('Mapping workbook contributor');
  }
});
