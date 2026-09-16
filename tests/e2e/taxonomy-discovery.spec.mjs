import { expect, test } from "@playwright/test";

import { dismissOnboarding, waitForAppReady } from "./support.mjs";

async function open(page, route) {
  await page.goto(route);
  await waitForAppReady(page);
  await dismissOnboarding(page);
}

async function resultTotal(page) {
  const label = await page.locator(".workspace-result-count").innerText();
  const matches = label.match(/([\d,]+) matches/i);
  const showing = label.match(/of ([\d,]+) results?/i);
  const exact = label.match(/([\d,]+) results?/i);
  return Number((matches?.[1] || showing?.[1] || exact?.[1] || "0").replaceAll(",", ""));
}

const primaryDimensions = [
  ["asset_class", "Asset and system"],
  ["domain", "Security domain"],
  ["vendor_brand", "Vendor"],
  ["program", "Program"],
];

test("primary taxonomy dimensions stay discoverable at every workspace breakpoint", async ({ page }) => {
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await open(page, "/#/library");

    const primary = width >= 1024
      ? page.locator(".workspace-facet-rail .workspace-primary-taxonomy-facets")
      : page.locator(".workspace-mobile-primary-filters");
    await expect(primary).toBeVisible();
    for (const [dimensionId, label] of primaryDimensions) {
      const disclosure = primary.locator(`[data-taxonomy-dimension="${dimensionId}"]`);
      await expect(disclosure.locator("summary")).toHaveText(label);
      await expect(disclosure.locator("summary")).toBeVisible();
    }

    const overflow = await page.evaluate(() => ({
      documentWidth: globalThis.document.documentElement.scrollWidth,
      viewportWidth: globalThis.innerWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  }
});

test("compact primary facets open by keyboard and Escape returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/#/library");

  const primary = page.locator(".workspace-mobile-primary-filters");
  const assetDisclosure = primary.locator('[data-taxonomy-dimension="asset_class"]');
  const summary = assetDisclosure.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(assetDisclosure).toHaveAttribute("open", "");
  await expect(assetDisclosure.getByRole("checkbox", { name: /Server/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(assetDisclosure).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
});

test("governed tags keep stable URL, OR/AND, alias, count, and unavailable-value behavior", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/#/library");

  const facets = page.locator(".workspace-facet-rail");
  const assetDisclosure = facets.locator('[data-taxonomy-dimension="asset_class"]');
  await assetDisclosure.locator("summary").click();
  const assetFacet = assetDisclosure.getByRole("group", { name: "Asset and system" });
  await assetFacet.getByPlaceholder("Find asset and system").fill("dbms");
  await expect(assetFacet.getByRole("checkbox", { name: /Database/ })).toBeVisible();
  await assetFacet.getByPlaceholder("Find asset and system").fill("");

  await assetFacet.getByRole("checkbox", { name: /Server/ }).click();
  await expect(page).toHaveURL(/tag=asset\.server/);
  const serverCount = await resultTotal(page);
  expect(serverCount).toBe(5083);
  await expect(page.getByRole("button", { name: "Remove Server filter" })).toBeVisible();

  await assetFacet.getByRole("checkbox", { name: /Workstation/ }).click();
  await expect(page).toHaveURL(/tag=asset\.server.*tag=asset\.workstation/);
  await expect.poll(() => resultTotal(page)).toBe(6309);

  const vendorDisclosure = facets.locator('[data-taxonomy-dimension="vendor_brand"]');
  await vendorDisclosure.locator("summary").click();
  const vendorFacet = vendorDisclosure.getByRole("group", { name: "Vendor" });
  await vendorFacet.getByRole("checkbox", { name: /Microsoft/ }).click();
  await expect(page).toHaveURL(/tag=asset\.server.*tag=asset\.workstation.*tag=vendor\.microsoft/);
  await expect.poll(() => resultTotal(page)).toBe(2221);

  await page.goBack();
  await expect(page).toHaveURL(/tag=asset\.server.*tag=asset\.workstation/);
  await expect.poll(() => resultTotal(page)).toBe(6309);
  await page.goForward();
  await expect(page).toHaveURL(/tag=asset\.server.*tag=asset\.workstation.*tag=vendor\.microsoft/);
  await expect.poll(() => resultTotal(page)).toBe(2221);

  await open(page, "/#/library?tag=asset.iot");
  const contextualVendorDisclosure = page.locator('.workspace-facet-rail [data-taxonomy-dimension="vendor_brand"]');
  await expect(contextualVendorDisclosure).toHaveCount(0);
});

test("result rows select high-signal governed tags without redundant identity labels", async ({ page }) => {
  await open(page, "/#/library?q=V-218786");
  const disa = page.locator('[data-record-id="disa-stig:V-218786"]');
  await expect(disa.locator(".atlas-tag__label")).toHaveText(["Server", "STIG", "Microsoft"]);

  await open(page, "/#/library?q=AC-24");
  const nist = page.locator('[data-record-id="nist-800-53:AC-24"]');
  await expect(nist.locator(".atlas-tag__label")).toHaveText(["Access Control"]);

  for (const [route, recordId] of [
    ["/#/library?filter=mitre-attack", "mitre-attack:T1003.008"],
    ["/#/library?filter=fedramp-rev5", "fedramp-rev5:HIGH"],
    ["/#/library?filter=microsoft-zt-maturity", "microsoft-zt-maturity:PILLAR-APPLICATIONS"],
  ]) {
    await open(page, route);
    await expect(page.locator(`[data-record-id="${recordId}"] .atlas-tag`)).toHaveCount(0);
  }

  await open(page, "/#/library?filter=cmmc-2");
  const cmmc = page.locator('[data-record-id="cmmc-2:LEVEL-1"]');
  await expect(cmmc.locator(".atlas-tag")).toHaveCount(0);
});

test("result taxonomy links preserve Library state without nesting or opening the record", async ({ page }) => {
  await open(page, "/#/library?q=V-218786&filter=disa-stig&tag=vendor.microsoft");
  const row = page.locator('[data-record-id="disa-stig:V-218786"]');
  await expect(row.locator("a a")).toHaveCount(0);
  await expect(row.getByRole("link", { name: "Open DISA Microsoft IIS 10.0 Server V-218786" })).toBeVisible();

  const stig = row.getByRole("link", { name: "Filter by STIG" });
  await expect(stig).toHaveAttribute("href", /q=V-218786/);
  await expect(stig).toHaveAttribute("href", /filter=disa-stig/);
  await stig.click();
  await expect(page).toHaveURL(/#\/library\?/);
  const activeState = await page.evaluate(() => {
    const params = new URLSearchParams(globalThis.location.hash.split("?")[1] || "");
    return {
      filter: params.get("filter"),
      query: params.get("q"),
      tags: params.getAll("tag").sort(),
    };
  });
  expect(activeState).toEqual({
    filter: "disa-stig",
    query: "V-218786",
    tags: ["program.stig", "vendor.microsoft"],
  });
  await expect(page.locator('[data-record-id="disa-stig:V-218786"]')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/q=V-218786/);
  await expect(page).not.toHaveURL(/program\.stig/);
  await page.goForward();
  await expect(page).toHaveURL(/program\.stig/);

  await open(page, "/#/library?q=V-218786");
  await page.locator('[data-record-id="disa-stig:V-218786"]').getByRole("link", { name: "Open DISA Microsoft IIS 10.0 Server V-218786" }).click();
  await expect(page).toHaveURL(/#\/record\/disa-stig\/V-218786$/);
});

test("result taxonomy tags remain bounded and independently usable at every breakpoint", async ({ page }) => {
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await open(page, "/#/library?q=V-218786");
    const row = page.locator('[data-record-id="disa-stig:V-218786"]');
    const metrics = await row.evaluate((element) => {
      const rowRect = element.getBoundingClientRect();
      const tags = [...element.querySelectorAll(".atlas-tag")].map((tag) => tag.getBoundingClientRect());
      return {
        documentWidth: globalThis.document.documentElement.scrollWidth,
        lineCount: new Set(tags.map((tag) => Math.round(tag.top))).size,
        rowHeight: rowRect.height,
        tagsInsideRow: tags.every((tag) => tag.left >= rowRect.left && tag.right <= rowRect.right && tag.bottom <= rowRect.bottom),
        viewportWidth: globalThis.innerWidth,
      };
    });
    expect(await row.getByRole("link", { name: "Filter by Server" }).isVisible()).toBe(true);
    expect(await row.getByRole("link", { name: "Filter by STIG" }).isVisible()).toBe(true);
    expect(await row.getByRole("link", { name: "Filter by Microsoft" }).isVisible()).toBe(true);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.lineCount).toBeLessThanOrEqual(2);
    expect(metrics.tagsInsideRow).toBe(true);
    expect(metrics.rowHeight).toBeLessThanOrEqual(width === 390 ? 340 : 250);
  }
});

test("Advanced keeps secondary dimensions without duplicating promoted taxonomy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/#/library");

  const advanced = page.locator(".workspace-facet-rail details.workspace-advanced-facets");
  await advanced.locator(":scope > summary").click();
  for (const [, label] of primaryDimensions) {
    await expect(advanced.getByRole("group", { name: label })).toHaveCount(0);
  }
  for (const label of ["Publisher", "Technology", "Product", "Framework", "Organization", "Environment"] ) {
    await expect(advanced.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(advanced.getByText("Has published connections", { exact: true })).toBeVisible();
});

test("clear-all preserves text search and zero-result recovery remains available", async ({ page }) => {
  await open(page, "/#/library?q=account&tag=domain.access-control");
  await expect.poll(() => resultTotal(page)).toBe(137);
  await page.getByRole("button", { name: "Remove Access Control filter" }).click();
  await expect(page).toHaveURL(/#\/library\?q=account$/);
  await expect.poll(() => resultTotal(page)).toBe(3710);

  await open(page, "/#/library?q=account&tag=domain.access-control");
  await page.locator(".active-filter-row .clear-filter-link").click();
  await expect(page).toHaveURL(/#\/library\?q=account$/);
  await expect.poll(() => resultTotal(page)).toBe(3710);

  await open(page, "/#/library?tag=asset.iot&tag=product.microsoft-windows");
  await expect(page.locator(".workspace-result-count")).toHaveText("0 results");
  await expect(page.getByText("Nothing matches these filters.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
});

test("record and Resource governed tags hand off to the filtered Library", async ({ page }) => {
  await open(page, "/#/record/nist-mobile-threats/CEL-1");
  await page.getByRole("link", { name: "Filter the Library by Mobile", exact: true }).click();
  await expect(page).toHaveURL(/#\/library\?tag=asset\.mobile/);
  await expect(page.getByRole("button", { name: /Mobile/ })).toBeVisible();

  await open(page, "/#/record/disa-cci/CCI-000366");
  await page.getByRole("link", { name: "Filter the Library by Configuration Management" }).click();
  await expect(page).toHaveURL(/#\/library\?tag=domain\.configuration-management/);
  await expect(page.getByRole("button", { name: /Configuration Management/ })).toBeVisible();

  await open(page, "/#/resources/tool-cisa-cset");
  const relatedTopics = page.getByRole("heading", { name: "Related topics" }).locator("..");
  await relatedTopics.getByRole("link", { name: "Microsoft Windows" }).click();
  await expect(page).toHaveURL(/#\/library\?tag=product\.microsoft-windows/);
  await expect(page.getByRole("button", { name: /Microsoft Windows/ })).toBeVisible();
});

test("global navigation has no breakpoint dead zone", async ({ page }) => {
  for (const width of [1023, 1024, 1119, 1199]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, "/#/about");
    const toggle = page.getByRole("button", { name: "Open navigation menu" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveCSS("min-height", "44px");
  }

  await page.setViewportSize({ width: 1024, height: 800 });
  await open(page, "/#/about");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("navigation", { name: "Primary navigation (mobile)" }).getByRole("link", { name: "Guides" }).click();
  await expect(page).toHaveURL(/#\/guides$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/about$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/guides$/);

  await page.setViewportSize({ width: 1200, height: 800 });
  await open(page, "/#/about");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open more pages" })).toBeVisible();
});

test("record actions stay in the viewport and Escape restores focus", async ({ page }) => {
  for (const width of [320, 375, 390, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, "/#/record/nist-800-53/AC-2");
    const summary = page.locator(".record-actions-menu summary");
    await summary.click();
    const metrics = await page.locator(".record-actions-popover").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        documentWidth: globalThis.document.documentElement.scrollWidth,
        left: rect.left,
        right: rect.right,
        viewportWidth: globalThis.innerWidth,
      };
    });
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    await page.keyboard.press("Escape");
    await expect(page.locator(".record-actions-menu")).not.toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
  }
});

test("Home exposes compact release, source, and contribution trust links", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    const home = page.locator("[data-static-home]:not([hidden])");
    await expect(home.locator('[data-app-ready="true"]')).toBeVisible();
    const footer = home.locator(".home-footer");
    await expect(footer).toContainText("Free and open source. Not a government system.");
    await expect(footer).toContainText("Product release");
    await expect(footer).toContainText("Source data built");
    await expect(footer.getByRole("link", { name: "Source attribution" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Submit resource" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Report a problem" })).toBeVisible();
  }
});

test("Resources presents governed labels instead of raw enums", async ({ page }) => {
  await open(page, "/#/resources/official-cisa-kev-catalog");
  // The dataset profile publishes resource type, access status, and
  // verification method. Each must reach the page as a governed label; the
  // stored enum value must never surface.
  await expect(page.locator(".resource-detail-brief").getByText("Dataset", { exact: true })).toBeVisible();
  const access = page.getByRole("heading", { name: "How to use or access", exact: true }).locator("..");
  await expect(access.getByText("Current", { exact: true })).toBeVisible();
  const maintenance = page.locator("details.resource-detail-maintenance");
  await maintenance.locator("summary").click();
  await expect(maintenance.getByText("Public URL", { exact: true })).toBeVisible();
  for (const rawEnum of ["dataset", "current", "public_url"]) {
    await expect(page.getByText(rawEnum, { exact: true })).toHaveCount(0);
  }
});

test("Guide context hands governed tags to the Library", async ({ page }) => {
  await open(page, "/#/guides?pattern=cloud-and-shared-responsibility");
  const guideTags = page.getByRole("region", { name: /Related Library tags for Cloud and shared responsibility/i });
  const guideTag = guideTags.getByRole("link").first();
  await expect(guideTag).toBeVisible();
  await guideTag.click();
  await expect(page).toHaveURL(/#\/library\?tag=/);
});

test("tag discovery reaches governed catalogs and guides without duplicating record rows", async ({ page }) => {
  await open(page, "/#/library?tag=environment.cloud");
  const related = page.getByRole("region", { name: "Related content across Control Atlas" });
  await expect(related.getByRole("heading", { name: /Guides \(1\)/ })).toBeVisible();
  await expect(related.getByRole("link", { name: "Cloud and shared responsibility" })).toBeVisible();
  await expect(related.getByText(/Records \(/)).toHaveCount(0);

  await open(page, "/#/library?tag=framework.rmf");
  await expect(page.getByRole("region", { name: "Related content across Control Atlas" })
    .getByRole("link", { name: "SP 800-53 Rev. 5" })).toBeVisible();
});

test("Compare shows shared and differing governed tags at desktop and narrow widths", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await open(page, "/#/compare/relationships?intent=frameworks&source=nist-800-53&target=csf-2&compareRun=true");
    const context = page.getByRole("region", { name: "Taxonomy context" });
    await expect(context.getByRole("heading", { name: "Shared tags" })).toBeVisible();
    await expect(context.getByRole("heading", { name: "Only in SP 800-53 Rev. 5" })).toBeVisible();
    await expect(context.getByRole("heading", { name: "Only in NIST CSF 2.0" })).toBeVisible();
    await expect(context.getByRole("link", { name: "NIST" }).first()).toBeVisible();
    const overflow = await page.evaluate(() => ({
      documentWidth: globalThis.document.documentElement.scrollWidth,
      viewportWidth: globalThis.innerWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  }
});

test("starter-document context preserves the selected document and preview", async ({ page }) => {
  await open(page, "/#/build/documents/security_plan_starter?framework=nist-800-53&baseline=LOW");
  expect(await page.evaluate(() => globalThis.scrollY)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Configure inputs" })).toBeVisible();
  const context = page.getByRole("complementary", { name: "Current document" });
  await expect(context).toContainText("Security Plan Starter");
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
});

test("retired STIG Compare links recover to the published crosswalk", async ({ page }) => {
  await open(page, "/#/compare/stig-chain?chainCatalog=disa-stig");
  await expect(page).toHaveURL(/#\/compare$/);
  await expect(page.getByText(
    "This Compare link used a retired workflow. Start a published crosswalk here.",
    { exact: true },
  )).toBeVisible();
});
