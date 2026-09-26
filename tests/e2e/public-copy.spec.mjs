import { expect, test } from "@playwright/test";

import { PROHIBITED_PRIMARY_SURFACE_PATTERNS } from "../../src/shared/site-copy.mjs";
import { UI_REVIEW_ROUTES } from "../../tools/ui-review-routes.mjs";
import { attachPageDiagnostics, dismissOnboarding, gotoApp, waitForAppReady } from "./support.mjs";

/* global document */

/**
 * The public-copy contract, checked against what a person actually reads.
 *
 * tests/copy-contract.test.mjs scans authored strings in source files. It
 * cannot see copy assembled at runtime from registry values, dates and counts
 * — which is exactly where the #283 Home narration and the #284 freshness
 * wording came from. This reads the rendered text of every route in the public
 * review set and applies the same phrase list.
 *
 * The one escape hatch is `data-technical-details`. A reader who opened a
 * technical-details disclosure asked for stable IDs, checksums and provenance
 * classes; those subtrees are removed before matching. Nothing else is exempt.
 */

const EXEMPT_SELECTOR = "[data-technical-details]";

/** Visible text of <main>, minus technical-details subtrees. */
async function publicText(page) {
  return page.evaluate((exemptSelector) => {
    const main = document.querySelector("main");
    if (!main) return "";
    const clone = /** @type {HTMLElement} */ (main.cloneNode(true));
    for (const node of [...clone.querySelectorAll(exemptSelector)]) node.remove();
    // A closed <details> still holds its text in the DOM, and it is one click
    // from public, so it stays in scope unless it is marked exempt.
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }, EXEMPT_SELECTOR);
}

for (const route of UI_REVIEW_ROUTES) {
  test(`public copy: ${route.id} speaks to the practitioner`, async ({ page }) => {
    attachPageDiagnostics(page);
    await gotoApp(page, route.path);
    await waitForAppReady(page);
    await dismissOnboarding(page);

    const text = await publicText(page);
    expect(text.length, `${route.id} rendered no main content`).toBeGreaterThan(40);

    const hits = [];
    for (const pattern of PROHIBITED_PRIMARY_SURFACE_PATTERNS) {
      const match = text.match(pattern);
      if (match) hits.push(`${pattern} matched "${match[0]}"`);
    }
    expect(hits, `${route.path}\n${hits.join("\n")}`).toEqual([]);
  });
}

test("the technical-details escape hatch exists and is the only one", async ({ page }) => {
  // If this stops finding a marked subtree, the exemption has been renamed or
  // dropped and the check above quietly got stricter or weaker without anyone
  // deciding to.
  await gotoApp(page, "/#/sources?source=disa-cci-list");
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const details = page.locator(`${EXEMPT_SELECTOR}`);
  await expect(details).toHaveCount(1);
  // And the exemption is not being used to hide ordinary content: it sits
  // inside a disclosure the reader opens on purpose.
  await expect(page.locator(`details:has(${EXEMPT_SELECTOR})`)).toHaveCount(1);
});
