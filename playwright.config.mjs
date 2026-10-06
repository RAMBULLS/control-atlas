import { defineConfig } from '@playwright/test';
import process from 'node:process';

const port = process.env.PLAYWRIGHT_PORT ?? '4317';
const baseURL = `http://localhost:${port}`;
const browserName = process.env.PLAYWRIGHT_BROWSER ?? 'chromium';

export function resolveWorkerCount(environment = process.env) {
  const requested = Number.parseInt(environment.PLAYWRIGHT_WORKERS ?? '', 10);
  if (Number.isInteger(requested) && requested > 0) return requested;
  return environment.CI ? 1 : 2;
}

export default defineConfig({
  captureGitInfo: {
    commit: false,
    diff: false,
  },
  testDir: './tests/e2e',
  // The screenshot suite is not a default-config test. It needs disabled
  // animations, a hidden caret, a diff tolerance and a single worker, all of
  // which live in playwright.visual.config.mjs — run it with `npm run
  // test:visual`, which is what CI does. Running it here as well compared
  // screenshots with animations playing and zero tolerance, and on any
  // platform without a committed baseline it wrote one and reported a
  // failure. Two of the five failures in a full local run were exactly that.
  testIgnore: '**/visual-regression.spec.mjs',
  globalTeardown: './tools/playwright-global-teardown.mjs',
  fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === '1',
  timeout: process.env.CI ? 45000 : 30000,
  workers: resolveWorkerCount(),
  retries: process.env.CI ? 1 : 0,
  projects: [
    {
      name: browserName,
      use: { browserName },
    },
  ],
  expect: {
    timeout: process.env.CI ? 15000 : 5000,
  },
  use: {
    baseURL,
    actionTimeout: process.env.CI ? 15000 : 0,
    navigationTimeout: process.env.CI ? 30000 : 0,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node ./tools/serve-static-site.mjs',
    env: {
      PORT: port,
      CONTROL_ATLAS_PLAYWRIGHT_SERVER: '1',
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
