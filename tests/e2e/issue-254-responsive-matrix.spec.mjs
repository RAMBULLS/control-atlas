import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, waitForAppReady } from "./support.mjs";

const WIDTHS = [320, 375, 390, 768, 1024, 1440];
const STIG = "/#/record/disa-stig/V-205646";
const BENCHMARK = "Microsoft Windows Server 2019 Security Technical Implementation Guide";
const REPRESENTATIVES = [
  { role: "atomic_record", route: STIG },
  { role: "atomic_record", route: "/#/record/nist-800-53/AC-2" },
  { role: "atomic_record", route: "/#/record/disa-cci/CCI-000366" },
  { role: "container", route: "/#/record/nist-800-53/FAMILY-AC" },
  { role: "publication_document", route: "/#/record/csf-2/CATALOG" },
  { role: "entity_contributor", route: "/#/record/nist-zt/COLLABORATOR-APPGATE-835EC7F121" },
  { role: "assessment_question", route: "/#/record/nist-800-53a/AC-1" },
  { role: "implementation_artifact", route: "/#/record/nist-zt/SP180035-E1B1" },
];

async function open(page, route, width = 1440) {
  await page.setViewportSize({ width, height: width < 900 ? 844 : 1000 });
  await page.goto(route);
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
}

async function checkTagTargets(page) {
  const tags = page.locator("[data-discovery-tags] .record-discovery-tag");
  for (const tag of await tags.all()) {
    const box = await tag.boundingBox();
    expect(box).not.toBeNull();
    // Firefox reports a 44px control as 43.99997 after subpixel layout; 43.5 matches the phase-5 touch-target check.
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    await expect(tag.locator("svg")).toHaveCount(1);
    await expect(tag.locator(".record-discovery-tag__label")).not.toHaveText(/^#/);
    await expect(tag).toHaveAttribute("href", /tag=/);
  }
}

for (const sample of REPRESENTATIVES) {
  test(`record role and responsive layout: ${sample.route}`, async ({ page }) => {
    test.setTimeout(180_000);
    attachPageDiagnostics(page);
    for (const width of WIDTHS) {
      await open(page, sample.route, width);
      const record = page.locator('[data-template="E"]');
      await expect(record).toBeVisible();
      await expect(record).toHaveAttribute("data-page-role", sample.role);
      await expect(record.locator("h1")).not.toBeEmpty();
      await expect(page.getByRole("heading", { name: "Record not found", exact: true })).toHaveCount(0);
      await expect(record.locator("[data-record-source-error]")).toHaveCount(0);
      await expect(record.locator(".record-template-main")).not.toBeEmpty();
      await expect(record.locator(".taxonomy-dimension-row")).toHaveCount(0);
      await expect(record.locator(".record-discovery-tag__hash")).toHaveCount(0);
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await checkTagTargets(page);

      const rail = record.locator(".record-template-sidebar");
      const cards = rail.locator(":scope > details[data-rail-section]");
      expect(await cards.count()).toBeGreaterThanOrEqual(2);
      const ids = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-rail-section")));
      const order = ["about-this-record", "in-this-publication", "explore-related", "do-more"];
      expect(ids).toEqual(order.filter((id) => ids.includes(id)));
      for (const card of await cards.all()) {
        const summary = card.locator(":scope > summary");
        await expect(summary).toBeVisible();
        if (width <= 768) {
          await expect(card).not.toHaveAttribute("open", "");
          await expect(card.locator(".ca-record-rail__body")).toBeHidden();
        } else {
          await expect(card).toHaveAttribute("open", "");
          await expect(card.locator(".ca-record-rail__body")).toBeVisible();
        }
      }
      if (width <= 768) {
        const mainBox = await record.locator(".record-template-main").boundingBox();
        const railBox = await rail.boundingBox();
        expect(railBox.y).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 1);
      }
    }
  });
}

