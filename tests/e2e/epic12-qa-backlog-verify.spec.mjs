import { expect, test } from '@playwright/test';
import { waitForAppReady } from './support.mjs';

// Regression guard for the epic-12 QA backlog fixes (2026-08-10):
// B1/B2 Template-C browse + map, B3 tools reachability, B5/B6 landing,
// B9/B10/B11 search polish, B13 no page overflow, B14 select label, B16 links.

test('B1: Library opens with a curated browse state instead of ranked rows', async ({ page }) => {
  await page.goto('/#/library');
  await expect(page.locator('[data-browse-state="library"]')).toBeVisible({ timeout: 15000 });
  expect(await page.locator('.workspace-browse-card').count()).toBeGreaterThan(0);
  expect(await page.locator('.workspace-area-card').count()).toBeGreaterThan(0);
  await expect(page.locator('.workspace-result-row')).toHaveCount(0);
  await expect(page.locator('.workspace-result-count')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toHaveCount(0);
});

test('B1: a query replaces browse cards with ranked rows', async ({ page }) => {
  await page.goto('/#/library?q=access+control');
  await expect(page.locator('#library-results .workspace-result-row').first()).toBeVisible({ timeout: 15000 });
  const narrowed = Number((await page.locator('.workspace-result-count').innerText()).replace(/[^0-9]/g, ''));
  expect(narrowed).toBeGreaterThan(0);
  await page.goto('/#/library');
  await expect(page.locator('[data-browse-state="library"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-result-count')).toHaveCount(0);
});

test('B2: the Map toggle renders nodes for a non-empty query', async ({ page }) => {
  await page.goto('/#/library?q=access&view=map');
  await expect(page.locator('.library-atlas-map')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.library-map-node').first()).toBeVisible({ timeout: 20000 });
  expect(await page.locator('.library-map-node').count()).toBeGreaterThan(0);
  expect(Number(await page.locator('.library-atlas-map').getAttribute('data-map-node-count'))).toBeGreaterThan(0);
});

test('B3: Tools & communities is reachable from home in <=2 clicks', async ({ page }) => {
  await page.goto('/#/');
  const direct = page.locator('.home-tool[href="#/resources"]');
  await expect(direct).toBeVisible();
  await direct.click();
  await expect(page).toHaveURL(/#\/resources/);
  await expect(page.locator('[data-browse-state="resources"], .workspace-result-row').first()).toBeVisible({ timeout: 15000 });
});

test('B4: the Atlas map is reachable from home in one click', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('a[href*="/atlas"]').first()).toBeVisible();
});

test('B5: the hero has no reserved-but-empty second column', async ({ page }) => {
  await page.goto('/#/');
  const hero = page.locator('.home-hero');
  await expect(hero).toBeVisible();
  const tracks = await hero.evaluate((el) => {
    const cols = globalThis.getComputedStyle(el).gridTemplateColumns.trim();
    return cols === 'none' ? [] : cols.split(/\s+/);
  });
  expect(tracks.length).toBeLessThanOrEqual(1);
  expect(await hero.evaluate((el) => el.children.length)).toBe(1);
});

test('B6: the Home tools band holds three equal columns', async ({ page }) => {
  await page.goto('/#/');
  const band = page.locator('.home-tools > ul');
  await expect(band).toBeVisible();
  const info = await band.evaluate((el) => {
    const cs = globalThis.getComputedStyle(el);
    const kids = /** @type {HTMLElement[]} */ ([...el.children]);
    return {
      display: cs.display,
      count: kids.length,
      widths: kids.map((kid) => kid.getBoundingClientRect().width),
    };
  });
  expect(info.display).toBe('grid');
  expect(info.count).toBe(3);
  expect(Math.max(...info.widths) - Math.min(...info.widths)).toBeLessThanOrEqual(2);
});

test('B9: overlay result descriptions clamp within their rows', async ({ page }) => {
  await page.goto('/#/about');
  await waitForAppReady(page, { allowPartial: true });
  await page.getByRole('button', { name: 'Open search' }).click();
  await expect(page.locator('.search-overlay')).toBeVisible({ timeout: 10000 });
  await page.locator('#global-search-query').fill('control');
  await expect(page.locator('.search-overlay-result').first()).toBeVisible({ timeout: 10000 });
  const overflow = await page.evaluate(() => {
    const rows = Array.from(globalThis.document.querySelectorAll('.search-overlay-result'));
    return rows.filter((r) => r.scrollHeight > r.clientHeight + 1).length;
  });
  expect(overflow).toBe(0);
});

test('B10: overlay header has one clear and one close affordance, distinct', async ({ page }) => {
  await page.goto('/#/about');
  await waitForAppReady(page, { allowPartial: true });
  await page.getByRole('button', { name: 'Open search' }).click();
  await expect(page.locator('.search-overlay')).toBeVisible({ timeout: 10000 });
  await page.locator('#global-search-query').fill('access');
  const header = page.locator('.search-overlay-header');
  await expect(header.getByLabel('Clear search')).toHaveCount(1);
  await expect(header.getByLabel('Close search')).toHaveCount(1);
  // The submit control must not be a second visible dismiss affordance.
  await expect(header.locator('button[type="submit"]')).toHaveClass(/visually-hidden/);
});

test('B11: the in-page Library search input sits symmetrically in its box', async ({ page }) => {
  await page.goto('/#/library?q=access');
  await page.locator('.workspace-search input').first().waitFor({ timeout: 15000 });
  const diff = await page.evaluate(() => {
    const box = globalThis.document.querySelector('.workspace-search > label');
    const input = box.querySelector('input');
    const b = box.getBoundingClientRect();
    const i = input.getBoundingClientRect();
    return Math.round((i.left - b.left) - (b.right - i.right));
  });
  expect(Math.abs(diff)).toBeLessThanOrEqual(2);
});

test('B13: the Atlas page does not overflow horizontally at the document level', async ({ page }) => {
  await page.goto('/#/atlas');
  await page.waitForTimeout(2500);
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: globalThis.document.documentElement.scrollWidth,
    clientW: globalThis.document.documentElement.clientWidth,
  }));
  expect(scrollW).toBeLessThanOrEqual(clientW + 2);
});

