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
    {
      // A SECOND mock-server instance, dedicated to the performance suite.
      // The load tests drive their target at thousands of requests per second;
      // sharing one mock server with the functional specs made those specs
      // flaky through pure resource contention (observed during Milestone 10
      // validation). A load test should never share its target with
      // functional tests — the same advice this tool gives its users.
      command: "node ../mock-server/src/index.ts",
      url: "http://localhost:4011/__mock/status",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      env: { MOCK_SERVER_PORT: "4011", MOCK_SERVER_DATA_FILE: "../mock-server/data/mock-routes.perf-e2e.json" },
    },
    {
      // The real load generator (Milestone 10). Same convention as the mock
      // server: a plain `node src/index.ts` process using Node's built-in
      // TypeScript type-stripping, with no build step.
      command: "node ../performance-worker/src/index.ts",
      url: "http://localhost:4020/__perf/status",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      env: { PERF_WORKER_PORT: "4020" },
    },
  ],
});
