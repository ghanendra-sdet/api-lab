import { test, expect, type Page } from "@playwright/test";

const FIXTURE_BASE = "http://localhost:4001";

function requestPanelTab(page: Page, name: string) {
  return page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name });
}

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

function acceptDialog(page: Page, text?: string) {
  page.once("dialog", (dialog) => dialog.accept(text));
}

async function openEnvironmentManager(page: Page) {
  await page.getByLabel("Manage environments").click();
  const dialog = page.getByRole("dialog", { name: "Manage environments" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createEnvironment(page: Page, name: string) {
  const dialog = await openEnvironmentManager(page);
  acceptDialog(page, name);
  await dialog.getByRole("button", { name: "New Environment" }).click();
  await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible();
  return dialog;
}

async function addVariable(
  dialog: import("@playwright/test").Locator,
  key: string,
  value: string,
  options: { secret?: boolean } = {},
) {
  await dialog.getByRole("button", { name: "+ Add variable" }).click();
  const row = dialog.locator("tbody tr").last();
  await row.getByLabel("Key", { exact: true }).fill(key);
  await row.getByLabel("Value", { exact: true }).fill(value);
  if (options.secret) {
    await row.getByLabel(`Mark ${key} as secret`).check();
  }
}

async function selectEnvironment(page: Page, name: string) {
  await page.getByLabel("Environment", { exact: true }).selectOption({ label: name });
}

test.describe("Request History E2E Workflows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Ensure we start with clear history in localStorage
    await page.evaluate(() => localStorage.removeItem("api-lab-request-history"));
    await page.reload();
  });

  test("Scenario 1 & 2: Request execution adds item to history with correct details", async ({ page }) => {
    // 1. Send a successful request
    await setUrl(page, `${FIXTURE_BASE}/text`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    // 2. Switch to History tab
    await page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: "History" }).click();

    // 3. Verify the request appears with method, path, and status code
    const historyItem = page.getByRole("button", { name: /Re-open GET request to/ });
    await expect(historyItem).toBeVisible();
    await expect(historyItem.getByText("GET")).toBeVisible();
    await expect(historyItem.getByText("/text")).toBeVisible();
    await expect(historyItem.getByText("200")).toBeVisible();
    
    // Verify timestamp exists (matches hh:mm:ss format)
    const timestampText = await historyItem.locator("div.pl-11").textContent();
    expect(timestampText).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test("Scenario 3: Restoring request configuration from a history item", async ({ page }) => {
    // Setup environment containing the secret token
    const CANARY = "API-LAB-SECRET-CANARY";
    const envDialog = await createEnvironment(page, "Secret Env");
    await addVariable(envDialog, "secretToken", CANARY, { secret: true });
    await envDialog.getByRole("button", { name: "Close environment manager" }).click();
    await selectEnvironment(page, "Secret Env");

    // Setup a request with custom method, url containing template variables, params, headers and body
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/echo?token={{secretToken}}&param=123`);

    // Add a custom header
    await requestPanelTab(page, "Headers").click();
    await page.getByText("+ Add row").click();
    await page.getByLabel("Key", { exact: true }).last().fill("x-history-test");
    await page.getByLabel("Value", { exact: true }).last().fill("hello-history");

    // Add a request body
    await requestPanelTab(page, "Body").click();
    await page.getByRole("radio", { name: "raw" }).click();
    const editorContainer = page.locator(".monaco-editor").first();
    await editorContainer.locator(".view-lines").click();
    await page.keyboard.type('{"test":"history"}', { delay: 20 });

    // Send it
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    // Reset the active tab state by changing to GET and changing URL
    await page.getByLabel("HTTP method").selectOption("GET");
    await setUrl(page, `${FIXTURE_BASE}/text`);

    // Switch to History
    await page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: "History" }).click();

    // Click the history item
    const historyItem = page.getByRole("button", { name: /Re-open POST request to/ });
    await expect(historyItem).toBeVisible();
    
    // Safety check: The UI must display the unresolved template, NOT the resolved secret
    // (Ensure the CANARY is never rendered in the UI list or saved config)
    const historyTextContent = await page.getByRole("navigation", { name: "Collections" }).textContent();
    expect(historyTextContent).not.toContain(CANARY);
    expect(historyTextContent).toContain("{{secretToken}}");

    await historyItem.click();

    // Verify request configuration is restored properly
    await expect(page.getByLabel("HTTP method")).toHaveValue("POST");
    await expect(page.getByLabel("Request URL")).toHaveValue(`${FIXTURE_BASE}/echo?token={{secretToken}}&param=123`);

    // Verify header is restored
    await requestPanelTab(page, "Headers").click();
    await expect(page.getByLabel("Key", { exact: true }).last()).toHaveValue("x-history-test");
    await expect(page.getByLabel("Value", { exact: true }).last()).toHaveValue("hello-history");

    // Verify body is restored
    await requestPanelTab(page, "Body").click();
    const restoredEditorContainer = page.locator(".monaco-editor").first();
    await expect(restoredEditorContainer).toContainText('"test":"history"');
  });

  test("Scenario 4: Request history survives reload", async ({ page }) => {
    // Send a request
    await setUrl(page, `${FIXTURE_BASE}/text`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    // Wait for the debounced write to localStorage (DEBOUNCE_MS = 400ms)
    await page.waitForTimeout(500);

    // Reload the browser
    await page.reload();

    // Switch to history tab
    await page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: "History" }).click();

    // Verify request is still present
    await expect(page.getByRole("button", { name: /Re-open GET request to/ })).toBeVisible();
  });

  test("Scenario 5: Clearing the history", async ({ page }) => {
    // Send a request to populate history
    await setUrl(page, `${FIXTURE_BASE}/text`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    // Switch to history tab
    await page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /Re-open GET request to/ })).toBeVisible();

    // Click Clear All
    await page.getByRole("button", { name: "Clear All" }).click();

    // Verify history is empty
    await expect(page.getByText("No requests executed yet.")).toBeVisible();

    // Reload browser and verify it remains empty
    await page.reload();
    await page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: "History" }).click();
    await expect(page.getByText("No requests executed yet.")).toBeVisible();
  });

  test("Scenario 6: Failed request (network failure) is not stored in history", async ({ page }) => {
    // Try sending to a totally invalid network address
    await setUrl(page, "http://invalid.localhost.fake/does-not-exist");
    await page.getByRole("button", { name: "Send" }).click();
    // Verify it fails
    await expect(page.getByText("Request failed")).toBeVisible();

    // Switch to History tab
    await page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: "History" }).click();

    // Verify history remains empty
    await expect(page.getByText("No requests executed yet.")).toBeVisible();
  });

  test("Scenario 7: Cancelled request is not stored in history", async ({ page }) => {
    // Trigger a delayed request
    await setUrl(page, `${FIXTURE_BASE}/delay/2000`);
    await page.getByRole("button", { name: "Send" }).click();

    // Immediately click Cancel
    await page.getByRole("button", { name: "Cancel" }).click();

    // Verify it was cancelled
    await expect(page.getByText("Request was cancelled.")).toBeVisible();

    // Switch to History tab
    await page.getByRole("navigation", { name: "Collections" }).getByRole("button", { name: "History" }).click();

    // Verify history remains empty
    await expect(page.getByText("No requests executed yet.")).toBeVisible();
  });
});
