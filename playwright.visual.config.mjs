import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.mjs';

export default defineConfig({
  ...baseConfig,
  testMatch: '**/visual-regression.spec.mjs',
  // The base config excludes this spec so the default run does not compare
  // screenshots without the settings below. This is the config that owns it.
  testIgnore: [],
  workers: 1,
  retries: 0,
  expect: {
    ...baseConfig.expect,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
});
