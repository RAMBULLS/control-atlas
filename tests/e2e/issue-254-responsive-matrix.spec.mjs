import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, waitForAppReady } from "./support.mjs";

const VIEWPORTS = [
  { width: 320, height: 600 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 800 },
  { width: 1440, height: 900 },
];

const REPRESENTATIVES = [
  { role: "atomic_record (V-205646)", route: "/#/record/disa-stig/V-205646" },
  { role: "atomic_record (AC-2)", route: "/#/record/nist-800-53/AC-2" },
  { role: "atomic_record (CCI-000366)", route: "/#/record/disa-cci/CCI-000366" },
  { role: "container (FAMILY-AC)", route: "/#/record/nist-800-53/FAMILY-AC" },
  { role: "publication_document (CSF-2)", route: "/#/record/csf-2/CATALOG" },
  { role: "entity_contributor (Appgate)", route: "/#/record/nist-zt/COLLABORATOR-APPGATE-835EC7F121" },
  { role: "assessment_question (AC-1)", route: "/#/record/nist-800-53a/AC-1" },
  { role: "implementation_artifact (SP180035)", route: "/#/record/nist-zt/SP180035-E1B1" },
  { role: "resource_detail (CSET)", route: "/#/resources/tool-cisa-cset" },
];

for (const { role, route } of REPRESENTATIVES) {
  test(`Issue #254 QA: ${role} across all governed viewports`, async ({ page }) => {
    test.setTimeout(120_000);
    attachPageDiagnostics(page);

    for (const { width, height } of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      await page.goto(route);
      await waitForAppReady(page, { allowPartial: true });
      await dismissOnboarding(page);

      // 1. No page horizontal overflow
      const overflow = await page.evaluate(() =>
        globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
      );
      expect(overflow, `${role} at ${width}px horizontal overflow`).toBeLessThanOrEqual(1);

      // 2. Automated content guard: Prohibited data-model jargon must never appear
      await expect(page.locator(".related-in-atlas")).toHaveCount(0);
      const pageText = await page.locator("main").innerText();
      expect(pageText).not.toContain("Explore by context");
      expect(pageText).not.toContain("source-backed facets");
      expect(pageText).not.toContain("atlas_evidence");
      expect(pageText).not.toContain("source_field");
      const headings = await page.locator("h1, h2, h3").allInnerTexts();
      for (const heading of headings) {
        expect(heading.trim()).not.toBe("Related in Control Atlas");
      }

      // 3. Compact relationship count badge stretching regression check
      const connectionBadges = page.locator(".record-connections .section-header .badge");
      if ((await connectionBadges.count()) > 0) {
        const badgeBox = await connectionBadges.first().boundingBox();
        const headerBox = await page.locator(".record-connections .section-header").first().boundingBox();
        if (badgeBox && headerBox) {
          expect(
            badgeBox.width,
            `Badge width ${badgeBox.width} should be compact (< 80px), not full-width stretched (${headerBox.width}) at ${width}px`,
          ).toBeLessThanOrEqual(80);
        }
      }

      // 4. For atomic records: check natural DOM reading order
      if (route.includes("V-205646")) {
        const order = await page.evaluate(() => {
          const main = globalThis.document.querySelector(".record-template-main");
          const sidebar = globalThis.document.querySelector(".record-template-sidebar");
          if (!main || !sidebar) return null;

          const officialText = main.querySelector('[data-record-section="official-text"]');
          const relatedRecords = main.querySelector('[data-record-section="related-records"]');
          const taxonomyContext = sidebar.querySelector('[data-record-section="taxonomy-context"]');
          const sourceFacts = sidebar.querySelector(".record-source-facts");

          return {
            hasOfficialText: Boolean(officialText),
            hasRelatedRecords: Boolean(relatedRecords),
            hasTaxonomyContext: Boolean(taxonomyContext),
            hasSourceFacts: Boolean(sourceFacts),
            officialBeforeRelated: officialText && relatedRecords
              ? (officialText.compareDocumentPosition(relatedRecords) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
              : true,
            relatedBeforeContext: relatedRecords && taxonomyContext
              ? (relatedRecords.compareDocumentPosition(taxonomyContext) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
              : true,
            contextBeforeFacts: taxonomyContext && sourceFacts
              ? (taxonomyContext.compareDocumentPosition(sourceFacts) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
              : true,
          };
        });

        expect(order).not.toBeNull();
        expect(order.officialBeforeRelated).toBe(true);
        expect(order.relatedBeforeContext).toBe(true);
        expect(order.contextBeforeFacts).toBe(true);

        // Verify V-205646 has "Find more like this" heading
        const contextSection = page.locator('[data-record-section="taxonomy-context"]');
        await expect(contextSection).toBeVisible();
        await expect(contextSection.getByRole("heading", { name: "Find more like this", level: 2 })).toBeVisible();

        // Verify short public dimension names
        await expect(contextSection.getByText("Organization", { exact: true })).toBeVisible();
        await expect(contextSection.getByText("Program", { exact: true })).toBeVisible();
        await expect(contextSection.getByText("Vendor", { exact: true })).toBeVisible();
        await expect(contextSection.getByText("Product", { exact: true })).toBeVisible();
        await expect(contextSection.getByText("Asset", { exact: true })).toBeVisible();
        await expect(contextSection.getByText("Technology", { exact: true })).toBeVisible();

        // Prohibited old long labels
        await expect(contextSection.getByText("Vendor / Brand", { exact: true })).toHaveCount(0);
        await expect(contextSection.getByText("Asset Class", { exact: true })).toHaveCount(0);

        // Verify provenance disclosure summary
        const provenanceDisclosure = contextSection.locator("details.taxonomy-provenance-disclosure");
        await expect(provenanceDisclosure).toBeVisible();
        await expect(provenanceDisclosure.locator("summary")).toHaveText("Why these are shown");

        // Verify full publication title is NOT a taxonomy pill
        await expect(
          contextSection.getByText("Microsoft Windows Server 2019 Security Technical Implementation Guide", { exact: true }),
        ).toHaveCount(0);

        // Verify record type "STIG rule" is in source facts
        const sourceFactsSection = page.locator(".record-template-sidebar .record-source-facts");
        await expect(sourceFactsSection).toContainText("STIG rule");
      }
    }
  });
}
