import { test, expect, type Page } from "@playwright/test";

const FIXTURE_BASE = "http://localhost:4001";

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

async function openTestsTab(page: Page) {
  await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Tests" }).click();
}

async function addExtractionRow(page: Page) {
  await page.getByRole("button", { name: "+ Add Extraction" }).click();
  return page.locator("table", { has: page.locator("caption", { hasText: "Extractions" }) }).locator("tbody tr").last();
}

async function addAssertionRow(page: Page) {
  await page.getByRole("button", { name: "+ Add Assertion" }).click();
  return page.locator("table", { has: page.locator("caption", { hasText: "Assertions" }) }).locator("tbody tr").last();
}

async function addHeaderRow(page: Page, key: string, value: string) {
  await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Headers" }).click();
  await page.getByRole("button", { name: "+ Add row" }).click();
  const row = page.getByLabel("Key", { exact: true }).last().locator("xpath=ancestor::tr");
  await row.getByLabel("Key", { exact: true }).fill(key);
  await row.getByLabel("Value", { exact: true }).fill(value);
}

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Collections" });
}

async function saveIntoCollection(page: Page, collectionName: string, requestName: string) {
  await page.getByLabel("Save request").click();
  const dialog = page.getByRole("dialog", { name: "Save request" });
  await dialog.getByLabel("Name").fill(requestName);
  await dialog.getByLabel("Collection").selectOption({ label: collectionName });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
}

async function newCollection(page: Page, name: string) {
  page.once("dialog", (dialog) => dialog.accept(name));
  await page.getByRole("button", { name: "New Collection" }).click();
  await expect(sidebar(page).getByText(name, { exact: true })).toBeVisible();
}

