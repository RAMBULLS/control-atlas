import { defineConfig } from "@playwright/test";
import process from "node:process";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error("PLAYWRIGHT_BASE_URL is required for live Playwright tests");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["live-smoke.spec.mjs", "source-truth-presentation.spec.mjs"],
  timeout: 120000,
  workers: 1,
  use: {
    baseURL,
    // Keep live acceptance on the same full Chromium mode as the local suite.
    ...((process.env.PLAYWRIGHT_BROWSER || 'chromium') === 'chromium'
      ? { channel: 'chromium' }
      : {}),
    // Persist first-failure evidence for each bounded route group. This is
    // intentionally configured, not proof that a live run has occurred.
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
});
