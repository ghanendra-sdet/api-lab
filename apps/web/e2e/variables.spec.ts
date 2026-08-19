import { test, expect, type Page, type Locator } from "@playwright/test";

const FIXTURE_BASE = "http://localhost:4001";

function acceptDialog(page: Page, text?: string) {
  page.once("dialog", (dialog) => dialog.accept(text));
}

function sidebar(page: Page): Locator {
  return page.getByRole("navigation", { name: "Collections" });
}

async function createCollection(page: Page, name: string) {
  acceptDialog(page, name);
  await page.getByRole("button", { name: "New Collection" }).click();
  await expect(sidebar(page).getByText(name, { exact: true })).toBeVisible();
}

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

async function selectEnvironment(page: Page, name: string) {
  await page.getByLabel("Environment", { exact: true }).selectOption({ label: name });
}

async function openAuthTab(page: Page) {
  await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Authorization" }).click();
}

async function selectAuthType(page: Page, label: string) {
  await page.getByLabel("Authorization Type").selectOption({ label });
}

async function saveViaDialog(page: Page, name: string, collectionLabel: string) {
  await page.getByLabel("Save request").click();
  const dialog = page.getByRole("dialog", { name: "Save request" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Collection").selectOption({ label: collectionLabel });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function saveViaDialogInFolder(page: Page, name: string, collectionLabel: string, folderLabel: string) {
  await page.getByLabel("Save request").click();
  const dialog = page.getByRole("dialog", { name: "Save request" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Collection").selectOption({ label: collectionLabel });
  await dialog.getByLabel("Folder (optional)").selectOption({ label: folderLabel });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function rawResponseText(page: Page) {
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  return page.getByRole("region", { name: "Response" }).locator("pre");
}

async function waitForPersistDebounce(page: Page) {
  await page.waitForTimeout(600);
}

test.describe("D.1 Advanced Variable Scopes & Auth Inheritance E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("1. Global variables CRUD, persistence, and reload", async ({ page }) => {
    // Open Global Variables manager
    await page.getByLabel("Manage global variables").click();
    const dialog = page.getByRole("dialog", { name: "Manage global variables" });
    await expect(dialog).toBeVisible();

    // Create a global variable
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    const row = dialog.locator("tbody tr").last();
    await row.getByLabel("Key", { exact: true }).fill("testGlobal");
    await row.getByLabel("Value", { exact: true }).fill("val-global");

    // Close manager
    await dialog.getByRole("button", { name: "Close global variables manager" }).click();

    // Reload the application and verify it persists
    await waitForPersistDebounce(page);
    await page.reload();

    await page.getByLabel("Manage global variables").click();
    const reopened = page.getByRole("dialog", { name: "Manage global variables" });
    await expect(reopened.locator("tbody tr").getByLabel("Key")).toHaveValue("testGlobal");
    await expect(reopened.locator("tbody tr").getByLabel("Value")).toHaveValue("val-global");
    await reopened.getByRole("button", { name: "Close global variables manager" }).click();
  });

  test("2. Collection variables and auth CRUD, persistence, and reload", async ({ page }) => {
    await createCollection(page, "Coll Test");

    // Open Collection Settings
    await page.getByLabel("Settings for Coll Test").click();
    const dialog = page.getByRole("dialog", { name: /Collection Settings: Coll Test/i });
    await expect(dialog).toBeVisible();

    // Configure a collection variable
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    const row = dialog.locator("tbody tr").last();
    await row.getByLabel("Key", { exact: true }).fill("testColVar");
    await row.getByLabel("Value", { exact: true }).fill("val-col");

    // Configure collection authentication (verify inherit is NOT present)
    await dialog.getByRole("button", { name: "Authentication" }).click();
    const authTypeSelect = dialog.getByLabel("Authorization Type");
    await expect(authTypeSelect.locator("option", { hasText: "Inherit from parent" })).toHaveCount(0);

    await authTypeSelect.selectOption({ label: "Bearer Token" });
    await dialog.getByLabel("Token").fill("col-token-123");

    // Save
    await dialog.getByRole("button", { name: "Save" }).click();

    // Reload and verify persistence
    await waitForPersistDebounce(page);
    await page.reload();

    await page.getByLabel("Settings for Coll Test").click();
    const reopened = page.getByRole("dialog", { name: /Collection Settings: Coll Test/i });
    await expect(reopened.locator("tbody tr").getByLabel("Key")).toHaveValue("testColVar");

    await reopened.getByRole("button", { name: "Authentication" }).click();
    await expect(reopened.getByLabel("Authorization Type")).toHaveValue("bearer");
    await expect(reopened.getByLabel("Token")).toHaveValue("col-token-123");

    await reopened.getByRole("button", { name: "Cancel" }).click();
  });

  test("3. Folder variables and auth inheritance CRUD, persistence, and reload", async ({ page }) => {
    await createCollection(page, "Coll Folder Test");
    acceptDialog(page, "Folder A");
    await page.getByRole("button", { name: "New folder in Coll Folder Test" }).click();

    // Open Folder Settings
    await page.getByLabel("Settings for Folder A").click();
    const dialog = page.getByRole("dialog", { name: /Folder Settings: Folder A/i });
    await expect(dialog).toBeVisible();

    // Configure a folder variable
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    const row = dialog.locator("tbody tr").last();
    await row.getByLabel("Key", { exact: true }).fill("testFolVar");
    await row.getByLabel("Value", { exact: true }).fill("val-fol");

    // Configure folder authentication (verify inherit IS present)
    await dialog.getByRole("button", { name: "Authentication" }).click();
    const authSelect = dialog.getByLabel("Authorization Type");
    await expect(authSelect.locator("option", { hasText: "Inherit from parent" })).toHaveCount(1);
    await authSelect.selectOption({ label: "Inherit from parent" });

    // Save
    await dialog.getByRole("button", { name: "Save" }).click();

    // Reload and verify persistence
    await waitForPersistDebounce(page);
    await page.reload();

    await page.getByLabel("Settings for Folder A").click();
    const reopened = page.getByRole("dialog", { name: /Folder Settings: Folder A/i });
    await expect(reopened.locator("tbody tr").getByLabel("Key")).toHaveValue("testFolVar");

    await reopened.getByRole("button", { name: "Authentication" }).click();
    await expect(reopened.getByLabel("Authorization Type")).toHaveValue("inherit");

    await reopened.getByRole("button", { name: "Cancel" }).click();
  });

  test("4. Request local variables CRUD, persistence, reload, and execution", async ({ page }) => {
    // Navigate to Variables Tab
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Variables" }).click();

    // Add a request-local variable
    await page.getByRole("button", { name: "+ Add variable" }).click();
    const row = page.locator("[data-testid='variables-panel'] tbody tr").last();
    await row.getByLabel("Key", { exact: true }).fill("testReqVar");
    await row.getByLabel("Value", { exact: true }).fill("val-req");

    // Save request
    await createCollection(page, "Save Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo?val={{testReqVar}}`);
    await saveViaDialog(page, "Req Var Test", "Save Coll");

    // Reload and verify persistence
    await waitForPersistDebounce(page);
    await page.reload();

    await sidebar(page).getByText("Req Var Test", { exact: true }).click();
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Variables" }).click();
    await expect(page.locator("[data-testid='variables-panel'] tbody tr").first().getByLabel("Key")).toHaveValue("testReqVar");
    await expect(page.locator("[data-testid='variables-panel'] tbody tr").first().getByLabel("Value")).toHaveValue("val-req");

    // Execute the request and verify the resolved variable reached mock server
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText('"val":"val-req"');
  });

  test("5. Hierarchical variable resolution precedence", async ({ page }) => {
    // 1. Create collection with variable "resolveMe" = "col-level"
    await createCollection(page, "Precedence Coll");
    await page.getByLabel("Settings for Precedence Coll").click();
    let dialog = page.getByRole("dialog", { name: /Collection Settings: Precedence Coll/i });
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    await dialog.locator("tbody tr").last().getByLabel("Key", { exact: true }).fill("resolveMe");
    await dialog.locator("tbody tr").last().getByLabel("Value", { exact: true }).fill("col-level");
    await dialog.getByRole("button", { name: "Save" }).click();

    // 2. Create folder with variable "resolveMe" = "fol-level"
    acceptDialog(page, "Precedence Folder");
    await page.getByRole("button", { name: "New folder in Precedence Coll" }).click();
    await page.getByLabel("Settings for Precedence Folder").click();
    dialog = page.getByRole("dialog", { name: /Folder Settings: Precedence Folder/i });
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    await dialog.locator("tbody tr").last().getByLabel("Key", { exact: true }).fill("resolveMe");
    await dialog.locator("tbody tr").last().getByLabel("Value", { exact: true }).fill("fol-level");
    await dialog.getByRole("button", { name: "Save" }).click();

    // 3. Create active environment with variable "resolveMe" = "env-level"
    await page.getByLabel("Manage environments").click();
    dialog = page.getByRole("dialog", { name: "Manage environments" });
    acceptDialog(page, "Precedence Env");
    await dialog.getByRole("button", { name: "New Environment" }).click();
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    await dialog.locator("tbody tr").last().getByLabel("Key", { exact: true }).fill("resolveMe");
    await dialog.locator("tbody tr").last().getByLabel("Value", { exact: true }).fill("env-level");
    await dialog.getByRole("button", { name: "Close environment manager" }).click();
    await selectEnvironment(page, "Precedence Env");

    // 4. Create global variable "resolveMe" = "global-level"
    await page.getByLabel("Manage global variables").click();
    dialog = page.getByRole("dialog", { name: "Manage global variables" });
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    await dialog.locator("tbody tr").last().getByLabel("Key", { exact: true }).fill("resolveMe");
    await dialog.locator("tbody tr").last().getByLabel("Value", { exact: true }).fill("global-level");
    await dialog.getByRole("button", { name: "Close global variables manager" }).click();

    // 5. Create request in folder
    await setUrl(page, `${FIXTURE_BASE}/echo?val={{resolveMe}}`);
    await saveViaDialogInFolder(page, "Precedence Req", "Precedence Coll", "Precedence Folder");

    // 6. Test Request-local override "resolveMe" = "req-level" (highest precedence)
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Variables" }).click();
    await page.getByRole("button", { name: "+ Add variable" }).click();
    await page.locator("[data-testid='variables-panel'] tbody tr").last().getByLabel("Key", { exact: true }).fill("resolveMe");
    await page.locator("[data-testid='variables-panel'] tbody tr").last().getByLabel("Value", { exact: true }).fill("req-level");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    let rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText('"val":"req-level"');

    // 7. Remove request override -> Folder-level should win
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Variables" }).click();
    await page.locator("[data-testid='variables-panel'] tbody tr").last().getByRole("button", { name: "Delete variable resolveMe" }).click();

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText('"val":"fol-level"');

    // 8. Remove folder-level variable -> Collection-level should win
    await page.getByLabel("Settings for Precedence Folder").click();
    dialog = page.getByRole("dialog", { name: /Folder Settings: Precedence Folder/i });
    await dialog.locator("tbody tr").last().getByRole("button", { name: "Delete variable resolveMe" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText('"val":"col-level"');

    // 9. Remove collection-level variable -> Environment-level should win
    await page.getByLabel("Settings for Precedence Coll").click();
    dialog = page.getByRole("dialog", { name: /Collection Settings: Precedence Coll/i });
    await dialog.locator("tbody tr").last().getByRole("button", { name: "Delete variable resolveMe" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText('"val":"env-level"');

    // 10. Remove environment variable -> Global-level should win
    await page.getByLabel("Manage environments").click();
    dialog = page.getByRole("dialog", { name: "Manage environments" });
    await dialog.getByRole("button", { name: "Precedence Env", exact: true }).click();
    await dialog.locator("tbody tr").last().getByRole("button", { name: "Delete variable resolveMe" }).click();
    await dialog.getByRole("button", { name: "Close environment manager" }).click();

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText('"val":"global-level"');
  });

  test("6. Authentication inheritance resolution and override", async ({ page }) => {
    // 1. Configure Collection auth = Basic Auth (col-user:col-pass)
    await createCollection(page, "Auth Inh Coll");
    await page.getByLabel("Settings for Auth Inh Coll").click();
    let dialog = page.getByRole("dialog", { name: /Collection Settings: Auth Inh Coll/i });
    await dialog.getByRole("button", { name: "Authentication" }).click();
    await dialog.getByLabel("Authorization Type").selectOption({ label: "Basic Auth" });
    await dialog.getByLabel("Username").fill("col-user");
    await dialog.getByLabel("Password").fill("col-pass");
    await dialog.getByRole("button", { name: "Save" }).click();

    // 2. Create Folder inheriting from collection
    acceptDialog(page, "Auth Inh Folder");
    await page.getByRole("button", { name: "New folder in Auth Inh Coll" }).click();
    await page.getByLabel("Settings for Auth Inh Folder").click();
    dialog = page.getByRole("dialog", { name: /Folder Settings: Auth Inh Folder/i });
    await dialog.getByRole("button", { name: "Authentication" }).click();
    await expect(dialog.getByLabel("Authorization Type")).toHaveValue("inherit");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // 3. Save request in folder inheriting auth
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialogInFolder(page, "Inherited Req", "Auth Inh Coll", "Auth Inh Folder");

    // 4. Verify request auth panel defaults to inherit and displays collection auth details
    await openAuthTab(page);
    await expect(page.getByLabel("Authorization Type")).toHaveValue("inherit");
    await expect(page.getByText('↳ Inherited from collection "Auth Inh Coll" (Basic Auth)')).toBeVisible();

    // 5. Send request and verify collection basic auth header
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    let rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText(`Basic ${btoa("col-user:col-pass")}`);

    // 6. Override folder auth = Bearer folder-token
    await page.getByLabel("Settings for Auth Inh Folder").click();
    dialog = page.getByRole("dialog", { name: /Folder Settings: Auth Inh Folder/i });
    await dialog.getByRole("button", { name: "Authentication" }).click();
    await dialog.getByLabel("Authorization Type").selectOption({ label: "Bearer Token" });
    await dialog.getByLabel("Token").fill("folder-bearer-secret");
    await dialog.getByRole("button", { name: "Save" }).click();

    // 7. Verify request now inherits folder bearer token
    await sidebar(page).getByText("Inherited Req", { exact: true }).click();
    await openAuthTab(page);
    await expect(page.getByText('↳ Inherited from folder "Auth Inh Folder" (Bearer Token)')).toBeVisible();

    // 8. Send request and verify folder bearer token wins
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText("Bearer folder-bearer-secret");

    // 9. Override request auth = none (No Auth)
    await selectAuthType(page, "No Auth");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    rawRes = await rawResponseText(page);
    await expect(rawRes).not.toContainText("Authorization");
  });
});
