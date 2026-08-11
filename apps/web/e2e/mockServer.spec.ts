import { test, expect, type Locator, type Page } from "@playwright/test";

function acceptDialog(page: Page, text?: string) {
  page.once("dialog", (dialog) => dialog.accept(text));
}

const MOCK_BASE = "http://localhost:4010";

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

async function openMockServer(page: Page) {
  await page.getByRole("button", { name: "Mock Server" }).click();
  const dialog = page.getByRole("dialog", { name: "Mock Server" });
  await expect(dialog.getByText(/Status: Running/)).toBeVisible();
  return dialog;
}

interface RouteSpec {
  method?: string;
  path: string;
  status?: number;
  body?: string;
  delayMs?: number;
  headerKey?: string;
  headerValue?: string;
}

/** Creates a route entirely through the real UI (not the admin API directly)
 * — the E2E suite exercises the same path a user would. */
async function createRoute(_page: Page, dialog: Locator, spec: RouteSpec) {
  await dialog.getByRole("button", { name: "+ New Route" }).click();
  if (spec.method) await dialog.locator("#route-method").selectOption(spec.method);
  await dialog.locator("#route-path").fill(spec.path);
  if (spec.status !== undefined) await dialog.locator("#scenario-status").fill(String(spec.status));
  if (spec.body !== undefined) await dialog.locator("#scenario-body").fill(spec.body);
  if (spec.delayMs !== undefined) await dialog.locator("#scenario-delay").fill(String(spec.delayMs));
  if (spec.headerKey) {
    await dialog.getByRole("button", { name: "+ Add header" }).click();
    const rows = dialog.locator('input[placeholder="Header"]');
    await rows.last().fill(spec.headerKey);
    await dialog.locator('input[placeholder="Value"]').last().fill(spec.headerValue ?? "");
  }
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
}

