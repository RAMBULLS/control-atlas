/* global document */
import { readFileSync } from 'node:fs';
import { assertRegistryInventory } from '../../tools/lib/assurance-inventory.mjs';
import { expect, test } from '@playwright/test';
import { practitionerGuides } from '../../src/app/learn-content.mjs';
import { dismissOnboarding, waitForAppReady } from './support.mjs';

assertRegistryInventory(JSON.parse(readFileSync('data/template-registry.json', 'utf8')).templates, practitionerGuides);

const widths = [320, 375, 390, 768, 1024, 1440];
// Registry-driven: a new guide cannot silently remain outside this suite.
for (const [index, guide] of practitionerGuides.entries()) {
  test(`assurance guides: ${guide.id} content, next action, Back and reload`, async ({ page }, info) => {
    info.annotations.push({ type: 'assurance', description: `guides:${guide.id}` });
    await page.setViewportSize({ width: widths[index % widths.length], height: 900 });
    const route = `/#/guides?pattern=${guide.id}`;
    await page.goto(route);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.title);
    for (const [selector, text] of [['#guide-goal', guide.goal], ['#guide-what-this-means', guide.explanation], ['#guide-output', guide.output]]) {
      await expect(page.locator(selector)).toContainText(text);
    }
    await expect(page.locator('.summary-card.tone-warning')).toContainText(guide.limitations);
    for (const step of guide.steps) await expect(page.locator('#guide-steps')).toContainText(step.action);
    for (const citation of guide.citations) await expect(page.locator('#guide-references').getByRole('link', { name: citation.label, exact: true })).toHaveAttribute('href', citation.url);
    // Enumerate the actual rendered internal next actions, including related tags.
    const actions = page.locator('.learn-article a[href^="#/"]');
    const destinations = await actions.evaluateAll(links => links.map(link => ({ href: link.getAttribute('href'), text: link.textContent })));
    expect(destinations.length).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: guide.nextAction.label, exact: true })).toBeVisible();
    for (const action of destinations) {
      const link = page.locator('.learn-article a').filter({ hasText: action.text }).first();
      await link.focus();
      await expect(link).toBeFocused();
      await link.press('Enter');
      await waitForAppReady(page);
      await expect.poll(() => new URL(page.url()).hash).toBe(action.href);
      await expect(page.getByText('Page not found', { exact: true })).toHaveCount(0);
      await page.goBack();
      await waitForAppReady(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.title);
    }
    await page.reload();
    await waitForAppReady(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
