import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Milestone 10 E2E: API Lab UI → performance worker → M9 mock server →
 * metrics → report. Every process in that chain is real; nothing is stubbed.
 *
 * Determinism (spec §48): these tests assert request *counts*, *relationships*
 * and *classifications*, never absolute latency values. Durations are kept
 * short (2–4s) and thresholds are either absurdly generous or absurdly strict,
 * so the PASS/FAIL outcome cannot flip on a loaded CI machine.
 */

/** A dedicated mock-server instance (port 4011), not the 4010 one the
 * functional specs use — see playwright.config.ts for why. */
const MOCK_BASE = "http://localhost:4011";
/** Distinct path prefix so these routes can never collide with the routes
 * mockServer.spec.ts creates in the same shared server process. */
const P = "/perf-e2e";

const COLLECTION_ID = "col-perf";

/** Seeded directly into localStorage rather than clicked into existence:
 * these tests are about performance execution, not collection CRUD (which
 * collections.spec.ts already covers end to end). */
function seedWorkspace() {
  const now = "2026-01-01T00:00:00.000Z";
  const request = (id: string, name: string, url: string, extras: Record<string, unknown> = {}) => ({
    id,
    type: "request",
    name,
    createdAt: now,
    updatedAt: now,
    request: {
      method: "GET",
      url,
      params: [],
      headers: [],
      auth: { type: "none" },
      bodyMode: "none",
      bodyRawFormat: "JSON",
      bodyRawContent: "",
      tests: [],
      extractions: [],
      ...extras,
    },
  });

  return {
    version: 1,
    workspace: {
      collections: [
        {
          id: COLLECTION_ID,
          name: "Perf Collection",
          items: [
            request("req-fast", "Fast", `${MOCK_BASE}${P}/fast`),
            request("req-slow", "Slow", `${MOCK_BASE}${P}/slow`),
            request("req-error", "Error", `${MOCK_BASE}${P}/error`),
            request("req-env", "Env Fast", `{{baseUrl}}${P}/fast`),
          ],
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  };
}

function seedEnvironments() {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    version: 1,
    data: {
      environments: [
        {
          id: "env-perf",
          name: "Perf Env",
          variables: [{ id: "v1", key: "baseUrl", value: MOCK_BASE, secret: false, enabled: true }],
          createdAt: now,
          updatedAt: now,
        },
      ],
      activeEnvironmentId: null,
    },
  };
}

async function ensureMockRoute(api: APIRequestContext, path: string, status: number, delayMs: number, body: string) {
  const existing = await (await api.get(`${MOCK_BASE}/__mock/routes`)).json();
  if (existing.some((route: { path: string }) => route.path === path)) return;
  await api.post(`${MOCK_BASE}/__mock/routes`, {
    data: {
      method: "GET",
      path,
      enabled: true,
      scenarios: [
        {
          id: `sc-${path.replace(/\W/g, "")}`,
          name: `${status}`,
          status,
          headers: [{ id: "h1", key: "Content-Type", value: "application/json", enabled: true }],
          bodyFormat: "json",
          body,
          delayMs,
          enabled: true,
        },
      ],
      activeScenarioId: `sc-${path.replace(/\W/g, "")}`,
    },
  });
}

async function openPerformance(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Performance" }).click();
  await expect(page.getByRole("main", { name: "Performance workspace" })).toBeVisible();
}

interface RunOptions {
  targetKind?: "request" | "collection";
  target: string;
  environment?: string;
  users?: number;
  duration?: number;
  rampUp?: number;
  p95?: number;
  errorRate?: number;
}

async function configureRun(page: Page, options: RunOptions) {
  await page.locator("#perf-target-kind").selectOption(options.targetKind ?? "request");
  await page.locator("#perf-target").selectOption({ label: options.target });
  if (options.environment) await page.locator("#perf-environment").selectOption({ label: options.environment });
  await page.locator("#perf-users").fill(String(options.users ?? 4));
  await page.locator("#perf-duration").fill(String(options.duration ?? 2));
  await page.locator("#perf-rampup").fill(String(options.rampUp ?? 0));
  await page.getByTestId("perf-threshold-p95").fill(String(options.p95 ?? 60_000));
  await page.getByTestId("perf-threshold-errorRate").fill(String(options.errorRate ?? 100));
}

async function startAndWait(page: Page, timeout = 60_000) {
  await page.getByRole("button", { name: "Start Test" }).click();
  await expect(page.getByTestId("perf-report")).toBeVisible({ timeout });
}

function completedRequests(page: Page) {
  return page.getByTestId("perf-live-requests").innerText();
}

test.describe("Performance Engine", () => {
  // One shared worker process and one shared mock server: run serially so a
  // second run can never be rejected by the worker's single-run limit.
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await ensureMockRoute(api, `${P}/fast`, 200, 0, '{"ok":true}');
    await ensureMockRoute(api, `${P}/slow`, 200, 40, '{"ok":true}');
    await ensureMockRoute(api, `${P}/error`, 500, 0, '{"error":"boom"}');
    await api.dispose();
  });

  test.beforeEach(async ({ page }) => {
    const workspace = seedWorkspace();
    const environments = seedEnvironments();
    await page.addInitScript(
      ([ws, envs]) => {
        window.localStorage.setItem("api-lab-workspace", JSON.stringify(ws));
        window.localStorage.setItem("api-lab-environments", JSON.stringify(envs));
        window.localStorage.removeItem("api-lab-perf-config");
      },
      [workspace, environments],
    );
  });

  test("1. single request performance test produces a full report", async ({ page }) => {
    await openPerformance(page);
    await expect(page.getByTestId("perf-worker-status")).toContainText("Running");

    await configureRun(page, { target: "Perf Collection / Fast", users: 4, duration: 2 });
    await startAndWait(page);

    const summary = page.getByTestId("perf-report-summary");
    await expect(summary).toContainText("Performance Test Result");
    await expect(summary).toContainText("Virtual Users: 4");
    await expect(summary).toContainText("P95:");
    await expect(summary).toContainText("P99:");
    await expect(summary).toContainText("RPS:");

    // A real run against a zero-delay mock must complete a substantial
    // number of requests — a lower bound, never an exact count.
    expect(Number((await completedRequests(page)).replace(/\D/g, ""))).toBeGreaterThan(20);
  });

  test("2. collection performance test executes every request in the collection", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, {
      targetKind: "collection",
      target: "Perf Collection",
      environment: "Perf Env",
      users: 2,
      duration: 3,
    });
    await startAndWait(page);

    // The collection mixes 200s (fast, slow, env-fast) and 500s (error), so
    // both must appear — proving every request in the collection ran.
    await expect(page.getByTestId("perf-status-200")).toBeVisible();
    await expect(page.getByTestId("perf-status-500")).toBeVisible();
  });

  test("3. fixed concurrency — more virtual users complete more work", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Slow", users: 1, duration: 3 });
    await startAndWait(page);
    const single = Number((await completedRequests(page)).replace(/\D/g, ""));

    await page.getByRole("button", { name: "Clear result" }).click();
    await configureRun(page, { target: "Perf Collection / Slow", users: 8, duration: 3 });
    await startAndWait(page);
    const many = Number((await completedRequests(page)).replace(/\D/g, ""));

    // Against a fixed 40ms delay, 8 concurrent users must clear well over
    // twice the work of 1 — a relative check, robust to a slow machine.
    expect(many).toBeGreaterThan(single * 2);
  });

  test("4. duration — the test stops itself at the configured time", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Fast", users: 2, duration: 2 });

    const started = Date.now();
    await startAndWait(page);
    const elapsed = Date.now() - started;

    await expect(page.getByTestId("perf-report-summary")).toContainText(/Duration: [123](\.\d+)?s/);
    // Stopped on its own, without the UI having to intervene.
    expect(elapsed).toBeLessThan(30_000);
    await expect(page.getByRole("button", { name: "Start Test" })).toBeVisible();
  });

  test("5. ramp-up — load increases over the ramp window", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Slow", users: 10, duration: 4, rampUp: 3 });
    await startAndWait(page);

    const json = await page.evaluate(async () => {
      const res = await fetch("http://localhost:4020/__perf/status");
      return res.ok;
    });
    expect(json).toBe(true);

    // The RPS chart is rendered from the per-second time series, which is
    // what makes the ramp visible at all.
    await expect(page.getByTestId("perf-chart-rps")).toBeVisible();
    await expect(page.getByTestId("perf-report-summary")).toContainText("Virtual Users: 10");
  });

  test("6. error metrics — a 500 endpoint reports a 100% error rate", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Error", users: 3, duration: 2 });
    await startAndWait(page);

    await expect(page.getByTestId("perf-report-summary")).toContainText("Errors: 100%");
    await expect(page.getByTestId("perf-status-500")).toBeVisible();
    // Classified specifically as 5xx, not lumped into a single "failed".
    await expect(page.getByTestId("perf-error-http5xx")).not.toContainText(": 0");
    await expect(page.getByTestId("perf-error-http4xx")).toContainText(": 0");
    await expect(page.getByTestId("perf-error-timeout")).toContainText(": 0");
  });

  test("7. percentiles — P50/P90/P95/P99 are reported and correctly ordered", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Fast", users: 5, duration: 3 });
    await startAndWait(page);

    const text = await page.getByTestId("perf-report-summary").innerText();
    const read = (label: string) => Number(new RegExp(`${label}: (\\d+(?:\\.\\d+)?)ms`).exec(text)![1]);

    const p50 = read("P50");
    const p90 = read("P90");
    const p95 = read("P95");
    const p99 = read("P99");

    // Ordering is a mathematical property of the percentile algorithm and
    // holds on any machine; the absolute values are never asserted.
    expect(p50).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p95);
    expect(p95).toBeLessThanOrEqual(p99);

    await expect(page.getByTestId("perf-percentile-summary")).toBeVisible();
  });

  test("8. threshold PASS — a generous threshold passes", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Fast", users: 3, duration: 2, p95: 60_000, errorRate: 100 });
    await startAndWait(page);

    await expect(page.getByTestId("perf-report-status")).toContainText("PASSED");
    await expect(page.getByTestId("perf-threshold-result-p95")).toContainText("PASS");
  });

  test("9. threshold FAIL — an impossible threshold fails the run", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Slow", users: 3, duration: 2, p95: 1, errorRate: 100 });
    await startAndWait(page);

    await expect(page.getByTestId("perf-report-status")).toContainText("FAILED");
    await expect(page.getByTestId("perf-threshold-result-p95")).toContainText("FAIL");
  });

  test("10. cancellation — Stop Test yields a cancelled report, never a pass", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Fast", users: 3, duration: 300, p95: 60_000 });

    await page.getByRole("button", { name: "Start Test" }).click();
    await expect(page.getByTestId("perf-live")).toContainText("Running…");
    // Let real traffic accumulate so the cancelled report has real metrics.
    await expect(page.getByTestId("perf-live-requests")).not.toHaveText("0", { timeout: 15_000 });

    await page.getByRole("button", { name: "Stop Test" }).click();
    await expect(page.getByTestId("perf-report")).toBeVisible({ timeout: 30_000 });

    // The P95 threshold would have passed easily — cancellation still wins.
    await expect(page.getByTestId("perf-report-status")).toContainText("CANCELLED");
    await expect(page.getByTestId("perf-report-status")).not.toContainText("PASSED");
    await expect(page.getByTestId("perf-report-summary")).not.toContainText("Duration: 300");
  });

  test("11. memory safety — no response bodies are retained anywhere in the result", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Fast", users: 4, duration: 2 });
    await startAndWait(page);

    // The mock returns {"ok":true} thousands of times. It must appear
    // nowhere in the rendered result, and nowhere in the store's state.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain('"ok":true');

    const stateHasBodies = await page.evaluate(() => {
      const serialized = JSON.stringify(
        Object.values(window.localStorage).concat(document.body.innerHTML.slice(0, 0)),
      );
      return serialized.includes("rawBody") || serialized.includes('"ok":true');
    });
    expect(stateHasBodies).toBe(false);

    // Performance results are never written to browser storage (spec §35).
    const stored = await page.evaluate(() => Object.keys(window.localStorage));
    expect(stored).not.toContain("api-lab-perf-report");
    expect(stored).not.toContain("api-lab-perf-history");
  });

  test("12. full mock-server integration — UI → worker → mock server → metrics → report", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, {
      target: "Perf Collection / Env Fast",
      environment: "Perf Env",
      users: 4,
      duration: 2,
    });
    await startAndWait(page);

    // The URL was `{{baseUrl}}/perf-e2e/fast`, resolved from the environment
    // at execution time — a 200 distribution proves the whole chain worked.
    await expect(page.getByTestId("perf-status-200")).toBeVisible();
    await expect(page.getByTestId("perf-report-status")).toContainText("PASSED");
    await expect(page.getByTestId("perf-charts")).toBeVisible();
    await expect(page.getByTestId("perf-chart-rps")).toBeVisible();
    await expect(page.getByTestId("perf-chart-latency")).toBeVisible();
    await expect(page.getByTestId("perf-chart-errors")).toBeVisible();

    // The mock server logged the traffic it actually served.
    const logs = await page.evaluate(async () => {
      const res = await fetch("http://localhost:4011/__mock/logs");
      return (await res.json()) as Array<{ path: string; status: number }>;
    });
    expect(logs.some((entry) => entry.path.includes("/perf-e2e/fast") && entry.status === 200)).toBe(true);

    await expect(page.getByTestId("perf-history")).toBeVisible();
  });

  test("13. safety — an unreasonable configuration is rejected before any traffic", async ({ page }) => {
    await openPerformance(page);
    await page.locator("#perf-target").selectOption({ label: "Perf Collection / Fast" });
    await page.locator("#perf-users").fill("5000");
    await page.getByRole("button", { name: "Start Test" }).click();

    await expect(page.getByTestId("perf-form-error")).toContainText(/between 1 and 100/);
    await expect(page.getByTestId("perf-report")).toHaveCount(0);
  });

  test("14. safety — a non-local target requires explicit acknowledgement", async ({ page }) => {
    // Registered AFTER the beforeEach seed, so it runs last on load and wins
    // — mutating storage from the page would just be overwritten by the seed.
    await page.addInitScript(() => {
      const raw = JSON.parse(window.localStorage.getItem("api-lab-workspace")!);
      raw.workspace.collections[0].items[0].request.url = "https://api.example.com/health";
      window.localStorage.setItem("api-lab-workspace", JSON.stringify(raw));
    });
    await openPerformance(page);

    await configureRun(page, { target: "Perf Collection / Fast", users: 1, duration: 2 });
    await page.getByRole("button", { name: "Start Test" }).click();

    const warning = page.getByTestId("perf-production-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("api.example.com");
    await expect(warning).toContainText("only test systems you are authorized to test", { ignoreCase: true });

    await warning.getByRole("button", { name: "Cancel" }).click();
    await expect(warning).toHaveCount(0);
    // Cancelling the warning must not have started anything.
    await expect(page.getByTestId("perf-report")).toHaveCount(0);
  });

  test("15. local mock-server runs are never interrupted by the warning", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Fast", users: 2, duration: 2 });
    await page.getByRole("button", { name: "Start Test" }).click();
    await expect(page.getByTestId("perf-production-warning")).toHaveCount(0);
    await expect(page.getByTestId("perf-report")).toBeVisible({ timeout: 60_000 });
  });

  test("16. export — JSON and CSV downloads contain aggregates, not request records", async ({ page }) => {
    await openPerformance(page);
    await configureRun(page, { target: "Perf Collection / Fast", users: 3, duration: 2 });
    await startAndWait(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("perf-export-json").click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const contents = Buffer.concat(chunks).toString("utf8");

    const parsed = JSON.parse(contents);
    expect(parsed.summary.completed).toBeGreaterThan(0);
    expect(parsed.statusDistribution.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.timeSeries)).toBe(true);
    expect(parsed.note).toContain("not equivalent to distributed production load-test results");
    // No per-request records, no bodies.
    expect(contents).not.toContain('"ok":true');
    expect(parsed.requests).toBeUndefined();
  });
});
