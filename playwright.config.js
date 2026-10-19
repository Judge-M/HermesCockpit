import { defineConfig } from "@playwright/test";

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "build/test-results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: [["list"], ["html", { outputFolder: "build/playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { viewport: { width: 1440, height: 900 } }
    },
    {
      name: "chromium-mobile",
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      }
    }
  ],
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:4174/live-control.html",
    reuseExistingServer: !CI,
    timeout: 15_000
  }
});
