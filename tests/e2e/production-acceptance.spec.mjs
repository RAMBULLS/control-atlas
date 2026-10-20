import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { csvRows } from '../../scripts/lib/publisher-inventory.mjs';
import { appUrl, dismissOnboarding, gotoApp, waitForAppReady } from './support.mjs';

async function open(page, route) {
  await gotoApp(page, route);
  await waitForAppReady(page);
  await dismissOnboarding(page);
}

async function monitorRecordErrors(page) {
  await page.evaluate(() => {
    globalThis.__acceptanceRecordErrors = [];
    const check = () => {
      for (const heading of globalThis.document.querySelectorAll('#workspace h1, [data-record-source-error] h2')) {
        if (heading.getClientRects().length && /^(Record not found|Unable to load published text)$/.test(heading.textContent.trim())) {
          globalThis.__acceptanceRecordErrors.push(heading.textContent.trim());
        }
      }
      if (/^Record not found/.test(globalThis.document.title)) globalThis.__acceptanceRecordErrors.push(globalThis.document.title);
    };
    new globalThis.MutationObserver(check).observe(globalThis.document.documentElement, { subtree: true, childList: true, characterData: true });
  });
}

test('production acceptance: release identity matches the deployed candidate', async ({ request }) => {
  test.skip(!process.env.EXPECTED_DEPLOY_SHA, 'Exact release identity is required by the deployed acceptance job.');
  const response = await request.get(appUrl('/release.json'));
  expect(response.ok()).toBe(true);
  expect((await response.json()).commit_sha).toBe(process.env.EXPECTED_DEPLOY_SHA);
});

test('production acceptance: RMF reaches controls, assessment and a useful workbook without false errors', async ({ page }) => {
  await open(page, '/#/library?q=RMF');
  await monitorRecordErrors(page);
  await page.getByRole('link', { name: 'Open Select, RMF step, SP 800-37 Rev. 2', exact: true }).click();
  await page.getByRole('link', { name: 'View in Atlas', exact: true }).click();
  await page.getByRole('link', { name: 'Full connection list', exact: true }).click();
  await page.getByRole('link', { name: 'MODERATE — Moderate Impact Baseline', exact: true }).click();
  await page.getByRole('link', { name: 'AC-2 — Account Management', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Control Statement', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'AC-2 — Account Management Assessment Procedure', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Objectives', exact: true })).toBeVisible();
  await expect(page.locator('#workspace')).toContainText('EXAMINE');
  expect(await page.evaluate(() => globalThis.__acceptanceRecordErrors)).toEqual([]);
  await gotoApp(page, '/#/build/documents/evidence_expectation_matrix?framework=nist-800-53&baseline=MODERATE&format=xlsx');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Evidence Expectation Matrix (Excel)', exact: true }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/evidence-expectation-matrix.*\.xlsx$/);
  const bytes = await readFile(await download.path());
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(bytes.length).toBeGreaterThan(10000);
});