test.describe("Advanced Workflows — extraction and chaining", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("1. extracts a runtime variable from a JSON response body", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/login`);
    await page.getByRole("combobox", { name: "HTTP method" }).selectOption("POST");
    await openTestsTab(page);
    const row = await addExtractionRow(page);
    await row.locator('select[id^="extraction-source-"]').selectOption("json");
    await row.locator('input[id^="extraction-path-"]').fill("$.token");
    await row.locator('input[id^="extraction-variable-"]').fill("authToken");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText(/✓ authToken = tok-anon/)).toBeVisible();
  });

  test("2. chains an extracted variable from one request into a later request in the same collection run", async ({ page }) => {
    await newCollection(page, "Chain Collection");

    await setUrl(page, `${FIXTURE_BASE}/login`);
    await page.getByRole("combobox", { name: "HTTP method" }).selectOption("POST");
    await openTestsTab(page);
    const extractionRow = await addExtractionRow(page);
    await extractionRow.locator('select[id^="extraction-source-"]').selectOption("json");
    await extractionRow.locator('input[id^="extraction-path-"]').fill("$.token");
    await extractionRow.locator('input[id^="extraction-variable-"]').fill("authToken");
    await saveIntoCollection(page, "Chain Collection", "Login");

    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/whoami`);
    await addHeaderRow(page, "Authorization", "Bearer {{authToken}}");
    await openTestsTab(page);
    const assertionRow = await addAssertionRow(page);
    await assertionRow.locator('select[id^="target-"]').selectOption("json");
    await assertionRow.locator('select[id^="operator-"]').selectOption("equals");
    await assertionRow.locator('input[id^="key-"]').fill("$.authorization");
    await assertionRow.locator('input[id^="expected-"]').fill("Bearer tok-anon");
    await saveIntoCollection(page, "Chain Collection", "Whoami");

    await page.getByRole("button", { name: "Run Chain Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    const items = runnerDialog.locator("ul li button");
    await expect(items.nth(1)).toContainText("Passed");
  });

  test("3. extracts a runtime variable from a response header", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/login`);
    await page.getByRole("combobox", { name: "HTTP method" }).selectOption("POST");
    await openTestsTab(page);
    const row = await addExtractionRow(page);
    await row.locator('select[id^="extraction-source-"]').selectOption("header");
    await row.locator('input[id^="extraction-path-"]').fill("X-Auth-Token");
    await row.locator('input[id^="extraction-variable-"]').fill("headerToken");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText(/✓ headerToken = tok-anon/)).toBeVisible();
  });
});

test.describe("Advanced Workflows — data-driven runs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("4. runs a collection once per row of an imported JSON dataset", async ({ page }) => {
    await newCollection(page, "JSON Dataset Collection");
    await setUrl(page, `${FIXTURE_BASE}/echo?id={{id}}`);
    await saveIntoCollection(page, "JSON Dataset Collection", "Get Item");

    await page.getByRole("button", { name: "Run JSON Dataset Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog
      .getByLabel("Import dataset")
      .setInputFiles({ name: "ids.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([{ id: "1" }, { id: "2" }])) });
    await expect(runnerDialog.getByText(/ids\.json — 2 rows, 1 column/)).toBeVisible();

    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    await expect(runnerDialog.getByText("Iteration 1")).toBeVisible();
    await expect(runnerDialog.getByText("Iteration 2")).toBeVisible();
  });

  test("5. runs a collection once per row of an imported CSV dataset", async ({ page }) => {
    await newCollection(page, "CSV Dataset Collection");
    await setUrl(page, `${FIXTURE_BASE}/echo?id={{id}}`);
    await saveIntoCollection(page, "CSV Dataset Collection", "Get Item");

    await page.getByRole("button", { name: "Run CSV Dataset Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog
      .getByLabel("Import dataset")
      .setInputFiles({ name: "ids.csv", mimeType: "text/csv", buffer: Buffer.from("id\n1\n2\n3\n") });
    await expect(runnerDialog.getByText(/ids\.csv — 3 rows, 1 column/)).toBeVisible();

    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    await expect(runnerDialog.getByText("Iteration 3")).toBeVisible();
  });

  test("6. combines a dataset with request chaining — each row's extraction feeds its own iteration", async ({ page }) => {
    await newCollection(page, "Dataset Chain Collection");

    await setUrl(page, `${FIXTURE_BASE}/login?username={{username}}`);
    await page.getByRole("combobox", { name: "HTTP method" }).selectOption("POST");
    await openTestsTab(page);
    const extractionRow = await addExtractionRow(page);
    await extractionRow.locator('select[id^="extraction-source-"]').selectOption("json");
    await extractionRow.locator('input[id^="extraction-path-"]').fill("$.token");
    await extractionRow.locator('input[id^="extraction-variable-"]').fill("authToken");
    await saveIntoCollection(page, "Dataset Chain Collection", "Login");

    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/whoami`);
    await addHeaderRow(page, "Authorization", "{{authToken}}");
    await saveIntoCollection(page, "Dataset Chain Collection", "Whoami");

    await page.getByRole("button", { name: "Run Dataset Chain Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByLabel("Import dataset").setInputFiles({
      name: "users.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{ username: "ada" }, { username: "grace" }])),
    });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();

    const items = runnerDialog.locator("ul li button");
    await expect(items).toHaveCount(4);
    await items.nth(0).click();
    await expect(runnerDialog.getByText(/authToken = tok-ada/)).toBeVisible();
  });
});

