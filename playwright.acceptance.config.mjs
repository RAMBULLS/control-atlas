import process from 'node:process';
import { defineConfig } from '@playwright/test';
import liveConfig from './playwright.live.config.mjs';

const browserName = process.env.PLAYWRIGHT_BROWSER || 'chromium';

export default defineConfig({
  ...liveConfig,
  testMatch: [
    'production-acceptance.spec.mjs',
    'v1-practitioner-workflows.spec.mjs',
    'critical-path-matrix.spec.mjs',
    'epic12-phase1-layout.spec.mjs',
    'layout-guardrails.spec.mjs',
    'library-search-recovery.spec.mjs',
  ],
  grep: /production acceptance|V1 workflow 06|critical path: keyboard focus|Epic 12 Phase 1 keeps chrome and content ordered at tablet|layout holds: start-here-bookmark|Library: the Atlas matching-records handoff/,
  retries: 0,
  projects: [{ name: browserName, use: { browserName } }],
  expect: { timeout: 15000 },
  use: { ...liveConfig.use, actionTimeout: 15000, navigationTimeout: 30000 },
});
