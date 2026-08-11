import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "node e2e/fixtures/server.mjs",
      url: "http://localhost:4001/text",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: "node ../mock-server/src/index.ts",
      url: "http://localhost:4010/__mock/status",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      env: { MOCK_SERVER_PORT: "4010", MOCK_SERVER_DATA_FILE: "../mock-server/data/mock-routes.e2e.json" },
    },
  ],
});