test.describe("Advanced Workflows — runner iterations, failure modes, cancellation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("7. stop-on-failure halts the run on the first failing iteration", async ({ page }) => {
    await newCollection(page, "Stop On Failure Collection");
    await setUrl(page, `${FIXTURE_BASE}/status/{{code}}`);
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("status");
    await row.locator('input[id^="expected-"]').fill("200");
    await saveIntoCollection(page, "Stop On Failure Collection", "Check Status");

    await page.getByRole("button", { name: "Run Stop On Failure Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByLabel("Import dataset").setInputFiles({
      name: "codes.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{ code: "200" }, { code: "500" }, { code: "200" }])),
    });
    await expect(runnerDialog.getByLabel("Stop on failure")).toBeChecked();
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    await expect(runnerDialog.getByText("Iteration 3")).toBeVisible();
    const items = runnerDialog.locator("ul li button");
    await expect(items.nth(0)).toContainText("Passed");
    await expect(items.nth(1)).toContainText("Failed");
    await expect(items.nth(2)).toContainText("Skipped");
  });

  test("8. continue-on-failure runs every iteration despite a failure", async ({ page }) => {
    await newCollection(page, "Continue On Failure Collection");
    await setUrl(page, `${FIXTURE_BASE}/status/{{code}}`);
    await openTestsTab(page);
    const row = await addAssertionRow(page);
    await row.locator('select[id^="target-"]').selectOption("status");
    await row.locator('input[id^="expected-"]').fill("200");
    await saveIntoCollection(page, "Continue On Failure Collection", "Check Status");

    await page.getByRole("button", { name: "Run Continue On Failure Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByLabel("Import dataset").setInputFiles({
      name: "codes.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{ code: "200" }, { code: "500" }, { code: "200" }])),
    });
    await runnerDialog.getByLabel("Stop on failure").uncheck();
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    const items = runnerDialog.locator("ul li button");
    await expect(items.nth(0)).toContainText("Passed");
    await expect(items.nth(1)).toContainText("Failed");
    await expect(items.nth(2)).toContainText("Passed");
  });

  test("9. runs multiple iterations and reports a summary aggregated across all of them", async ({ page }) => {
    await newCollection(page, "Multi Iteration Collection");
    await setUrl(page, `${FIXTURE_BASE}/echo?id={{id}}`);
    await saveIntoCollection(page, "Multi Iteration Collection", "Echo");

    await page.getByRole("button", { name: "Run Multi Iteration Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByLabel("Import dataset").setInputFiles({
      name: "ids.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }])),
    });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    await expect(runnerDialog.getByText(/Total:\s*4/)).toBeVisible();
    await expect(runnerDialog.getByText("Iteration 4")).toBeVisible();
  });

  test("10. cancelling a multi-iteration run reports Cancelled, not a false success", async ({ page }) => {
    await newCollection(page, "Cancel Iteration Collection");
    await setUrl(page, `${FIXTURE_BASE}/delay/2000`);
    await saveIntoCollection(page, "Cancel Iteration Collection", "Slow");

    await page.getByRole("button", { name: "Run Cancel Iteration Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByLabel("Import dataset").setInputFiles({
      name: "rows.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{ n: "1" }, { n: "2" }])),
    });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByRole("button", { name: "Cancel Run" })).toBeVisible();
    await runnerDialog.getByRole("button", { name: "Cancel Run" }).click();

    await expect(runnerDialog.getByRole("paragraph").filter({ hasText: "Cancelled" })).toBeVisible();
    const items = runnerDialog.locator("ul li button");
    await expect(items.first()).not.toContainText("Passed");
  });

  test("11. runtime variables from one run never leak into a separate later run", async ({ page }) => {
    await newCollection(page, "Isolation Collection");

    await setUrl(page, `${FIXTURE_BASE}/login`);
    await page.getByRole("combobox", { name: "HTTP method" }).selectOption("POST");
    await openTestsTab(page);
    const extractionRow = await addExtractionRow(page);
    await extractionRow.locator('select[id^="extraction-source-"]').selectOption("json");
    await extractionRow.locator('input[id^="extraction-path-"]').fill("$.token");
    await extractionRow.locator('input[id^="extraction-variable-"]').fill("authToken");
    await saveIntoCollection(page, "Isolation Collection", "Login");

    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/whoami`);
    await addHeaderRow(page, "Authorization", "{{authToken}}");
    await openTestsTab(page);
    const assertionRow = await addAssertionRow(page);
    await assertionRow.locator('select[id^="target-"]').selectOption("json");
    await assertionRow.locator('select[id^="operator-"]').selectOption("equals");
    await assertionRow.locator('input[id^="key-"]').fill("$.authorization");
    await assertionRow.locator('input[id^="expected-"]').fill("tok-anon");
    await saveIntoCollection(page, "Isolation Collection", "Whoami");

    await page.getByRole("button", { name: "Run Isolation Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    const firstRunItems = runnerDialog.locator("ul li button");
    await expect(firstRunItems.nth(1)).toContainText("Passed");

    // A second, separate run must resolve the same variable independently —
    // it cannot rely on state left behind by the first run.
    await runnerDialog.getByRole("button", { name: "Run Again" }).click();
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    const secondRunItems = runnerDialog.locator("ul li button");
    await expect(secondRunItems.nth(1)).toContainText("Passed");
  });
});
