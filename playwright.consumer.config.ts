import { defineConfig, devices } from "@playwright/test";

const port = process.env.CONSUMER_PORT ?? "4319";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/consumer/browser",
  outputDir: "./test-results/playwright-consumer",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/consumer/browser/serve.mjs",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
