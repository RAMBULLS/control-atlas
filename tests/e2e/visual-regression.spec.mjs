import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { dismissOnboarding, waitForAppReady } from './support.mjs';

async function openStableWorkspace(page, route, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`/${route}`);
  await expect(page.locator('#workspace')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({
    content: `
      .brand-key-word { visibility: hidden !important; }
      *, *::before, *::after {
        animation-duration: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });
}

test('resource directory desktop composition', async ({ page }) => {
  await openStableWorkspace(page, '#/resources', { width: 1440, height: 1000 });
  await expect(page.getByRole('heading', { name: 'Browse by Collection' })).toBeVisible();
  await expect(page.locator('#workspace')).toHaveScreenshot('resources-desktop.png');
});

test('source register desktop composition', async ({ page }) => {
  await openStableWorkspace(page, '#/sources', { width: 1440, height: 1000 });
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await page.locator('.source-title-link').first().click();
  const register = page.locator('.sources-table-panel');
  const evidence = page.locator('.sources-inspector-pane');
  await expect(register).toBeVisible();
  await expect(evidence).toBeVisible();
  const [registerBox, evidenceBox, viewportMetrics] = await Promise.all([
    register.boundingBox(), evidence.boundingBox(),
    page.evaluate(() => ({ clientWidth: globalThis.document.documentElement.clientWidth, scrollWidth: globalThis.document.documentElement.scrollWidth })),
  ]);
  expect(registerBox, 'the publication register needs a measurable desktop region').not.toBeNull();
  expect(evidenceBox, 'the selected-publication evidence panel needs a measurable desktop region').not.toBeNull();
  expect(registerBox.width, 'the publication register should remain the primary reading surface').toBeGreaterThan(evidenceBox.width * 1.75);
  expect(evidenceBox.x - (registerBox.x + registerBox.width), 'the two reading surfaces need a visible gutter').toBeGreaterThanOrEqual(16);
  expect(evidenceBox.x + evidenceBox.width, 'the evidence panel must stay inside the viewport').toBeLessThanOrEqual(viewportMetrics.clientWidth);
  expect(viewportMetrics.scrollWidth, 'the desktop composition must not clip horizontally').toBe(viewportMetrics.clientWidth);
});

test('resource directory mobile composition', async ({ page }) => {
  await openStableWorkspace(page, '#/resources?showAll=true', { width: 390, height: 844 });
  await expect(page.locator('.workspace-result-list')).toBeVisible();
  await expect(page).toHaveScreenshot('resources-mobile.png', { fullPage: false });
});

// New record compositions have no approved committed pixel baseline yet.
// Save review-only evidence in a separate artifact subdirectory; never overwrite
// a committed baseline or call a captured image a visual acceptance result.
// The required issue-254 matrix checks real geometry, interactions and content.
async function captureReviewImage(subject, name) {
  const path = join(import.meta.dirname, 'visual-regression.spec.mjs-snapshots', 'review-only', name);
  await mkdir(dirname(path), { recursive: true });
  await subject.screenshot({ path, animations: 'disabled' });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

const records = [
  ['stig', '#/record/disa-stig/V-205646'],
  ['control', '#/record/nist-800-53/AC-2'],
  ['cci', '#/record/disa-cci/CCI-000366'],
  ['container', '#/record/nist-800-53/FAMILY-AC'],
  ['publication', '#/record/csf-2/CATALOG'],
  ['entity', '#/record/nist-zt/COLLABORATOR-APPGATE-835EC7F121'],
  ['assessment', '#/record/nist-800-53a/AC-1'],
  ['implementation', '#/record/nist-zt/SP180035-E1B1'],
];

for (const [name, route] of records) {
  for (const width of [375, 1440]) {
    test(`record visual review evidence: ${name} at ${width}`, async ({ page }) => {
      await openStableWorkspace(page, route, { width, height: width === 375 ? 844 : 1100 });
      await waitForAppReady(page, { allowPartial: true });
      await dismissOnboarding(page);
      await expect(page.locator('[data-template="E"]')).toBeVisible();
      await expect(page.locator('[data-record-source-error]')).toHaveCount(0);
      await captureReviewImage(page, `record-${name}-${width}.png`);
      if (name === 'stig') {
        const rail = page.locator('.record-template-sidebar');
        if (width === 375) {
          await expect(rail.locator('details[open]')).toHaveCount(0);
          await captureReviewImage(rail, 'record-stig-mobile-utilities.png');
          await rail.locator('[data-rail-section="about-this-record"] > summary').click();
          await captureReviewImage(rail, 'record-stig-mobile-utilities-expanded.png');
        } else {
          await captureReviewImage(rail, 'record-stig-desktop-utilities.png');
        }
      }
    });
  }
}

test('resource discovery tags share the compact record treatment', async ({ page }) => {
  await openStableWorkspace(page, '#/resources/tool-cisa-cset', { width: 375, height: 844 });
  await waitForAppReady(page, { allowPartial: true });
  await dismissOnboarding(page);
  await expect(page.locator('[data-discovery-tags]')).toHaveCount(1);
  await captureReviewImage(page.locator('.ca-record-tags'), 'resource-detail-mobile-tags.png');
});

for (const width of [375, 1440]) {
  test(`Atlas research review evidence at ${width}`, async ({ page }) => {
    await openStableWorkspace(page, '#/atlas?atlasResearch=path&atlasPins=%5B%22disa-stig%3AV-205646%22%2C%22nist-800-53%3AIA-5.2%22%5D&atlasFrom=disa-stig%3AV-205646&atlasTo=nist-800-53%3AIA-5.2&atlasHops=2', { width, height: width === 375 ? 844 : 1100 });
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page.getByRole('heading', { name: '2 steps from V-205646 to IA-5.2', exact: true })).toBeVisible({ timeout: 60000 });
    await captureReviewImage(page, `atlas-research-${width}.png`);
    await captureReviewImage(page.locator('.atlas-research__results'), `atlas-research-path-${width}.png`);
    await page.getByRole('button', { name: /^Step 2:/ }).click();
    await captureReviewImage(page.locator('.atlas-research__evidence'), `atlas-research-evidence-${width}.png`);
  });
}
