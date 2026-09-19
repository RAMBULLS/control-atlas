import { expect, test } from "@playwright/test";

import { attachPageDiagnostics, gotoApp, waitForAppReady } from "./support.mjs";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("WS1 Home discovery cards lead with the question, not the record count", async ({ page }) => {
  await gotoApp(page, "/#/");
  await waitForAppReady(page, { allowPartial: true });

  const discoveryLinks = page.locator(".home-library-kpis .home-library-kpi");
  await expect(discoveryLinks).toHaveCount(5);
  await expect(page.locator(".home-ecosystem-authorities, .home-ecosystem")).toHaveCount(0);

  const metrics = await discoveryLinks.evaluateAll((links) => links.map((link) => {
    return {
      href: link.getAttribute("href") || "",
      question: link.querySelector(".home-library-kpi__question")?.textContent?.trim() || "",
      label: link.querySelector(".home-library-kpi__label")?.textContent?.trim() || "",
      count: link.querySelector(".home-library-kpi__count")?.textContent?.trim() || "",
    };
  }));

  expect(metrics.every((entry) => /^\d[\d,]* records$/.test(entry.count))).toBe(true);
  expect(metrics.every((entry) => entry.question.length > 0)).toBe(true);
  expect(metrics.every((entry) => entry.href.startsWith("#/library?kind=") && entry.label.length > 0)).toBe(true);

  // The collection name must outrank the count in the visual hierarchy.
  const sizes = await discoveryLinks.first().evaluate((link) => {
    const read = (selector) => Number.parseFloat(
      globalThis.getComputedStyle(link.querySelector(selector)).fontSize,
    );
    return { label: read(".home-library-kpi__label"), count: read(".home-library-kpi__count") };
  });
  expect(sizes.label).toBeGreaterThan(sizes.count);
});

test("WS1 decorative surfaces resolve to one teal accent", async ({ page }) => {
  await gotoApp(page, "/#/");
  await waitForAppReady(page, { allowPartial: true });

  const aliases = await page.evaluate(() => {
    const style = globalThis.getComputedStyle(globalThis.document.documentElement);
    return [
      "--ca-accent",
      "--ca-primary",
      "--ca-secondary",
      "--ca-link",
      "--ca-priority",
      "--ca-info",
    ].map((token) => style.getPropertyValue(token).trim());
  });
  expect(new Set(aliases).size).toBe(1);

  const editorial = await page.evaluate(() =>
    globalThis.getComputedStyle(globalThis.document.documentElement).getPropertyValue("--ca-editorial").trim(),
  );
  expect(editorial).not.toBe(aliases[0]);

  const cardAccentColors = await page.locator(".home-secondary-action").evaluateAll(
    (cards) => cards.map((card) => globalThis.getComputedStyle(card, "::before").backgroundColor),
  );
  expect(cardAccentColors.length).toBeGreaterThan(0);
  expect(new Set(cardAccentColors).size).toBe(1);
});

test("WS1 Atlas names every publication with its publisher and counts its authorities", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page, "/#/atlas");
  await waitForAppReady(page, { allowPartial: true });

  const map = page.locator(".terr");
  await expect(map).toBeVisible({ timeout: 60_000 });

  // Every publication is a landmark that states its name, publisher and territory
  // to assistive technology and never depends on hover.
  const labels = await map.locator(".lm").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") || ""));
  expect(labels).toHaveLength(28);
  for (const label of labels) expect(label).toMatch(/, .+, .+, .+ territory/);
  for (const publisher of ["NIST", "DISA", "MITRE", "FedRAMP"]) {
    expect(labels.some((label) => label.includes(`, ${publisher}`)) || labels.some((label) => label.includes(publisher)), `${publisher} landmark`).toBe(true);
  }

  // Authority documents are obligations, not publishers: counted, listed, never openable as a place.
  const authority = page.getByRole("button", { name: /^Authority · \d+$/ });
  await expect(authority).toBeVisible();
  await authority.click();
  const list = page.getByRole("region", { name: "Authority documents" });
  await expect(list).toContainText("no routes lead to them");
  await expect(list.locator("button")).toHaveCount(0);
});

test("WS1 no palette token lands in the purple range Orbital forbids", async ({ page }) => {
  await gotoApp(page, "/#/atlas");
  await waitForAppReady(page, { allowPartial: true });

  const offenders = await page.evaluate(() => {
    const style = globalThis.getComputedStyle(globalThis.document.documentElement);
    const hueOf = (value) => {
      const match = value.match(/#([0-9a-f]{6})/i);
      if (!match) return null;
      const hex = match[1];
      const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
      const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
      const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const delta = max - min;
      if (delta < 0.08) return null;
      let hue;
      if (max === red) hue = ((green - blue) / delta) % 6;
      else if (max === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue *= 60;
      return hue < 0 ? hue + 360 : hue;
    };
    const found = [];
    for (const sheet of Array.from(globalThis.document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules || [])) {
        const styleRule = /** @type {CSSStyleRule} */ (rule);
        if (!styleRule.style || styleRule.selectorText !== ":root") continue;
        for (const property of Array.from(styleRule.style)) {
          if (!property.startsWith("--")) continue;
          const hue = hueOf(style.getPropertyValue(property).trim());
          if (hue !== null && hue >= 255 && hue <= 330) {
            found.push(`${property}: ${style.getPropertyValue(property).trim()}`);
          }
        }
      }
    }
    return found;
  });

  expect(offenders, `purple tokens: ${offenders.join(", ")}`).toEqual([]);
});
