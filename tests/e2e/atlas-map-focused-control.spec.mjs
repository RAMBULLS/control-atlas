import { expect, test } from "@playwright/test";
import {
  attachPageDiagnostics,
  dismissOnboarding,
  waitForAppReady,
} from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

// 2026-08-03: Path/Map/List were folded into one record workspace —
// Connections is the product, Hierarchy and View all are supporting panels
// opened on demand. relationshipView still round-trips through the URL (it
// now selects which panel is open) so every old deep link keeps resolving.
test("focused Atlas opens straight to Connections, not a structural page", async ({ page }) => {
  await page.goto("/#/explore?node=nist-800-53%3AAC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

    await expect(page.getByRole("heading", { name: "Connections", level: 2 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Relationship map" })).toBeVisible();
  const hierarchyToggle = page.getByRole("button", { name: "Hierarchy" });
  const viewAllToggle = page.getByRole("button", { name: "View all", exact: true });
  await expect(hierarchyToggle).toHaveAttribute("aria-expanded", "false");
  await expect(viewAllToggle).toHaveAttribute("aria-expanded", "false");
  // Both panels stay closed until asked for — the workspace never opens
  // pre-expanded onto a structural page the way the old Path default did.
  await expect(page.getByRole("heading", { name: "Where this sits" })).toHaveCount(0);
  await expect(page.locator(".atlas-path-stage-option")).toHaveCount(0);
  await expect(page.locator(".atlas-path-record")).toHaveCount(0);
});

test("Hierarchy panel shows real structural substance, not just breadcrumb lines", async ({ page }) => {
  await page.goto("/#/explore?node=nist-800-53%3AAC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("button", { name: "Hierarchy" }).click();
  await expect(page).toHaveURL(/relationshipView=path/);
  const panel = page.locator("#atlas-hierarchy-panel");
  await expect(panel.getByRole("heading", { name: "Where this sits" })).toBeVisible();
  // Two rails, not one mixed "publisher-declared" claim.
  await expect(
    panel.getByText(/Control Atlas structure|Publisher hierarchy/).first(),
  ).toBeVisible();
  // Record type, publication, identifier, and the record's own published
  // children — the substance a single-heading panel never had.
  await expect(panel.getByText("Record type")).toBeVisible();
  await expect(panel.getByText("Publication")).toBeVisible();
  await expect(panel.getByText("Decomposes into")).toBeVisible();
  await expect(panel.getByRole("link", { name: "AC-2.1", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "See connections" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Open full record" })).toHaveCount(0);
});

test("focused Hierarchy badges the organizing hops, not just the direct record page", async ({ page }) => {
  // Regression: AtlasMapPage's own "Where this sits" rail used to hardcode
  // origin: "structural" for every hop in record.structural_path, silently
  // overwriting the trunk/limb hops' real "organizing" origin — so the
  // Control-Atlas-structure badge rendered correctly on /#/record/:catalog/:id
  // but never on this Explore-embedded view of the exact same record, even
  // though the underlying data was correct both places. Fixed by deriving
  // origin from node_type in runtimeLoader.ts instead of hardcoding it.
  await page.goto("/#/explore?node=nist-800-53%3AAC-2&relationshipView=path");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const rail = page.getByRole("navigation", { name: "Where this sits" });
  const cybersecurity = rail.getByRole("link", {
    name: /Cybersecurity — Control Atlas structure/,
  });
  await expect(cybersecurity).toHaveClass(/atlas-path-crumb-organizing/);
  await expect(cybersecurity).toHaveAttribute(
    "title",
    "Control Atlas structure",
  );
  const compliance = rail.getByRole("link", {
    name: /Compliance — Control Atlas structure/,
  });
  await expect(compliance).toHaveClass(/atlas-path-crumb-organizing/);
  // The publisher-declared hops must stay unbadged — this isn't "badge
  // everything", it's "badge only the hops Control Atlas itself organized".
  const catalog = rail.getByRole("link", { name: "SP 800-53 Rev. 5 Catalog" });
  await expect(catalog).not.toHaveClass(/atlas-path-crumb-organizing/);
  await expect(rail.getByText("Authority", { exact: true })).toBeVisible();
  const authority = rail.getByRole("link", {
    name: /40 U\.S\.C\. § 11331 — Official authority/,
  });
  await expect(authority).toHaveClass(/atlas-path-crumb-authority/);
  await expect(authority).toHaveAttribute("title", "Official authority");
});

test("focused Hierarchy opens its publisher-declared parent without inventing another parent", async ({ page }) => {
  await page.goto("/#/explore?node=nist-800-53%3AAC-2&relationshipView=path");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page
    .getByRole("navigation", { name: "Where this sits" })
    .getByRole("link", { name: "Access Control" })
    .click();
    await expect(page.locator("#atlas-hierarchy-panel")).toContainText("FAMILY-AC");
  // Hierarchy re-opens on the newly focused record — relationshipView=path
  // survives the navigation, same as any other Atlas link.
  await expect(
    page.getByRole("navigation", { name: "Where this sits" }),
  ).toContainText("SP 800-53 Rev. 5");
  await expect(page).toHaveURL(/atlas\/nist-800-53:FAMILY-AC/);
  await expect(page).not.toHaveURL(/atlasBaseline=/);
});

test("Hierarchy and View all are independently reachable and operable by keyboard", async ({ page }) => {
  await page.goto("/#/explore?node=nist-800-53%3AAC-2");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const hierarchyToggle = page.getByRole("button", { name: "Hierarchy" });
  await hierarchyToggle.focus();
  await page.keyboard.press("Enter");
  await expect(hierarchyToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(/relationshipView=path/);
  await expect(page.locator(".route-transition")).toBeHidden();

  const viewAllToggle = page.getByRole("button", { name: "View all", exact: true });
  // Opening Hierarchy moves focus into its newly rendered links. Verify the
  // second native control independently rather than assuming the two controls
  // remain adjacent in the expanded panel's focus order.
  await viewAllToggle.focus();
  await expect(viewAllToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(viewAllToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(/relationshipView=list/);
  // Opening View all closes Hierarchy — they are two panels on one toolbar,
  // not independent checkboxes stacking on top of each other.
  await expect(hierarchyToggle).toHaveAttribute("aria-expanded", "false");
});

test("Connections answers relationship type and count before any individual record", async ({ page }) => {
  await page.goto("/#/explore?node=nist-800-53%3AAC-2&relationshipView=map");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const map = page.getByRole("region", { name: "Relationship map" });
  await expect(map).toBeVisible();
  const lensGroups = map.getByRole("group", { name: "Relationship types" });
  await expect(lensGroups).toBeVisible();
  // AC-2's 47 DISA CCIs are correlation junctions, not implementation
  // records — they mediate a path to real STIG/SRG implementation but are
  // never classified as Implementation themselves.
  const correlation = lensGroups.getByRole("button", { name: /Correlation/ });
  await expect(correlation).toBeVisible();
  await expect(correlation).toContainText("47");
  // The map is the bespoke radial diagram, not a generic force-graph demo.
  await expect(map.locator(".react-flow")).toHaveCount(0);

  await correlation.click();
  await expect(map.getByRole("button", { name: /View all \d+ in List/ })).toBeVisible();
  // Clicking a spoke never rebuilds the diagram — the same four groups stay
  // exactly where they were.
  await expect(lensGroups.getByRole("button")).toHaveCount(4);

  await page.getByRole("button", { name: "View all", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Relationship table" }),
  ).toBeVisible();
  // View all supports the map; it does not replace it.
  await expect(map).toBeVisible();
});

test("List uses the same published set and exposes traceable source references", async ({ page }) => {
  await page.goto("/#/explore?node=nist-800-53%3AAC-2&relationshipView=list");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const table = page.getByRole("table", { name: "Relationship table" });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr").first()).toBeVisible();
  await expect(table.getByText(/source reference/i).first()).toBeVisible();
  await expect(table).not.toContainText("Expanded item");
  await expect(table).not.toContainText("nist-olir-");
});

test("zero-published-edge records render an honest empty state instead of Connections", async ({ page }) => {
  await page.goto("/#/explore?node=disa-cci%3ACCI-000220&relationshipView=map");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(page.getByRole("heading", { name: "No published connections to show." })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Relationship map" }),
  ).toHaveCount(0);
  await expect(page.locator(".react-flow")).toHaveCount(0);
});

test("a sparse STIG keeps structural position separate from its published connections", async ({ page }) => {
  await page.goto("/#/explore?node=disa-stig%3AV-222387");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole("button", { name: "Hierarchy" }).click();
  await expect(page.locator("#atlas-hierarchy-panel")).toContainText(
    /Control Atlas structure|Publisher hierarchy/,
  );
  await page.getByRole("button", { name: "View all", exact: true }).click();
  const table = page.getByRole("table", { name: "Relationship table" });
  await expect(table).toBeVisible();
  await expect(table).toContainText(/implementation/i);
});

test("compact Connections shows a readable vertical neighborhood without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/explore?node=nist-800-53%3AAC-2&relationshipView=map");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const map = page.getByRole("region", { name: "Relationship map" });
  // Mobile trades the radial diagram for a vertical stack of the same bounded
  // group data — never a shrunken, illegible copy of the desktop diagram.
  await expect(map.locator(".atlas-radial-map--stacked")).toBeVisible();
  const groups = map.getByRole("group", { name: "Relationship types" }).getByRole("button");
  expect(await groups.count()).toBeLessThanOrEqual(7);
  const overflow = await page.evaluate(() => ({
    body:
      globalThis.document.body.scrollWidth -
      globalThis.document.body.clientWidth,
    document:
      globalThis.document.documentElement.scrollWidth -
      globalThis.document.documentElement.clientWidth,
  }));
  expect(overflow).toEqual({ body: 0, document: 0 });
});

test("compact Hierarchy preserves structural position without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/explore?node=nist-800-53%3AAC-2&relationshipView=path");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await expect(
    page.locator("#atlas-hierarchy-panel"),
  ).toContainText(/Control Atlas structure|Publisher hierarchy/);
  const overflow = await page.evaluate(() => ({
    body:
      globalThis.document.body.scrollWidth -
      globalThis.document.body.clientWidth,
    document:
      globalThis.document.documentElement.scrollWidth -
      globalThis.document.documentElement.clientWidth,
  }));
  expect(overflow).toEqual({ body: 0, document: 0 });
});