test('production acceptance: STIG benchmark reaches finding, CCI and current Viewer guidance', async ({ page }) => {
  await open(page, '/#/library?q=Windows+11');
  await monitorRecordErrors(page);
  await page.getByRole('link', { name: 'Open DISA Microsoft Windows 11 V-253255', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fix', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View publication', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Microsoft_Windows_11_STIG — Microsoft Windows 11 Security Technical Implementation Guide', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Benchmark Summary', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /^V-253255 —/ }).click();
  await page.getByRole('link', { name: 'CCI-002421', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Requirement', exact: true })).toBeVisible();
  await expect(page.locator('#workspace')).toContainText('SC-8 (1)');
  expect(await page.evaluate(() => globalThis.__acceptanceRecordErrors)).toEqual([]);
  await gotoApp(page, '/#/resources/tool-disa-stig-viewer');
  await expect(page.locator('main')).toContainText('.cklb');
  await expect(page.locator('main')).not.toContainText('Java GUI');
  await expect(page.getByRole('link', { name: 'Open resource', exact: true })).toHaveAttribute('href', 'https://www.cyber.mil/stigs/srg-stig-tools/');
});

test('production acceptance: Zero Trust reaches a concrete NIST implementation', async ({ page }) => {
  await open(page, '/#/record/nist-zt/SP180035-E3B1');
  await expect(page.getByRole('heading', { name: 'Architecture', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Implementation Guide', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View official source', exact: true })).toHaveAttribute('href', /nist\.gov/);
});

test('production acceptance: CUI requirements connect to controls and remediation guidance', async ({ page }) => {
  await open(page, '/#/compare/relationships?source=nist-800-171&target=nist-800-53&intent=frameworks&compareRun=true');
  await expect(page.getByRole('table', { name: 'Published crosswalk mappings' })).toBeVisible();
  await page.getByRole('link', { name: '3.1.1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Requirement', exact: true })).toBeVisible();
  await gotoApp(page, '/#/build/tasks/create-update-poam');
  await expect(page.getByRole('heading', { name: 'Plan measurable remediation', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('closure evidence');
});

test('production acceptance: current FedRAMP mappings export with source evidence', async ({ page }) => {
  await open(page, '/#/library/publication/fedramp-2026');
  await page.getByRole('link', { name: 'Compare with SP 800-53 Rev. 5', exact: true }).click();
  const region = page.getByRole('region', { name: 'FedRAMP Consolidated Rules for 2026 SP 800-53 Rev. 5', exact: true });
  const status = region.getByRole('status');
  await expect(status).toHaveText(/^[\d,]+ published mappings/);
  const count = Number((await status.innerText()).match(/^([\d,]+)/)[1].replaceAll(',', ''));
  expect(count).toBeGreaterThan(0);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const download = await event;
  expect(await download.failure()).toBeNull();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(await download.path()));
  const rows = csvRows(text);
  expect(rows[0]).toContain('Evidence / Locator');
  expect(rows[0]).toContain('Published Source ID');
  expect(rows).toHaveLength(count + 1);
  for (const row of rows) expect(row).toHaveLength(rows[0].length);
});

test('production acceptance: ATT&CK connects to a published defensive countermeasure', async ({ page }) => {
  await open(page, '/#/record/mitre-attack/T1001');
  await page.getByText(/^MITRE D3FEND · \d+$/, { exact: true }).click();
  await page.getByRole('link', { name: 'D3-APCA — D3-APCA Application Protocol Command Analysis', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Countermeasure Description', exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Analyzing application protocol level remote commands');
});

for (const query of ['AC-2', 'SP 800-37', 'POA&M', 'Windows 11', 'manage user accounts', 'zzqx287noresult']) {
  test(`production acceptance: global and Library search for ${query}`, async ({ page }) => {
    await open(page, '/#/library');
    await page.getByRole('button', { name: 'Open search', exact: true }).click();
    const input = page.getByRole('dialog', { name: 'Search Control Atlas' }).getByRole('searchbox');
    await input.fill(query);
    const first = page.locator('.search-overlay-result[href^="#/record/"]').first();
    let href = null;
    if (!['POA&M', 'zzqx287noresult'].includes(query)) {
      await expect(first).toBeVisible();
      href = await first.getAttribute('href');
    }
    await input.press('Enter');
    await waitForAppReady(page);
    if (href) {
      await expect(page.locator('#library-results .workspace-result-row a[href^="#/record/"]').first()).toHaveAttribute('href', href);
    } else {
      await expect(page.getByRole('heading', { name: 'No records found.', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Clear Library search', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Browse the Library', exact: true })).toBeVisible();
    }
  });
}

for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`production acceptance: useful layout families at ${width}px`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      '/#/', '/#/atlas', '/#/library?q=Windows+11', '/#/record/nist-800-53/AC-2',
      '/#/compare', '/#/build', '/#/resources', '/#/guides', '/#/sources', '/#/about',
    ]) {
      await test.step(route, async () => {
        await open(page, route);
        expect(await page.evaluate(() => globalThis.innerWidth)).toBe(width);
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toHaveCount(1);
        await expect(heading).toBeVisible();
        expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      });
    }
  });
}
