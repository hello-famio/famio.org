import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 20_000,
  expect: { timeout: 8_000 },
  // Serial — tests share a live D1 database with stateful seed tokens
  workers: 1,
  use: {
    // Worker-served pages (/manage, /confirm, /unsubscribe) navigate directly to
    // staging — no proxy needed. Signup tests use an explicit localhost:3000 URL.
    baseURL: "https://famio-worker-staging.bevn.workers.dev",
    // Use installed Chrome; fall back to Playwright's Chromium
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun scripts/dev-proxy.ts",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 10_000,
  },
  globalSetup: "./test/e2e/global-setup.ts",
  globalTeardown: "./test/e2e/global-teardown.ts",
  outputDir: "test-results/",
});