test("STIG desktop composition aligns the action cluster and utility rail beside identity", async ({ page }) => {
  await open(page, STIG);
  const identity = await page.locator(".ca-record-heading").boundingBox();
  const actions = await page.locator(".record-title-actions").boundingBox();
  const rail = await page.locator(".record-template-sidebar").boundingBox();
  expect(actions.x).toBeGreaterThanOrEqual(identity.x + identity.width);
  expect(Math.abs(actions.y - identity.y)).toBeLessThanOrEqual(8);
  expect(rail.x).toBeGreaterThan(actions.x + actions.width);
  expect(Math.abs(rail.y - identity.y)).toBeLessThanOrEqual(8);
  await expect(page.locator(".record-title-block [data-discovery-tags]")).toHaveCount(1);
  await expect(page.locator(".record-template-sidebar > details[data-rail-section]")).toHaveCount(4);
  await expect(page.locator('[data-rail-section="do-more"]')).toHaveClass(/ca-record-rail--actions/);
  await expect(page.locator('#section-overview dt').filter({ hasText: "Benchmark" })).toHaveCount(0);
  await expect(page.locator('[data-rail-section="about-this-record"] dd').filter({ hasText: BENCHMARK })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Open in DISA", exact: true })).toHaveCount(0);
  const count = await page.locator(".record-connections .section-header > .badge").boundingBox();
  const header = await page.locator(".record-connections .section-header").boundingBox();
  expect(count.width).toBeLessThan(header.width / 2);
});

test("mobile disclosures expand with keyboard and reset correctly across breakpoints", async ({ page }) => {
  await open(page, STIG, 375);
  const cards = page.locator(".record-template-sidebar > details[data-rail-section]");
  await expect(cards).toHaveCount(4);
  for (const card of await cards.all()) {
    await expect(card).not.toHaveAttribute("open", "");
    await card.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("open", "");
    await expect(card.locator(".ca-record-rail__body")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(card).not.toHaveAttribute("open", "");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const card of await cards.all()) await expect(card).toHaveAttribute("open", "");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const card of await cards.all()) await expect(card).not.toHaveAttribute("open", "");
});

test("section jumps and related-CCI jumps do not destroy the record route", async ({ page }) => {
  await open(page, STIG, 375);
  const originalUrl = page.url();
  for (const label of ["Overview", "Discussion", "Check", "Fix", "Related records"]) {
    await page.getByRole("navigation", { name: "Record sections" }).getByRole("button", { name: label, exact: true }).click();
    await expect(page).toHaveURL(originalUrl);
    await expect(page.locator('[data-template="E"]')).toBeVisible();
  }
  const related = page.locator('#section-related-records');
  await expect(related).toContainText("CCI-000185");
  const explore = page.locator('[data-rail-section="explore-related"]');
  await explore.locator("summary").click();
  await explore.getByRole("button", { name: "Related CCIs" }).click();
  await expect(page).toHaveURL(originalUrl);
  await expect(related).toBeInViewport();
});

test("publication browsing retains the Windows Server benchmark scope", async ({ page }) => {
  await open(page, STIG);
  const publication = page.locator('[data-rail-section="in-this-publication"]');
  const browse = publication.getByRole("link", { name: /Browse all/ });
  await expect(browse).toHaveAttribute("href", /family=/);
  await browse.click();
  await waitForAppReady(page, { allowPartial: true });
  await expect(page.locator(".catalog-detail-page")).toBeVisible();
  expect(decodeURIComponent(page.url().replaceAll("+", " "))).toContain(BENCHMARK);
  await expect(page.getByRole("heading", { name: /not found/i })).toHaveCount(0);
});

test("resource detail uses the same flat, clickable glyph tags without a duplicate classification block", async ({ page }) => {
  for (const width of [375, 1440]) {
    await open(page, "/#/resources/tool-cisa-cset", width);
    await expect(page.locator(".resource-detail-page")).toBeVisible();
    await expect(page.locator("[data-discovery-tags]")).toHaveCount(1);
    await expect(page.locator(".taxonomy-dimension-row, #related-topics")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Find more like this", exact: true })).toHaveCount(0);
    await checkTagTargets(page);
  }
  await page.locator("[data-discovery-tags]").getByRole("link", { name: "Filter the Library by Microsoft Windows", exact: true }).click();
  await expect(page).toHaveURL(/tag=product\.microsoft-windows/);
});

test("share confirms the canonical record URL only after clipboard success", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value) => { globalThis.__recordCopied = value; },
    } });
  });
  await open(page, STIG);
  const originalUrl = page.url();
  await page.getByRole("navigation", { name: "Record sections" }).getByRole("button", { name: "Check", exact: true }).click();
  await page.locator('[data-rail-section="do-more"]').getByRole("button", { name: "Share this record" }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__recordCopied)).toBe(originalUrl);
  await expect(page.getByRole("button", { name: "Link copied", exact: true })).toBeVisible();
});

test("clipboard denial never shows a false copied confirmation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new Error("denied"); },
    } });
  });
  await open(page, STIG);
  await page.locator('[data-rail-section="do-more"]').getByRole("button", { name: "Share this record" }).click();
  await expect(page.getByText("Copy failed. Use your browser’s share menu.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Link copied", exact: true })).toHaveCount(0);
});

test("no visible relationships produces no empty zero-count panel while preserving Atlas navigation", async ({ page }) => {
  for (const route of ["/#/record/dod-zt/DOC-OVERLAYS", "/#/record/csf-2/CATALOG"]) {
    await open(page, route);
    await expect(page.locator('[data-template="E"]')).toBeVisible();
    await expect(page.locator('[data-record-section="related-records"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "See connections", exact: true })).toBeVisible();
  }
});