test('B14: every Library select exposes a non-empty accessible name', async ({ page }) => {
  await page.goto('/#/library?q=access');
  await expect(page.locator('#library-results .workspace-result-row').first()).toBeVisible({ timeout: 15000 });
  const unnamed = await page.evaluate(() => {
    const selects = Array.from(globalThis.document.querySelectorAll('select'));
    return selects.filter((s) => {
      const aria = (s.getAttribute('aria-label') || '').trim();
      const labelled = s.id && globalThis.document.querySelector(`label[for="${s.id}"]`);
      return !aria && !labelled;
    }).length;
  });
  expect(unnamed).toBe(0);
});

test('B16: Compare exposes only the two supported modes', async ({ page }) => {
  await page.goto('/#/compare');
  const modes = page.getByRole('tablist', { name: 'Comparison mode' });
  await expect(modes).toBeVisible({ timeout: 15000 });
  const choices = modes.getByRole('tab');
  await expect(choices).toHaveCount(2);
  await expect(choices).toHaveText(['Frameworks', 'Specific item']);
  await expect(choices.first()).toHaveAttribute('aria-selected', 'true');
});

test('route semantic polish holds at all required viewport widths', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    const { width } = viewport;
    await page.setViewportSize(viewport);

    await page.goto('/#/compare');
    const choices = page.getByRole('tablist', { name: 'Comparison mode' }).getByRole('tab');
    await expect(choices).toHaveCount(2);
    expect(await choices.first().evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.goto('/#/about');
    await expect(page.locator('main article.learn-article')).toHaveCount(1);
    await expect(page.locator('main article.learn-article h2')).toHaveCount(5);
    await expect(page.locator('footer')).toContainText('Product release');
    await expect(page.locator('footer')).toContainText('Source data built');
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width <= 390) {
      const footerOverflow = await page.locator('footer').evaluate((footer) => {
        const footerBox = footer.getBoundingClientRect();
        const required = [
          ...footer.querySelectorAll('.site-footer-release > *, a[href*="report-broken-link"]'),
        ];
        return required.some((element) => {
          const box = element.getBoundingClientRect();
          return box.left < footerBox.left - 1 || box.right > footerBox.right + 1;
        });
      });
      expect(footerOverflow).toBe(false);
      const links = page.locator('footer a');
      for (const link of await links.all()) {
        expect(await link.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
    }
    if (width >= 1024) {
      const paragraph = page.locator('.about-layout .learn-article p').first();
      expect(await paragraph.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(650);
    }
  }
});
