import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { assertSearchInventory } from '../../tools/lib/assurance-inventory.mjs';
import { dismissOnboarding, gotoApp, waitForAppReady } from './support.mjs';

const benchmark = JSON.parse(readFileSync('tests/benchmarks/search-quality.json', 'utf8'));
assertSearchInventory(benchmark);
if (benchmark.queries.some(fixture => fixture.top_k > 25)) {
  throw new Error('Rendered recall fixtures exceed the initial 25-row page; add reviewed pagination coverage.');
}

// Exercise the real rendered Library and served index. Keep the complete
// reviewed expected set and original top-k; do not replace this with any-hit recall.
for (const fixture of benchmark.queries) {
  test(`assurance search: ${fixture.id} rendered complete top-k`, async ({ page }) => {
    await gotoApp(page, `/#/library?q=${encodeURIComponent(fixture.query)}`);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const rows = page.locator('#library-results .workspace-result-row');
    if (fixture.expect_no_results) {
      await expect(page.getByRole('heading', { name: 'No records found.', exact: true })).toBeVisible();
      await expect(rows).toHaveCount(0);
      return;
    }
    await expect(rows.first()).toBeVisible();
    const ids = await rows.evaluateAll(items => items.map(item => item.getAttribute('data-record-id')));
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size, 'rendered identities must be unique').toBe(ids.length);
    const top = ids.slice(0, fixture.top_k);
    expect(fixture.expected_ids.filter(id => !top.includes(id)), `${fixture.id}: actual top-k ${JSON.stringify(top)}`).toEqual([]);
    for (const id of fixture.expected_ids) {
      const [catalog, item] = id.split(':');
      const row = page.locator(`#library-results [data-record-id=${JSON.stringify(id)}]`);
      await expect(row.locator('a[href^="#/record/"]').first()).toHaveAttribute('href', `#/record/${encodeURIComponent(catalog)}/${encodeURIComponent(item)}`);
    }
  });
}

for (const stage of ['manifest', 'shard']) {
  test(`assurance search: failed Library index ${stage} reports unavailable and recovers on retry`, async ({ page }) => {
    let fail = true;
    let blocked = 0;
    const index = stage === 'manifest'
      ? /\/data\/generated\/library-search-index\.json(?:\.gz)?(?:\?|$)/
      : /\/data\/generated\/library-search-index\/[^/?]+\.json(?:\.gz)?(?:\?|$)/;
    await page.route(index, async route => {
      if (fail) {
        blocked += 1;
        await route.abort('failed');
      } else await route.continue();
    });
    await gotoApp(page, '/#/library?q=AC-2');
    const retry = page.getByRole('button', { name: 'Try loading again', exact: true });
    await expect(retry).toBeVisible();
    expect(blocked).toBeGreaterThan(0);
    await expect(page.locator('#library-results .workspace-result-row')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No records found.', exact: true })).toHaveCount(0);
    fail = false;
    await retry.click();
    await waitForAppReady(page);
    await dismissOnboarding(page);
    await expect(page.locator('#library-results .workspace-result-row').first()).toHaveAttribute('data-record-id', 'nist-800-53:AC-2');
    await expect(retry).toHaveCount(0);
  });
}