test.describe("Mock Server & API Simulation", () => {
  // All tests in this file share one long-lived mock-server process (a
  // real server, not a per-test mock) — run them serially so route
  // creation via the UI's "select the just-created route" flow can never
  // race against another test's concurrent route creation.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("1. mock server reports running status and port from the manager UI", async ({ page }) => {
    const dialog = await openMockServer(page);
    await expect(dialog.getByText("Port: 4010")).toBeVisible();
  });

  test("2. creating a route via the UI serves a real response to a real API Lab request", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, { method: "GET", path: "/t2/users", body: '{"users": []}' });
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    await setUrl(page, `${MOCK_BASE}/t2/users`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText('"users": []');
  });

  test("3. switching the active scenario changes the real server's response immediately", async ({ page }) => {
    const dialog = await openMockServer(page);
    await dialog.getByRole("button", { name: "+ New Route" }).click();
    await dialog.locator("#route-path").fill("/t3/session");
    await dialog.getByRole("button", { name: "Save" }).click();

    // Add a second, Unauthorized scenario.
    await dialog.getByRole("button", { name: "+ Add Scenario" }).click();
    await dialog.locator("#scenario-preset").selectOption("401");
    await dialog.getByRole("button", { name: "Save" }).click();

    await dialog.getByRole("button", { name: "Close mock server manager" }).click();
    await setUrl(page, `${MOCK_BASE}/t3/session`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    await page.getByRole("button", { name: "Mock Server" }).click();
    const dialog2 = page.getByRole("dialog", { name: "Mock Server" });
    await dialog2.getByText("/t3/session").click();
    await dialog2.locator("#scenario-select").selectOption({ label: "401 Unauthorized (401)" });
    // Switching the active scenario takes effect on the live server without a restart.
    await dialog2.getByRole("button", { name: "Set Active" }).click();
    await expect(dialog2.getByText("● Active")).toBeVisible();
    await dialog2.getByRole("button", { name: "Close mock server manager" }).click();

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^401/)).toBeVisible();
  });

  test("4. path parameters distinguish /users/1 from /users/2", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, { method: "GET", path: "/t4/users/:id", body: '{"id": "{{path.id}}"}' });
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    await setUrl(page, `${MOCK_BASE}/t4/users/123`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText('"id": "123"');
  });

  test("5. configured response headers are returned on the real response", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, {
      method: "GET",
      path: "/t5/headers",
      headerKey: "X-RateLimit-Remaining",
      headerValue: "99",
    });
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    await setUrl(page, `${MOCK_BASE}/t5/headers`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await page.getByLabel("Response section").getByRole("tab", { name: "Headers" }).click();
    await expect(page.getByText("x-ratelimit-remaining")).toBeVisible();
    await expect(page.getByText("99")).toBeVisible();
  });

  test("6. a configured delay is reflected in the response timing, without a fragile exact assertion", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, { method: "GET", path: "/t6/slow", delayMs: 400 });
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    await setUrl(page, `${MOCK_BASE}/t6/slow`);
    const start = Date.now();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    expect(Date.now() - start).toBeGreaterThanOrEqual(350);
  });

  test("7. an unmatched route returns a deterministic 404", async ({ page }) => {
    await setUrl(page, `${MOCK_BASE}/t7/does-not-exist`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^404/)).toBeVisible();
    await expect(page.getByText("Mock route not found", { exact: false })).toBeVisible();
  });

  test("8. disabling a route makes it stop responding as configured", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, { method: "GET", path: "/t8/toggle" });

    await dialog.getByText("/t8/toggle").click();
    await dialog.getByLabel("Route enabled").uncheck();
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    await setUrl(page, `${MOCK_BASE}/t8/toggle`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^404/)).toBeVisible();
  });

  test("9. a sent request appears in the mock server's request log", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, { method: "GET", path: "/t9/logged" });
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    await setUrl(page, `${MOCK_BASE}/t9/logged`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    await page.getByRole("button", { name: "Mock Server" }).click();
    const dialog2 = page.getByRole("dialog", { name: "Mock Server" });
    await dialog2.getByRole("button", { name: "Requests" }).click();
    await expect(dialog2.getByText("/t9/logged")).toBeVisible();
  });

  test("10. full integration: a saved request + assertion runs against the mock server and passes", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, { method: "GET", path: "/t10/health", status: 200, body: '{"ok": true}' });
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    await setUrl(page, `${MOCK_BASE}/t10/health`);
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Tests" }).click();
    await page.getByRole("button", { name: "+ Add Assertion" }).click();
    const row = page
      .locator("table", { has: page.locator("caption", { hasText: "Assertions" }) })
      .locator("tbody tr")
      .last();
    await row.locator('select[id^="target-"]').selectOption("status");
    await row.locator('input[id^="expected-"]').fill("200");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText("1 passed · 0 failed")).toBeVisible();
  });

  test("11. Collection Runner against the mock server: passes on 200, fails after switching the scenario to 500", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, { method: "GET", path: "/t11/health" });
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    acceptDialog(page, "Mock Runner Collection");
    await page.getByRole("button", { name: "New Collection" }).click();
    await expect(page.getByRole("navigation", { name: "Collections" }).getByText("Mock Runner Collection", { exact: true })).toBeVisible();

    await setUrl(page, `${MOCK_BASE}/t11/health`);
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Tests" }).click();
    await page.getByRole("button", { name: "+ Add Assertion" }).click();
    const row = page
      .locator("table", { has: page.locator("caption", { hasText: "Assertions" }) })
      .locator("tbody tr")
      .last();
    await row.locator('select[id^="target-"]').selectOption("status");
    await row.locator('input[id^="expected-"]').fill("200");

    await page.getByLabel("Save request").click();
    const saveDialog = page.getByRole("dialog", { name: "Save request" });
    await saveDialog.getByLabel("Name").fill("Health Check");
    await saveDialog.getByLabel("Collection").selectOption({ label: "Mock Runner Collection" });
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();

    await page.getByRole("button", { name: "Run Mock Runner Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    await expect(runnerDialog.locator("ul li button").first()).toContainText("Passed");
    await runnerDialog.getByRole("button", { name: "Close runner" }).click();

    // Change the mock route's active scenario to return 500 and run the same collection again.
    await page.getByRole("button", { name: "Mock Server" }).click();
    const dialog2 = page.getByRole("dialog", { name: "Mock Server" });
    await dialog2.getByText("/t11/health").click();
    await dialog2.locator("#scenario-preset").selectOption("500");
    await dialog2.getByRole("button", { name: "Save" }).click();
    await expect(dialog2.getByRole("button", { name: "Save" })).toBeDisabled();
    await dialog2.getByRole("button", { name: "Close mock server manager" }).click();

    await page.getByRole("button", { name: "Run Mock Runner Collection" }).click();
    const runnerDialog2 = page.getByRole("dialog", { name: "Collection Runner" });
    // Reopening the dialog shows the previous run's results until reset.
    await runnerDialog2.getByRole("button", { name: "Run Again" }).click();
    await runnerDialog2.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog2.getByText("Run complete")).toBeVisible();
    await expect(runnerDialog2.locator("ul li button").first()).toContainText("Failed");
  });

  test("12. the mock server URL works through an API Lab environment variable, never hardcoded", async ({ page }) => {
    const dialog = await openMockServer(page);
    await createRoute(page, dialog, { method: "GET", path: "/t12/ping", body: '{"pong": true}' });
    await dialog.getByRole("button", { name: "Close mock server manager" }).click();

    await page.getByLabel("Manage environments").click();
    const envDialog = page.getByRole("dialog", { name: "Manage environments" });
    acceptDialog(page, "Mock Env");
    await envDialog.getByRole("button", { name: "New Environment" }).click();
    await expect(envDialog.getByRole("button", { name: "Mock Env", exact: true })).toBeVisible();
    await envDialog.getByRole("button", { name: "+ Add variable" }).click();
    const row = envDialog.locator("tbody tr").last();
    await row.getByLabel("Key", { exact: true }).fill("mockBaseUrl");
    await row.getByLabel("Value", { exact: true }).fill(MOCK_BASE);
    await envDialog.getByRole("button", { name: "Close environment manager" }).click();

    await page.getByLabel("Environment", { exact: true }).selectOption({ label: "Mock Env" });
    await setUrl(page, "{{mockBaseUrl}}/t12/ping");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText('"pong": true');
  });
});
