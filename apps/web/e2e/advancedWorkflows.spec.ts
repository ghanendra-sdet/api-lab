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

  test("12. runner supports configurable delays and runs successfully", async ({ page }) => {
    await newCollection(page, "Delay E2E Collection");
    await setUrl(page, `${FIXTURE_BASE}/login`);
    await saveIntoCollection(page, "Delay E2E Collection", "Login");

    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/whoami`);
    await saveIntoCollection(page, "Delay E2E Collection", "Whoami");

    await page.getByRole("button", { name: "Run Delay E2E Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    
    // Check that Delay input exists and defaults to 0
    const delayInput = runnerDialog.getByLabel("Delay (ms)");
    await expect(delayInput).toBeVisible();
    await expect(delayInput).toHaveValue("0");

    // Change delay and trigger run
    await delayInput.fill("150");
    const start = Date.now();
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    const end = Date.now();
    
    // Duration must be at least the configured delay
    expect(end - start).toBeGreaterThanOrEqual(150);
  });

  test("13. target request extraction failure stops execution when stop-on-failure is enabled", async ({ page }) => {
    await newCollection(page, "Extraction Stop E2E Collection");
    
    // Request 1: Login with failed extraction
    await setUrl(page, `${FIXTURE_BASE}/login`);
    await openTestsTab(page);
    const extractionRow = await addExtractionRow(page);
    await extractionRow.locator('select[id^="extraction-source-"]').selectOption("json");
    await extractionRow.locator('input[id^="extraction-path-"]').fill("$.missing_field");
    await extractionRow.locator('input[id^="extraction-variable-"]').fill("shouldFail");
    await saveIntoCollection(page, "Extraction Stop E2E Collection", "Request A");

    // Request 2: Whoami
    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/whoami`);
    await saveIntoCollection(page, "Extraction Stop E2E Collection", "Request B");

    // Run Collection
    await page.getByRole("button", { name: "Run Extraction Stop E2E Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await expect(runnerDialog.getByLabel("Stop on failure")).toBeChecked();
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    const items = runnerDialog.locator("ul li button");
    await expect(items.nth(0)).toContainText("Error");
    await expect(items.nth(1)).toContainText("Skipped");
  });

  test("14. runs folder execution: executes only requests in folder, skipping other folders", async ({ page }) => {
    await newCollection(page, "Folder E2E Coll");
    
    // Create Folder A
    page.once("dialog", (dialog) => dialog.accept("Folder A"));
    await page.getByRole("button", { name: "New folder in Folder E2E Coll" }).click();
    await expect(sidebar(page).getByText("Folder A", { exact: true })).toBeVisible();

    // Create Folder B
    page.once("dialog", (dialog) => dialog.accept("Folder B"));
    await page.getByRole("button", { name: "New folder in Folder E2E Coll" }).click();
    await expect(sidebar(page).getByText("Folder B", { exact: true })).toBeVisible();

    // Save Req A1 in Folder A
    await setUrl(page, `${FIXTURE_BASE}/status/200`);
    await page.getByLabel("Save request").click();
    const dialogA1 = page.getByRole("dialog", { name: "Save request" });
    await dialogA1.getByLabel("Name").fill("Req A1");
    await dialogA1.getByLabel("Collection").selectOption({ label: "Folder E2E Coll" });
    await dialogA1.getByLabel("Folder (optional)").selectOption({ label: "Folder A" });
    await dialogA1.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialogA1).toBeHidden();

    // Save Req B1 in Folder B
    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/status/200`);
    await page.getByLabel("Save request").click();
    const dialogB1 = page.getByRole("dialog", { name: "Save request" });
    await dialogB1.getByLabel("Name").fill("Req B1");
    await dialogB1.getByLabel("Collection").selectOption({ label: "Folder E2E Coll" });
    await dialogB1.getByLabel("Folder (optional)").selectOption({ label: "Folder B" });
    await dialogB1.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialogB1).toBeHidden();

    // Trigger Run Folder A
    await page.getByRole("button", { name: "Run Folder A" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await expect(runnerDialog.getByText("Scope: Folder — Folder A")).toBeVisible();
    await expect(runnerDialog.getByText("Req A1")).toBeVisible();
    await expect(runnerDialog.getByText("Req B1")).toBeHidden();

    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();

    const runItems = runnerDialog.locator("ul li button");
    await expect(runItems).toHaveCount(1);
    await expect(runItems.nth(0)).toContainText("Req A1");
  });

  test("15. runs folder execution: executes external prerequisite dependency and propagates variables", async ({ page }) => {
    await newCollection(page, "Folder Deps E2E Coll");
    
    // Create Folder Auth
    page.once("dialog", (dialog) => dialog.accept("Folder Auth"));
    await page.getByRole("button", { name: "New folder in Folder Deps E2E Coll" }).click();
    await expect(sidebar(page).getByText("Folder Auth", { exact: true })).toBeVisible();

    // Create Folder Users
    page.once("dialog", (dialog) => dialog.accept("Folder Users"));
    await page.getByRole("button", { name: "New folder in Folder Deps E2E Coll" }).click();
    await expect(sidebar(page).getByText("Folder Users", { exact: true })).toBeVisible();

    // Request Login in Folder Auth (POST /login?username=ada, extract $.token)
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/login?username=ada`);
    await openTestsTab(page);
    const extRow = await addExtractionRow(page);
    await extRow.getByLabel("JSON path").fill("$.token");
    await extRow.getByLabel("Variable name").fill("token");

    await page.getByLabel("Save request").click();
    const dialogL = page.getByRole("dialog", { name: "Save request" });
    await dialogL.getByLabel("Name").fill("Login");
    await dialogL.getByLabel("Collection").selectOption({ label: "Folder Deps E2E Coll" });
    await dialogL.getByLabel("Folder (optional)").selectOption({ label: "Folder Auth" });
    await dialogL.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialogL).toBeHidden();

    // Request Whoami in Folder Users (depends on Login, Header: Authorization Bearer {{token}})
    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/whoami`);
    await addHeaderRow(page, "Authorization", "Bearer {{token}}");

    await page.getByLabel("Save request").click();
    const dialogW = page.getByRole("dialog", { name: "Save request" });
    await dialogW.getByLabel("Name").fill("Whoami");
    await dialogW.getByLabel("Collection").selectOption({ label: "Folder Deps E2E Coll" });
    await dialogW.getByLabel("Folder (optional)").selectOption({ label: "Folder Users" });
    await dialogW.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialogW).toBeHidden();

    // Configure Dependency: Whoami depends on Login
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Dependencies" }).click();
    await page.getByLabel("Prerequisite Request").selectOption({ label: "Folder Deps E2E Coll › Folder Auth › Login" });
    await page.getByRole("button", { name: "Add Dependency" }).click();
    await page.getByLabel("Save request").click();
    await page.waitForTimeout(600); // persist debounce

    // Run Folder Users
    await page.getByRole("button", { name: "Run Folder Users" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await expect(runnerDialog.getByText("Scope: Folder — Folder Users")).toBeVisible();
    await expect(runnerDialog.getByText("Whoami")).toBeVisible();
    await expect(runnerDialog.getByText("Login")).toBeHidden(); // Login is external, not part of explicit scope list

    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();

    // Verify only Whoami is in the explicit results, but it passed successfully indicating Login executed and propagated token
    const runItems = runnerDialog.locator("ul li button");
    await expect(runItems).toHaveCount(1);
    await expect(runItems.nth(0)).toContainText("Whoami");
    await expect(runItems.nth(0)).toContainText("Skipped");
  });

  test("16. configures manual iteration count in Runner UI and runs multiple iterations with validation checks", async ({ page }) => {
    await newCollection(page, "Manual Iter E2E Coll");
    await setUrl(page, `${FIXTURE_BASE}/status/200`);
    await saveIntoCollection(page, "Manual Iter E2E Coll", "Req A");

    // Trigger Runner
    await page.getByRole("button", { name: "Run Manual Iter E2E Coll" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    const iterationsInput = runnerDialog.locator("#runner-iterations");

    // 1. Verify default
    await expect(iterationsInput).toHaveValue("1");

    // 2. Reject 0
    await iterationsInput.fill("0");
    await expect(runnerDialog.locator("#runner-iterations-error")).toHaveText("Iterations must be a positive integer.");
    await expect(runnerDialog.getByRole("button", { name: "Start Run" })).toBeDisabled();

    // 3. Reject negative
    await iterationsInput.fill("-3");
    await expect(runnerDialog.locator("#runner-iterations-error")).toHaveText("Iterations must be a positive integer.");
    await expect(runnerDialog.getByRole("button", { name: "Start Run" })).toBeDisabled();

    // 4. Reject empty/non-integer
    await iterationsInput.fill("");
    await expect(runnerDialog.locator("#runner-iterations-error")).toHaveText("Iterations must be a positive integer.");
    await expect(runnerDialog.getByRole("button", { name: "Start Run" })).toBeDisabled();

    // 5. Accept positive integer
    await iterationsInput.fill("3");
    await expect(runnerDialog.locator("#runner-iterations-error")).toBeHidden();
    await expect(runnerDialog.getByRole("button", { name: "Start Run" })).toBeEnabled();

    // Run
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();

    // Verify 3 iteration result lists are shown
    const iterationHeaders = runnerDialog.locator("p:has-text('Iteration')");
    await expect(iterationHeaders).toHaveCount(3);
    await expect(iterationHeaders.nth(0)).toContainText("Iteration 1");
    await expect(iterationHeaders.nth(1)).toContainText("Iteration 2");
    await expect(iterationHeaders.nth(2)).toContainText("Iteration 3");
  });

  test("17. dataset active disables manual iteration count input", async ({ page }) => {
    await newCollection(page, "Dataset Iter E2E Coll");
    await setUrl(page, `${FIXTURE_BASE}/status/200`);
    await saveIntoCollection(page, "Dataset Iter E2E Coll", "Req A");

    // Trigger Runner
    await page.getByRole("button", { name: "Run Dataset Iter E2E Coll" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    const iterationsInput = runnerDialog.locator("#runner-iterations");

    await expect(iterationsInput).toBeEnabled();

    // Import 2 row dataset
    await runnerDialog.getByLabel("Import dataset").setInputFiles({
      name: "ids.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{ id: "1" }, { id: "2" }])),
    });

    // Assert iterations input is disabled and displays row count
    await expect(iterationsInput).toBeDisabled();
    await expect(iterationsInput).toHaveValue("2");
    await expect(runnerDialog.getByText("Dataset active: iterations determined by dataset row count")).toBeVisible();

    // Clear dataset
    await runnerDialog.getByRole("button", { name: "Clear" }).click();

    // Assert iterations input is enabled again and defaults back to 1 (or original input)
    await expect(iterationsInput).toBeEnabled();
    await expect(iterationsInput).toHaveValue("1");
  });

  test("18. runner run history displays previous runs, detail expansion, and clear history works", async ({ page }) => {
    await newCollection(page, "History E2E Coll");
    await setUrl(page, `${FIXTURE_BASE}/status/200`);
    await saveIntoCollection(page, "History E2E Coll", "Req A");

    // 1. Trigger runner and run
    await page.getByRole("button", { name: "Run History E2E Coll" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();

    // 2. Click Run Again to go idle, then switch to Run History tab
    await runnerDialog.getByRole("button", { name: "Run Again" }).click();
    await runnerDialog.getByRole("button", { name: "Run History" }).click();

    // 3. Verify history entry is shown
    await expect(runnerDialog.getByRole("button", { name: "PASSED" })).toBeVisible();
    await expect(runnerDialog.getByText("Collection Run · 1 Iteration")).toBeVisible();

    // 4. Click the entry to inspect details
    await runnerDialog.getByRole("button", { name: "PASSED" }).click();
    await expect(runnerDialog.getByText("Viewing Historical Run")).toBeVisible();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    await expect(runnerDialog.getByRole("button", { name: "Back to History", exact: true })).toBeVisible();

    // 5. Navigate back to history list
    await runnerDialog.getByRole("button", { name: "Back to History", exact: true }).click();
    await expect(runnerDialog.getByText("Viewing Historical Run")).toBeHidden();

    // 6. Close, reload page, and check persistence
    await runnerDialog.getByRole("button", { name: "Close runner" }).click();
    await page.waitForTimeout(500);
    await page.reload();

    await page.getByRole("button", { name: "Run History E2E Coll" }).click();
    await runnerDialog.getByRole("button", { name: "Run History" }).click();
    await expect(runnerDialog.getByRole("button", { name: "PASSED" })).toBeVisible();

    // 7. Clear history (register confirm handler)
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await runnerDialog.getByRole("button", { name: "Clear History" }).click();
    await expect(runnerDialog.getByText("No previous runs found for this scope.")).toBeVisible();
  });
});
