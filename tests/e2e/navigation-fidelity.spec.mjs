import { expect, test } from '@playwright/test';
import {
  attachPageDiagnostics,
  dismissOnboarding,
  gotoApp,
  waitForAppReady,
} from './support.mjs';

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
});

test('canonical routes set human-readable document titles', async ({ page }) => {
  /** @type {Array<[string, RegExp]>} */
  const cases = [
    ['/#/', /Control Atlas/],
    ['/#/atlas', /^Atlas.*Control Atlas$/],
    ['/#/library?q=AC-2', /^AC-2.*Library.*Control Atlas$/],
    ['/#/build', /^Templates.*Control Atlas$/],
    ['/#/resources', /^Resources.*Control Atlas$/],
    ['/#/compare', /^Compare.*Control Atlas$/],
    ['/#/about', /^About.*Control Atlas$/],
    ['/#/total-nonsense-xyz', /^Page not found.*Control Atlas$/],
  ];
  for (const [route, titlePattern] of cases) {
    await gotoApp(page, route);
    await expect(page).toHaveTitle(titlePattern, { timeout: 15000 });
  }
});

test('detail titles resolve official entity names instead of IDs', async ({ page }) => {
  await gotoApp(page, '/#/record/nist-800-53/AC-2');
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page).toHaveTitle(/^NIST AC-2.*Account Management.*Control Atlas$/, { timeout: 20000 });

  await gotoApp(page, '/#/resources/official-nist-oscal');
  await waitForAppReady(page);
  await expect(page).toHaveTitle(/NIST.*Control Atlas$/, { timeout: 20000 });
});

test('generated record routes keep stable history while browser titles distinguish record type', async ({ page }) => {
  test.setTimeout(120_000);
  const collaboratorRoute = '/#/record/nist-zt/COLLABORATOR-APPGATE-835EC7F121';
  const mappingRoute = '/#/record/nist-zt/MAPPING-CONTRIBUTOR-APPGATE-835EC7F121';

  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
    await gotoApp(page, collaboratorRoute);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page).toHaveTitle(
      'Appgate — Technology collaborator · NIST Zero Trust — Control Atlas',
    );
    await expect(page).toHaveURL(/COLLABORATOR-APPGATE-835EC7F121$/);

    await gotoApp(page, mappingRoute);
    await waitForAppReady(page);
    await expect(page).toHaveTitle(
      'Appgate — Mapping workbook contributor · NIST Zero Trust — Control Atlas',
    );
  }

  await page.goBack();
  await expect(page).toHaveURL(/COLLABORATOR-APPGATE-835EC7F121$/);
  await expect(page).toHaveTitle(
    'Appgate — Technology collaborator · NIST Zero Trust — Control Atlas',
  );
  await page.goForward();
  await expect(page).toHaveURL(/MAPPING-CONTRIBUTOR-APPGATE-835EC7F121$/);
});

test('legacy public aliases canonicalize while retired structural aliases remain not found', async ({ page }) => {
  await gotoApp(page, '/#/atlas-map?node=nist-800-53%3AAC-2&relationshipView=map');
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page).toHaveURL(/#\/atlas-map/);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

  await gotoApp(page, '/#/library?q=AC-2&kind=controls-requirements');
  await expect(page).toHaveURL(/#\/library\?q=AC-2&kind=controls-requirements/);
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await expect(page.locator('#library-results')).toContainText('AC-2');

  await gotoApp(page, '/#/commons-detail?id=official-nist-oscal');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('invalid link settings are discarded with visible recovery', async ({ page }) => {
  await gotoApp(page, '/#/explore?relationshipView=unsupported&sourceView=unknown&bogus=value');
  await expect(page).toHaveURL(/#\/atlas$/);
  await expect(page.locator('.route-recovery')).toContainText('unsupported link settings');
});

test('path-style legacy link remains on the static not-found page', async ({ page }) => {
  await page.goto('/explore?q=AC-2');
  await expect(page).toHaveTitle('Page not found | Control Atlas');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'the Control Atlas home page' })).toBeVisible();
});

test('header search submits to canonical Library and carries focus to results', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, '/#/library');
  await waitForAppReady(page);
  await dismissOnboarding(page);

  await page.getByRole('button', { name: 'Open search' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search Control Atlas' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('searchbox', { name: 'Search Control Atlas' });
  await input.fill('account management');
  await input.press('Enter');

  await expect(page).toHaveURL(/#\/library\?.*q=account/);
  await waitForAppReady(page);
  await dismissOnboarding(page);
  await expect(page.locator('#library-results')).toBeFocused({ timeout: 15000 });
});

test('full-page search fields wait for explicit submission', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });

  await gotoApp(page, '/#/library?q=AC-2');
  await waitForAppReady(page);
  await dismissOnboarding(page);
  const librarySearch = page.getByRole('searchbox', {
    name: 'Filter results by ID, title, or topic',
  });
  await librarySearch.fill('account management');
  await expect(page).toHaveURL(/#\/library\?q=AC-2/);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/#\/library\?q=account\+management/);

  await gotoApp(page, '/#/resources?q=OSCAL');
  await waitForAppReady(page);
  const resourceSearch = page.getByRole('searchbox', { name: 'Find resources' });
  await resourceSearch.fill('Iron Bank');
  await expect(resourceSearch).toHaveValue('Iron Bank');
  await expect(page).toHaveURL(/#\/resources\?q=OSCAL/);
  await resourceSearch.press('Enter');
  await expect(page).toHaveURL(/#\/resources\?q=Iron\+Bank/);

  await gotoApp(page, '/#/sources?q=NIST');
  await waitForAppReady(page);
  const sourceSearch = page.getByRole('searchbox', { name: 'Search publications' });
  await sourceSearch.fill('FedRAMP');
  await expect(page).toHaveURL(/#\/sources\?q=NIST/);
  await sourceSearch.press('Enter');
  await expect(page).toHaveURL(/#\/sources\?q=FedRAMP/);

  await gotoApp(page, '/#/library/publication/nist-800-53?q=AC-2');
  await waitForAppReady(page);
  const catalogSearch = page.getByRole('searchbox', { name: 'Search NIST SP 800-53 Rev. 5' });
  await catalogSearch.fill('');
  await catalogSearch.pressSequentially('AC-3');
  await expect(catalogSearch).toHaveValue('AC-3');
  await expect(page).toHaveURL(/q=AC-2/);
  await catalogSearch.press('Enter');
  await expect(page).toHaveURL(/q=AC-3/);
});

test('route transition releases after destination commit while data continues loading', async ({ page }) => {
  test.setTimeout(30000);
  await page.route('**/data/generated/catalog-bootstrap.json.gz*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.continue();
  });

  await gotoApp(page, '/');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/#\/library/);
  await expect(page.locator('[data-route-transition][role="status"]')).toBeHidden({ timeout: 2000 });
  await waitForAppReady(page);
});

test('Atlas landing renders the territory sheet from its own small index, not the relationship graph bundle', async ({ page }) => {
  test.setTimeout(90000);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await gotoApp(page, '/#/atlas');
  await waitForAppReady(page);
  await dismissOnboarding(page);

  const sheet = page.locator('.terr');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.district')).toHaveCount(9);
  await expect(sheet.locator('.lm')).toHaveCount(28);
  // Orientation is SVG and DOM only: no canvas renderer and no flow graph is loaded
  // before the visitor asks for one.
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('.react-flow')).toHaveCount(0);
  expect(requests.some((url) => /RelationshipGraph-|atlas-network|atlas-spine|atlas-research\//.test(url))).toBe(false);
});