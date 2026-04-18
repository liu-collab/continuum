import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/agent-e2e",
  globalSetup: "./tests/agent-e2e/global-setup.mjs",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
