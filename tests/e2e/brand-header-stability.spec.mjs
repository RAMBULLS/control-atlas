import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from './support.mjs';

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

for (const width of [390, 1440]) {
  test(`brand home link keeps decoration separate from its accessible name at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, '/library');
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const home = page.getByRole('link', { name: 'Control Atlas — home', exact: true });
    await expect(home).toHaveText('Control Atlas');
    await expect(home.locator('.brand-kbd')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('.brand').withRules(['label-content-name-mismatch']).analyze()).violations).toEqual([]);
    await home.focus();
    await expect(home).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/$/);
    await gotoApp(page, '/library');
    await waitForAppReady(page);
    // The stretched link retains the existing full masthead click target.
    await page.locator('.brand').click({ position: { x: 5, y: 5 } });
    await expect(page).toHaveURL(/#\/$/);
  });
}

test('every rotating brand word renders without clipping', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, '/#/library');
  await waitForAppReady(page, { allowPartial: true });

  const word = page.locator('header.site-header .brand-key-word');
  await expect(word).toHaveCount(1);

  // Generated signals have different widths. Sample the rotation and require
  // every word to fit its reserved box.
  const seen = new Set();
  for (let tick = 0; tick < 24 && seen.size < 4; tick += 1) {
    const measured = await word.evaluate((element) => ({
      text: element.textContent || '',
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      parentScroll: element.parentElement?.scrollWidth ?? 0,
      parentClient: element.parentElement?.clientWidth ?? 0,
    }));
    seen.add(measured.text);
    expect(
      measured.scrollWidth,
      `brand word "${measured.text}" is clipped inside its own box`,
    ).toBeLessThanOrEqual(measured.clientWidth + 1);
    expect(
      measured.parentScroll,
      `brand word "${measured.text}" overflows the keycap`,
    ).toBeLessThanOrEqual(measured.parentClient + 1);
    await page.waitForTimeout(400);
  }
  expect(seen.size, 'brand rotation should surface several words').toBeGreaterThan(1);
});

test('header height, brand width, and primary navigation positions remain stable across brand rotations', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, '/');
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const header = page.locator('.site-header');
  const brand = page.locator('.brand');
  const activeKey = page.locator('.brand-key--active');
  const navLinks = page.locator('.primary-nav a');

  await expect(header).toBeVisible();
  await expect(brand).toBeVisible();
  await expect(activeKey).toBeVisible();

  const navLinkCount = await navLinks.count();
  expect(navLinkCount).toBeGreaterThan(0);

  // Sample the geometry of the header, brand, active keycap, and navigation links
  // across multiple rotations to verify zero layout jitter.
  const sampleCount = 20;
  const headerHeights = [];
  const brandWidths = [];
  const activeKeyWidths = [];
  const navPositions = [];
  const wordsSeen = new Set();

  for (let i = 0; i < sampleCount; i++) {
    const wordText = (await activeKey.locator('.brand-key-word').textContent())?.trim() || '';
    wordsSeen.add(wordText);

    const headerBox = await header.boundingBox();
    const brandBox = await brand.boundingBox();
    const activeKeyBox = await activeKey.boundingBox();

    if (headerBox) headerHeights.push(headerBox.height);
    if (brandBox) brandWidths.push(brandBox.width);
    if (activeKeyBox) activeKeyWidths.push(activeKeyBox.width);

    const currentNavX = [];
    for (let j = 0; j < navLinkCount; j++) {
      const box = await navLinks.nth(j).boundingBox();
      if (box) currentNavX.push(box.x);
    }
    navPositions.push(currentNavX);

    // Sample across ticks
    await page.waitForTimeout(600);
  }

  // Verify header height stability
  const minHeaderHeight = Math.min(...headerHeights);
  const maxHeaderHeight = Math.max(...headerHeights);
  expect(
    maxHeaderHeight - minHeaderHeight,
    `Header height must remain constant (min: ${minHeaderHeight}, max: ${maxHeaderHeight})`,
  ).toBeLessThanOrEqual(0.5);

  // Verify brand lockup width stability
  const minBrandWidth = Math.min(...brandWidths);
  const maxBrandWidth = Math.max(...brandWidths);
  expect(
    maxBrandWidth - minBrandWidth,
    `Brand width must remain constant across words (min: ${minBrandWidth}, max: ${maxBrandWidth})`,
  ).toBeLessThanOrEqual(0.5);

  // Verify active keycap width stability
  const minKeyWidth = Math.min(...activeKeyWidths);
  const maxKeyWidth = Math.max(...activeKeyWidths);
  expect(
    maxKeyWidth - minKeyWidth,
    `Active keycap width must remain reserved and constant (min: ${minKeyWidth}, max: ${maxKeyWidth})`,
  ).toBeLessThanOrEqual(0.5);

  // Verify navigation link X positions are stable
  for (let j = 0; j < navLinkCount; j++) {
    const xCoords = navPositions.map((pos) => pos[j]).filter((x) => x !== undefined);
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    expect(
      maxX - minX,
      `Nav link ${j} X coordinate must remain constant without horizontal jitter (min: ${minX}, max: ${maxX})`,
    ).toBeLessThanOrEqual(0.5);
  }
});

test('prefers-reduced-motion halts brand flourish rotation and avoids animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, '/');
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const activeKey = page.locator('.brand-key--active .brand-key-word');
  await expect(activeKey).toBeVisible();
  const initialWord = (await activeKey.textContent())?.trim();
  expect(initialWord).toBeTruthy();

  // Wait 3 seconds and ensure word does not change under reduced motion
  await page.waitForTimeout(3000);
  const currentWord = (await activeKey.textContent())?.trim();
  expect(currentWord).toBe(initialWord);
});

test('mobile routes keep the centered brand signal visible and rotating', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoApp(page, '/#/library');
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);

  const flourish = page.locator('header.site-header .brand-kbd');
  const activeKey = flourish.locator('.brand-key--active');
  const activeWord = activeKey.locator('.brand-key-word');
  await expect(flourish).toBeVisible();
  await expect(activeWord).toBeVisible();

  const firstWord = (await activeWord.textContent())?.trim();
  expect(firstWord).toBeTruthy();
  await expect.poll(async () => (await activeWord.textContent())?.trim(), {
    timeout: 15_000,
  }).not.toBe(firstWord);

  const centerDelta = await activeWord.evaluate((word) => {
    const wordBox = word.getBoundingClientRect();
    const keyBox = word.parentElement.getBoundingClientRect();
    return (wordBox.left + wordBox.width / 2) - (keyBox.left + keyBox.width / 2);
  });
  expect(Math.abs(centerDelta)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('mobile navigation sheet manages focus, Escape key, and toggle button return', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoApp(page, '/');
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const toggle = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Open mobile menu
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeVisible();
  const sheet = page.locator('.mobile-nav-sheet');
  await expect(sheet).toBeVisible();

  // Verify first link receives focus
  const firstLink = sheet.locator('nav a[href]').first();
  await expect(firstLink).toBeFocused();

  // Press Escape to close
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  const closedToggle = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(closedToggle).toBeVisible();
  await expect(closedToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(closedToggle).toBeFocused();
});

test('desktop overflow menu manages focus, Escape key, and toggle button return', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, '/');
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const overflowToggle = page.getByRole('button', { name: 'Open more pages' });
  await expect(overflowToggle).toBeVisible();
  await expect(overflowToggle).toHaveAttribute('aria-expanded', 'false');

  // Open overflow menu
  await overflowToggle.click();
  await expect(page.getByRole('button', { name: 'Close more pages' })).toBeVisible();
  const menu = page.locator('.overflow-nav-menu');
  await expect(menu).toBeVisible();

  // Verify first link in menu receives focus
  const firstLink = menu.locator('nav a[href]').first();
  await expect(firstLink).toBeFocused();

  // Press Escape to close
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  const closedToggle = page.getByRole('button', { name: 'Open more pages' });
  await expect(closedToggle).toBeVisible();
  await expect(closedToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(closedToggle).toBeFocused();
});
