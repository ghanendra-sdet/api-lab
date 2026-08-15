import { test, expect, type Page } from "@playwright/test";

const FIXTURE_BASE = "http://localhost:4001";

function acceptDialog(page: Page, text?: string) {
  page.once("dialog", (dialog) => dialog.accept(text));
}

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

async function openTestsTab(page: Page) {
  await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Tests" }).click();
}

async function addAssertionRow(page: Page) {
  await page.getByRole("button", { name: "+ Add Assertion" }).click();
  return page.locator("tbody tr").last();
}

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Collections" });
}

test.describe("Testing Engine — assertions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("status assertion passes against a real response", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("status");
    await row.locator('select[id^="operator-"]').selectOption("equals");
    await row.locator('input[id^="expected-"]').fill("200");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText("1 passed · 0 failed")).toBeVisible();
    await expect(page.getByText(/✓.*status equals/)).toBeVisible();
  });

  test("failed assertion is clearly reported", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("status");
    await row.locator('input[id^="expected-"]').fill("404");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText("0 passed · 1 failed")).toBeVisible();
    await expect(page.getByText(/✗.*status equals/)).toBeVisible();
  });

  test("header assertion checks a real response header", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/json`);
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("header");
    await row.locator('select[id^="operator-"]').selectOption("contains");
    await row.locator('input[id^="key-"]').fill("content-type");
    await row.locator('input[id^="expected-"]').fill("json");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText("1 passed · 0 failed")).toBeVisible();
  });

  test("JSON path assertion resolves $.id against a real response", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/json`);
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("json");
    await row.locator('select[id^="operator-"]').selectOption("equals");
    await row.locator('input[id^="key-"]').fill("$.id");
    await row.locator('input[id^="expected-"]').fill("123");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText("1 passed · 0 failed")).toBeVisible();
  });

  test("response time assertion against a deterministic delayed response", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/delay/50`);
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("responseTime");
    await row.locator('select[id^="operator-"]').selectOption("lessThan");
    await row.locator('input[id^="expected-"]').fill("5000");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText("1 passed · 0 failed")).toBeVisible();
  });

  test("header assertions (notEquals/notContains) and JSONPath nested/numeric comparisons", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/json`);
    await openTestsTab(page);

    // 1. Header notEquals (PASS)
    const row1 = await addAssertionRow(page);
    await row1.locator('select[id^="target-"]').selectOption("header");
    await row1.locator('select[id^="operator-"]').selectOption("notEquals");
    await row1.locator('input[id^="key-"]').fill("content-type");
    await row1.locator('input[id^="expected-"]').fill("text/html");

    // 2. JSONPath numeric greaterThan (PASS)
    const row2 = await addAssertionRow(page);
    await row2.locator('select[id^="target-"]').selectOption("json");
    await row2.locator('select[id^="operator-"]').selectOption("greaterThan");
    await row2.locator('input[id^="key-"]').fill("$.id");
    await row2.locator('input[id^="expected-"]').fill("100");

    // 3. Body matches regex (PASS)
    const row3 = await addAssertionRow(page);
    await row3.locator('select[id^="target-"]').selectOption("body");
    await row3.locator('select[id^="operator-"]').selectOption("matches");
    await row3.locator('input[id^="expected-"]').fill("123");

    // 4. Response size lessThanOrEqual (PASS)
    const row4 = await addAssertionRow(page);
    await row4.locator('select[id^="target-"]').selectOption("responseSize");
    await row4.locator('select[id^="operator-"]').selectOption("lessThanOrEqual");
    await row4.locator('input[id^="expected-"]').fill("1000");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText("4 passed · 0 failed")).toBeVisible();
  });

  test("saved assertions persist across a real browser reload", async ({ page }) => {
    acceptDialog(page, "Assertion Collection");
    await page.getByRole("button", { name: "New Collection" }).click();
    await expect(sidebar(page).getByText("Assertion Collection", { exact: true })).toBeVisible();

    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("status");
    await row.locator('input[id^="expected-"]').fill("200");

    await page.getByLabel("Save request").click();
    const dialog = page.getByRole("dialog", { name: "Save request" });
    await dialog.getByLabel("Name").fill("Assertion Request");
    await dialog.getByLabel("Collection").selectOption({ label: "Assertion Collection" });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    await page.waitForTimeout(500);
    await page.reload();

    await sidebar(page).getByText("Assertion Request", { exact: true }).click();
    await openTestsTab(page);
    await expect(page.locator('input[id^="expected-"]').first()).toHaveValue("200");
  });
});

