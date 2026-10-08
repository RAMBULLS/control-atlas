import { expect } from '@playwright/test';

// Firefox DOMRects can report 44px as 43.999969482421875. Keep millipixel
// precision so floating-point noise passes while genuinely undersized targets fail.
export function roundCssPixels(value) {
  return Math.round(value * 1000) / 1000;
}

export async function clickAtlasPublication(page, publicationId) {
  // The SVG group also bounds labels and empty space. Wait for the rendered
  // camera to settle, then use the publication's actual 48px pointer target.
  const map = page.locator('.terr');
  await expect(map).toHaveAttribute('aria-busy', 'false');
  await map.locator(`[data-landmark=${JSON.stringify(publicationId)}] .lm__hit`).click();
}

function emitDiagnostic(event, detail) {
  console.log(`[pw-diag] ${event}: ${detail}`);
}

export function attachPageDiagnostics(page) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      emitDiagnostic(`console.${message.type()}`, message.text());
    }
  });
  page.on('pageerror', (error) => {
    emitDiagnostic('pageerror', error.stack || error.message);
  });
  page.on('requestfailed', (request) => {
    emitDiagnostic(
      'requestfailed',
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown failure'}`,
    );
  });
}

export function appUrl(path = '/') {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL;
  if (!baseURL) {
    return path;
  }
  const normalizedBase = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return new URL(normalizedPath, normalizedBase).toString();
}

export async function readServedArtifact(page, filename) {
  const response = await page.request.get(appUrl(`/data/generated/${filename}`));
  expect(response.ok()).toBe(true);
  return response.json();
}

export async function gotoApp(page, path = '/', options = undefined) {
  // The shared config intentionally keeps interaction navigation unconstrained
  // for large local artifacts, but initial route navigation must not wait
  // forever. A failed static server or a stalled first load used to make every
  // rendered suite appear to hang without a test result.
  return page.goto(appUrl(path), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
    ...options,
  });
}

export async function dismissOnboarding(page) {
  // The signal-cover only dismisses on Enter or a click on its own "Enter the
  // Atlas" button -- no click-anywhere, wheel, touchmove, or Escape shortcut.
  const brandEntrance = page.getByRole('dialog', { name: 'Control Atlas introduction' });
  if (await brandEntrance.isVisible()) {
    await brandEntrance.getByRole('button', { name: 'Enter the Atlas' }).click();
    await expect(brandEntrance).toBeHidden({ timeout: 3000 });
  }
  const skipOnboarding = page.getByRole('button', { name: 'Skip', exact: true });
  if (await skipOnboarding.isVisible()) {
    await skipOnboarding.click();
  }
}

// `data-app-ready="partial"` means search works but the full graph is still
// loading, so connection surfaces still render their aria-busy skeletons.
// Callers that assert on loaded content must wait for those to clear or they
// race the background load and see a skeleton instead.
export async function waitForSkeletonsSettled(page, options = {}) {
  const { timeout = 30000 } = options;
  await expect(page.locator('#workspace [aria-busy="true"]')).toHaveCount(0, {
    timeout,
  });
}

export async function waitForAppReady(page, options = {}) {
  const { allowPartial = false } = options;
  const readyPattern = allowPartial ? /^(true|partial)$/ : /^true$/;
  try {
    await expect(page.locator('#app')).toHaveAttribute('data-app-ready', readyPattern, { timeout: 60000 });
    // Data readiness can precede the route transition's interaction lock.
    await expect(page.locator('main#workspace')).not.toHaveAttribute('inert', '', { timeout: 60000 });
  } catch (error) {
    const startupSnapshot = await page.evaluate(() => {
      const app = document.querySelector('#app');
      return {
        href: location.href,
        ready: app?.getAttribute('data-app-ready') || '<missing>',
        busy: app?.getAttribute('aria-busy') || '<missing>',
        text: app?.textContent?.trim().slice(0, 400) || '',
        html: app?.innerHTML?.slice(0, 800) || '',
      };
    });
    emitDiagnostic('startup.snapshot', JSON.stringify(startupSnapshot));
    throw error;
  }
}

/**
 * The record page offers exactly one official-source action, but its label
 * states what the link actually does: a publisher page opens, a raw artifact
 * downloads. Matching the verb pair keeps the "exactly one" guarantee without
 * re-asserting the promise that a .zip is something you can view.
 */
export const OFFICIAL_SOURCE_ACTION = /^(?:View|Download) official source(?: \([A-Z0-9]+\))?$/;
