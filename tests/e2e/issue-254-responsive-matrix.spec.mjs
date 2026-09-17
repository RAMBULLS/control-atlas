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

      // 4. For atomic records: check authoritative mockup layout and natural reading order
      if (route.includes("V-205646")) {
        // 4a. ONE compact wrapping row of clickable discovery tags, hashtag-style
        const discoveryTags = page.locator(".record-discovery-tags");
        await expect(discoveryTags).toBeVisible();
        const tagLabels = await discoveryTags.locator(".record-discovery-tag__label").allInnerTexts();
        expect(tagLabels).toContain("DISA");
        expect(tagLabels).toContain("STIG");
        expect(tagLabels).toContain("Microsoft");
        expect(tagLabels).toContain("Microsoft Windows");
        expect(tagLabels).toContain("Server");
        expect(tagLabels).toContain("Operating system");

        // Hashtag prefix check
        const hashes = await discoveryTags.locator(".record-discovery-tag__hash").allInnerTexts();
        expect(hashes.length).toBe(tagLabels.length);
        expect(hashes.every((h) => h === "#")).toBe(true);

        // Tags sit together in ONE wrapping set — NOT grouped by dimension rows or table scaffolding
        await expect(page.locator(".taxonomy-dimension-row")).toHaveCount(0);
        await expect(page.locator('[data-record-section="taxonomy-context"]')).toHaveCount(0);
        for (const prohibitedHeading of ["Organization", "Program", "Vendor", "Product", "Asset", "Technology", "Vendor / Brand", "Asset Class"]) {
          await expect(page.locator(".record-title-block").getByRole("heading", { name: prohibitedHeading })).toHaveCount(0);
          await expect(page.locator(".record-template-sidebar").getByRole("heading", { name: prohibitedHeading })).toHaveCount(0);
        }

        // Verify full benchmark title is NOT a discovery tag
        await expect(
          discoveryTags.getByText("Microsoft Windows Server 2019 Security Technical Implementation Guide", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.locator(".record-discovery-tag", { hasText: "Microsoft Windows Server 2019 Security Technical Implementation Guide" }),
        ).toHaveCount(0);

        // 4b. Section navigation jump links
        const sectionNav = page.locator(".record-section-nav");
        await expect(sectionNav).toBeVisible();
        const navLinks = sectionNav.locator(".record-section-nav__link");
        const navTexts = await navLinks.allInnerTexts();
        expect(navTexts).toContain("Overview");
        expect(navTexts).toContain("Discussion");
        expect(navTexts).toContain("Check");
        expect(navTexts).toContain("Fix");
        expect(navTexts).toContain("Related records");

        // 4c. Desktop / Mobile 4 Right Side Rail Sections in exact order:
        // 1. About this record
        // 2. In this publication
        // 3. Explore related
        // 4. Do more
        const railSections = page.locator(".record-template-sidebar > .record-rail-section");
        await expect(railSections).toHaveCount(4);
        const railSectionNames = await railSections.evaluateAll((elements) =>
          elements.map((el) => el.getAttribute("data-rail-section")),
        );
        expect(railSectionNames).toEqual([
          "about-this-record",
          "in-this-publication",
          "explore-related",
          "do-more",
        ]);

        // Section 1: About this record
        const aboutSection = page.locator('[data-rail-section="about-this-record"]');
        await expect(aboutSection.getByRole("heading", { name: "About this record", level: 2 })).toBeVisible();
        await expect(aboutSection.locator("dt", { hasText: "Record type" })).toBeVisible();
        await expect(aboutSection.locator("dd", { hasText: "STIG rule" })).toBeVisible();
        await expect(aboutSection.locator("dt", { hasText: "Publisher" })).toBeVisible();
        await expect(aboutSection.locator("dd", { hasText: /^DISA$/ })).toBeVisible();
        await expect(aboutSection.locator("dt", { hasText: "Benchmark" })).toBeVisible();
        await expect(
          aboutSection.locator("dd", { hasText: "Microsoft Windows Server 2019 Security Technical Implementation Guide" }),
        ).toBeVisible();
        await expect(aboutSection.getByRole("link", { name: "View source details" })).toBeVisible();

        // Also verify Overview facts retain full benchmark title
        const nativeFacts = page.locator(".record-native-facts");
        await expect(nativeFacts.locator("dt", { hasText: "Benchmark" })).toBeVisible();
        await expect(
          nativeFacts.locator("dd", { hasText: "Microsoft Windows Server 2019 Security Technical Implementation Guide" }),
        ).toBeVisible();

        // Section 2: In this publication
        const pubSection = page.locator('[data-rail-section="in-this-publication"]');
        await expect(pubSection.getByRole("heading", { name: "In this publication", level: 2 })).toBeVisible();
        await expect(pubSection.locator(".record-rail-publication-name")).toContainText("Microsoft Windows Server 2019");
        await expect(pubSection.getByRole("link", { name: "View publication" })).toBeVisible();
        await expect(pubSection.getByRole("link", { name: /Browse all rules/ })).toBeVisible();
        await expect(pubSection.getByRole("link", { name: /Open in DISA/ })).toBeVisible();

        // Section 3: Explore related
        const exploreSection = page.locator('[data-rail-section="explore-related"]');
        await expect(exploreSection.getByRole("heading", { name: "Explore related", level: 2 })).toBeVisible();
        const exploreLinks = exploreSection.locator(".record-rail-nav-list a");
        const exploreTexts = await exploreLinks.allInnerTexts();
        expect(exploreTexts).toContain("More from DISA");
        expect(exploreTexts).toContain("More from STIG");
        expect(exploreTexts).toContain("Other Microsoft Windows content");
        expect(exploreTexts).toContain("Server operating system content");
        expect(exploreTexts).toContain("Related CCIs");
        // Ensure all explore links have valid destinations
        const exploreHrefs = await exploreLinks.evaluateAll((links) => links.map((l) => l.getAttribute("href")));
        expect(exploreHrefs.every((href) => Boolean(href) && href.length > 3)).toBe(true);

        // Section 4: Do more
        const doMoreSection = page.locator('[data-rail-section="do-more"]');
        await expect(doMoreSection.getByRole("heading", { name: "Do more", level: 2 })).toBeVisible();
        await expect(doMoreSection.getByRole("link", { name: "View in Atlas" })).toBeVisible();
        await expect(doMoreSection.getByRole("link", { name: "Add to Compare" })).toBeVisible();
        await expect(doMoreSection.getByRole("button", { name: "Share this record" })).toBeVisible();
        await expect(doMoreSection.getByRole("link", { name: /Report an issue/ })).toBeVisible();

        // 4d. DOM & Visual reading order check
        const order = await page.evaluate(() => {
          const main = globalThis.document.querySelector(".record-template-main");
          const sidebar = globalThis.document.querySelector(".record-template-sidebar");
          if (!main || !sidebar) return null;

          const officialText = main.querySelector('[data-record-section="official-text"]');
          const relatedRecords = main.querySelector('[data-record-section="related-records"]');
          const aboutRail = sidebar.querySelector('[data-rail-section="about-this-record"]');
          const pubRail = sidebar.querySelector('[data-rail-section="in-this-publication"]');
          const exploreRail = sidebar.querySelector('[data-rail-section="explore-related"]');
          const doMoreRail = sidebar.querySelector('[data-rail-section="do-more"]');

          return {
            mainBeforeSidebar: (main.compareDocumentPosition(sidebar) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
            officialBeforeRelated: officialText && relatedRecords
              ? (officialText.compareDocumentPosition(relatedRecords) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
              : true,
            aboutBeforePub: aboutRail && pubRail
              ? (aboutRail.compareDocumentPosition(pubRail) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
              : true,
            pubBeforeExplore: pubRail && exploreRail
              ? (pubRail.compareDocumentPosition(exploreRail) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
              : true,
            exploreBeforeDoMore: exploreRail && doMoreRail
              ? (exploreRail.compareDocumentPosition(doMoreRail) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
              : true,
          };
        });

        expect(order).not.toBeNull();
        expect(order.mainBeforeSidebar).toBe(true);
        expect(order.officialBeforeRelated).toBe(true);
        expect(order.aboutBeforePub).toBe(true);
        expect(order.pubBeforeExplore).toBe(true);
        expect(order.exploreBeforeDoMore).toBe(true);

        // Responsive visual reflow: On mobile (< 900px), sidebar appears strictly below main content & related records
        if (width <= 768) {
          const mainBox = await page.locator(".record-template-main").boundingBox();
          const sidebarBox = await page.locator(".record-template-sidebar").boundingBox();
          const relatedBox = await page.locator('[data-record-section="related-records"]').boundingBox();
          expect(mainBox).not.toBeNull();
          expect(sidebarBox).not.toBeNull();
          if (mainBox && sidebarBox) {
            expect(
              sidebarBox.y,
              `Sidebar top (${sidebarBox.y}) should be below main bottom (${mainBox.y + mainBox.height}) at ${width}px`,
            ).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 5);
          }
          if (relatedBox && sidebarBox) {
            expect(
              sidebarBox.y,
              `Sidebar top (${sidebarBox.y}) should be below related records bottom (${relatedBox.y + relatedBox.height}) at ${width}px`,
            ).toBeGreaterThanOrEqual(relatedBox.y + relatedBox.height - 5);
          }
        }
      }
    }
  });
}

test("records without visible relationships do not render empty Related records section or fake 0 badge", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/#/record/dod-zt/DOC-OVERLAYS");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);

  // No empty Related records wrapper or fake 0 badge
  await expect(page.locator('[data-record-section="related-records"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Related records");

  // Top action bar still retains the Atlas connection navigation
  await expect(page.getByRole("link", { name: "See connections" })).toBeVisible();
});

test("records with zero relationships do not render empty Related records section", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  // CSF-2 CATALOG has no correlation relationships
  await page.goto("/#/record/csf-2/CATALOG");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);

  await expect(page.locator('[data-record-section="related-records"]')).toHaveCount(0);
});

test("Resource detail presents single Find more like this section without duplicating topic tags", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/#/resources/tool-cisa-cset");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);

  // Exactly one classification/discovery section: TaxonomyContext ("Find more like this")
  const contextSections = page.locator('[data-record-section="taxonomy-context"]');
  await expect(contextSections).toHaveCount(1);
  await expect(contextSections.getByRole("heading", { name: "Find more like this", level: 2 })).toBeVisible();

  // No duplicate "Related topics" section or table of contents entry
  await expect(page.locator("#related-topics")).toHaveCount(0);
  await expect(page.locator(".resource-detail-toc")).not.toContainText("Related topics");
});

test("Share this record button provides copy feedback on record detail", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/#/record/disa-stig/V-205646");
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);

  const shareButton = page.locator('[data-rail-section="do-more"]').getByRole("button", { name: "Share this record" });
  await expect(shareButton).toBeVisible();
  await shareButton.click();
  await expect(page.locator('[data-rail-section="do-more"]').getByRole("button", { name: "Link copied" })).toBeVisible();
});
