/* global document, getComputedStyle */
import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

const resourceName = "MITRE eMASS REST API Python Client";
const resourceRoute = /#\/resources\/tool-mitre-emass-client(?:\?|$)/;

async function open(page, path) {
  attachPageDiagnostics(page);
  await gotoApp(page, path);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const banner = page.getByRole("region", { name: "Optional analytics", exact: true });
  if (await banner.isVisible()) await banner.getByRole("button", { name: "Decline", exact: true }).click();
}

test("every resource section jump preserves its route, query and browser history", async ({ page }) => {
  await open(page, "/#/resources?q=eMASS&showAll=true");
  const listingUrl = page.url();
  await page.locator("#workspace").getByRole("link", { name: new RegExp(resourceName) }).click();
  await expect(page).toHaveURL(resourceRoute);
  await expect(page.getByRole("heading", { name: resourceName, exact: true })).toBeVisible();
  const detailUrl = page.url();
  const contents = page.getByRole("navigation", { name: "On this page", exact: true });
  const sections = [
    ["What it is", "what-it-is"], ["Who it's for", "who-it-is-for"],
    ["How to use or access", "access"], ["Screenshots", "screenshots"],
    ["Limitations", "limitations"], ["Related resources", "related-resources"],
    ["Filed under", "filed-under"],
  ];
  await expect(contents.getByRole("button", { name: "Jump to How to use or access", exact: true })).toBeVisible();
  for (const [label, id] of sections) {
    const jump = contents.getByRole("button", { name: `Jump to ${label}`, exact: true });
    if (await jump.count() === 0) continue;
    await jump.click();
    await expect(page).toHaveURL(detailUrl);
    await expect(page.locator(`#${id}`)).toBeFocused();
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
  // Repeated keyboard activation is a jump, never a hash-router navigation.
  const access = contents.getByRole("button", { name: "Jump to How to use or access", exact: true });
  await access.focus();
  await access.press("Enter");
  await expect(page.locator("#access")).toBeFocused();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(listingUrl);
  await page.goForward();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole("heading", { name: resourceName, exact: true })).toBeVisible();
});

test("unselected Enter keeps resource-only matches and still searches records for AC-2", async ({ page }) => {
  await open(page, "/#/library");
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search Control Atlas", exact: true });
  await search.fill("eMASS");
  await expect(page.locator(".search-overlay").getByRole("link", { name: resourceName, exact: true })).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/resources\?q=eMASS(?:&|$)/);
  await expect(page.locator("#workspace").getByRole("link", { name: new RegExp(resourceName) })).toBeVisible();
  await expect(page.locator(".search-overlay")).toHaveCount(0);

  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await search.fill("unfinished");
  await search.press("Escape");
  await expect(page.getByRole("button", { name: "Open search", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await expect(search).toHaveValue("");
  await search.fill("AC-2");
  await expect(page.locator(".search-overlay-result").filter({ hasText: "AC-2" }).first()).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/library\?q=AC-2(?:&|$)/);
});

test("resource-only Enter resets a filtered Resources destination", async ({ page }) => {
  await open(page, "/#/resources?resourceType=specification&collection=dod-cybersecurity-portals&owner=NIST%20OSCAL%20Team&showAll=true");
  const filteredUrl = page.url();
  await expect(page).toHaveURL(/resourceType=specification/);
  await expect(page).toHaveURL(/collection=dod-cybersecurity-portals/);
  await expect(page).toHaveURL(/owner=NIST/);
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search Control Atlas", exact: true });
  // The Resources route loads only its own index. Establish that the overlay's
  // separate records index is ready before testing its no-records branch.
  await search.fill("AC-2");
  await expect(page.locator(".search-overlay-result").filter({ hasText: "AC-2" }).first()).toBeVisible();
  await search.fill("eMASS");
  await expect(page.locator(".search-overlay").getByRole("link", { name: resourceName, exact: true })).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/resources\?q=eMASS&showAll=true$/);
  await expect(page.locator("#workspace").getByRole("link", { name: new RegExp(resourceName) })).toBeVisible();
  await expect(page.locator(".workspace-clear-filters")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
});

test("an empty Library result offers a query-preserving Resources handoff", async ({ page }) => {
  await open(page, "/#/library?q=eMASS");
  const empty = page.locator("#workspace .empty-state");
  await expect(empty.getByRole("heading", { name: "No records found.", exact: true })).toBeVisible();
  await empty.getByRole("link", { name: "Search Resources for “eMASS”", exact: true }).click();
  await expect(page).toHaveURL(/#\/resources\?q=eMASS(?:&|$)/);
  await expect(page.locator("#workspace").getByRole("link", { name: new RegExp(resourceName) })).toBeVisible();
});

test("global search exposes both destinations and preserves explicit resource selection", async ({ page }) => {
  await open(page, "/#/library");
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search Control Atlas", exact: true });
  await search.fill("eMASS");
  const overlay = page.locator(".search-overlay");
  await expect(overlay.getByRole("link", { name: "Search Library records", exact: true })).toHaveAttribute("href", /#\/library\?q=eMASS/);
  await expect(overlay.getByRole("link", { name: "Search Resources", exact: true })).toHaveAttribute("href", /#\/resources\?q=eMASS/);
  const result = overlay.getByRole("link", { name: resourceName, exact: true });
  await result.focus();
  await result.press("Enter");
  await expect(page).toHaveURL(resourceRoute);
  await expect(page.getByRole("heading", { name: resourceName, exact: true })).toBeVisible();
});

for (const width of [390, 1165]) {
  test(`analytics settings stays reachable without covering map controls at ${width}px`, async ({ page, context, baseURL }) => {
    // Model the allowed HTTPS origin using only the current local candidate.
    // The production host restriction stays intact; no request reaches it.
    const origin = "https://atlas.rambulls.dev";
    const externalRequests = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin || !["GET", "HEAD"].includes(request.method())) {
        externalRequests.push(request.url());
        return route.abort();
      }
      const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}`, maxRedirects: 0 });
      return route.fulfill({ response });
    });
    await page.setViewportSize({ width, height: 749 });
    await open(page, `${origin}/#/atlas`);
    const settings = page.getByRole("button", { name: "Analytics settings", exact: true });
    await expect(settings).toBeVisible();
    const layout = await settings.evaluate((button) => ({
      position: getComputedStyle(button).position,
      top: button.getBoundingClientRect().top,
      footerBottom: document.querySelector(".site-footer").getBoundingClientRect().bottom,
    }));
    expect(layout.position).toBe("static");
    expect(layout.top).toBeGreaterThanOrEqual(layout.footerBottom);
    await expect(page.locator("#rb-cf-beacon")).toHaveCount(0);
    const otherPublications = page.getByRole("button", { name: width === 390 ? /^Other ·/ : /^Other publications/ });
    await otherPublications.click();
    await expect(page.locator(".atl-pop--other")).toBeVisible();
    await settings.focus();
    await settings.press("Enter");
    const panel = page.getByRole("dialog", { name: "Analytics settings", exact: true });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Analytics is currently declined.");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(settings).toBeFocused();
    await expect(page.locator("#rb-cf-beacon")).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });
}