test.describe("Testing Engine — Collection Runner", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  async function createCollectionWithRequests(page: Page, collectionName: string, requestUrls: [string, string][]) {
    acceptDialog(page, collectionName);
    await page.getByRole("button", { name: "New Collection" }).click();
    await expect(sidebar(page).getByText(collectionName, { exact: true })).toBeVisible();

    for (const [name, url] of requestUrls) {
      await setUrl(page, url);
      await page.getByLabel("Save request").click();
      const dialog = page.getByRole("dialog", { name: "Save request" });
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Collection").selectOption({ label: collectionName });
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByLabel("Open new request tab").click();
    }
  }

  test("runs requests sequentially in order and reports a summary", async ({ page }) => {
    await createCollectionWithRequests(page, "Runner Collection", [
      ["Request A", `${FIXTURE_BASE}/echo`],
      ["Request B", `${FIXTURE_BASE}/echo`],
      ["Request C", `${FIXTURE_BASE}/echo`],
    ]);

    await page.getByRole("button", { name: "Run Runner Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await expect(runnerDialog).toBeVisible();
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    const items = runnerDialog.locator("ul li button");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("Request A");
    await expect(items.nth(1)).toContainText("Request B");
    await expect(items.nth(2)).toContainText("Request C");
  });

  test("stop-on-failure halts remaining requests; continue-on-failure runs them all", async ({ page }) => {
    await createCollectionWithRequests(page, "Failure Collection", [
      ["Good Request", `${FIXTURE_BASE}/echo`],
      ["Bad Request", `${FIXTURE_BASE}/status/500`],
      ["Never Reached", `${FIXTURE_BASE}/echo`],
    ]);

    // Add a status-equals-200 assertion to both requests — "Good Request"
    // will pass it, "Bad Request" (which hits /status/500) will fail it.
    await sidebar(page).getByText("Good Request", { exact: true }).click();
    await openTestsTab(page);
    const goodRow = await addAssertionRow(page);
    await goodRow.locator('select[id^="target-"]').selectOption("status");
    await goodRow.locator('input[id^="expected-"]').fill("200");
    await page.getByLabel("Save request").click();

    await sidebar(page).getByText("Bad Request", { exact: true }).click();
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("status");
    await row.locator('input[id^="expected-"]').fill("200");
    await page.getByLabel("Save request").click();

    await page.getByRole("button", { name: "Run Failure Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    const items = runnerDialog.locator("ul li button");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("Passed");
    await expect(items.nth(1)).toContainText("Failed");
    // Stopped before running the third request — its status must be
    // "Skipped" (never attempted), distinct from a request that ran
    // successfully but had no assertions defined.
    await expect(items.nth(2)).toContainText("Skipped");
  });

  test("cancelling a run reports Cancelled rather than a false success", async ({ page }) => {
    await createCollectionWithRequests(page, "Cancel Collection", [
      ["Slow A", `${FIXTURE_BASE}/delay/2000`],
      ["Slow B", `${FIXTURE_BASE}/delay/2000`],
    ]);

    await page.getByRole("button", { name: "Run Cancel Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByRole("button", { name: "Cancel Run" })).toBeVisible();
    await runnerDialog.getByRole("button", { name: "Cancel Run" }).click();

    await expect(runnerDialog.getByRole("paragraph").filter({ hasText: "Cancelled" })).toBeVisible();
  });
});

test.describe("Testing Engine — scripts and sandboxing", () => {
  test("pre-request script runs in Web Worker sandbox and logs output", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await expect(page.getByText(/Scripts execute in a secure browser Web Worker sandbox/)).toBeVisible();

    await page.getByLabel("Pre-request Script").fill('console.log("SANDBOX_RUNNING"); apiLab.variables.set("myVar", "helloFromScript");');
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    // Verify script result logs and status are rendered in the Scripts tab
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await expect(page.getByText("SUCCESS (").first()).toBeVisible();
    await expect(page.locator('.max-h-32').getByText("SANDBOX_RUNNING")).toBeVisible();
  });

  test("unrestricted globals like window and document are undefined inside the sandbox", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await page.getByLabel("Pre-request Script").fill('console.log("window: " + typeof window); console.log("document: " + typeof document);');
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await expect(page.locator('.max-h-32').getByText("window: undefined")).toBeVisible();
    await expect(page.locator('.max-h-32').getByText("document: undefined")).toBeVisible();
  });

  test("invalid script syntax fails cleanly and does not crash the application", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await page.getByLabel("Pre-request Script").fill('const x = ;'); // Syntax error
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("button", { name: "Send" }).click();
    // Pre-request script failure stops execution, so no 200 response is received.
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await expect(page.getByText("ERROR (").first()).toBeVisible();
  });

  test("network APIs (fetch, sendBeacon, importScripts) and prototype recovery are blocked", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();

    const maliciousScript = `
      try {
        console.log("fetch: " + typeof fetch);
        console.log("sendBeacon: " + (typeof navigator !== 'undefined' ? typeof navigator.sendBeacon : 'undefined'));
        console.log("importScripts: " + typeof importScripts);

        let globalVal;
        try {
          globalVal = Function("return this")();
        } catch (e) {
          console.log("proto_fetch: undefined");
          return;
        }

        if (globalVal) {
          console.log("proto_fetch: " + typeof Object.getPrototypeOf(globalVal).fetch);
        } else {
          console.log("proto_fetch: undefined");
        }
      } catch (e) {
        console.log("error: " + e.message);
      }
    `;
    await page.getByLabel("Pre-request Script").fill(maliciousScript);
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await expect(page.locator('.max-h-32').getByText("fetch: undefined", { exact: true })).toBeVisible();
    await expect(page.locator('.max-h-32').getByText("sendBeacon: undefined", { exact: true })).toBeVisible();
    await expect(page.locator('.max-h-32').getByText("importScripts: undefined", { exact: true })).toBeVisible();
    await expect(page.locator('.max-h-32').getByText("proto_fetch: undefined", { exact: true })).toBeVisible();
  });

  test("storage APIs (indexedDB, caches) and prototype recovery are blocked", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();

    const maliciousScript = `
      try {
        console.log("indexedDB: " + typeof indexedDB);
        console.log("caches: " + typeof caches);

        let globalVal;
        try {
          globalVal = Function("return this")();
        } catch (e) {
          console.log("proto_idb: undefined");
          console.log("proto_caches: undefined");
          return;
        }

        if (globalVal) {
          console.log("proto_idb: " + typeof Object.getPrototypeOf(globalVal).indexedDB);
          console.log("proto_caches: " + typeof Object.getPrototypeOf(globalVal).caches);
        } else {
          console.log("proto_idb: undefined");
          console.log("proto_caches: undefined");
        }
      } catch (e) {
        console.log("error: " + e.message);
      }
    `;
    await page.getByLabel("Pre-request Script").fill(maliciousScript);
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await expect(page.locator('.max-h-32').getByText("indexedDB: undefined", { exact: true })).toBeVisible();
    await expect(page.locator('.max-h-32').getByText("caches: undefined", { exact: true })).toBeVisible();
    await expect(page.locator('.max-h-32').getByText("proto_idb: undefined", { exact: true })).toBeVisible();
    await expect(page.locator('.max-h-32').getByText("proto_caches: undefined", { exact: true })).toBeVisible();
  });

  test("infinite loop script triggers a timeout and terminates worker cleanly", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await page.getByLabel("Pre-request Script").fill('while (true) {}');
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("button", { name: "Send" }).click();

    // Timeout terminates worker, so request fails. Result displays timeout error.
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Scripts" }).click();
    await expect(page.getByText("TIMEOUT (").first()).toBeVisible();
  });
});
