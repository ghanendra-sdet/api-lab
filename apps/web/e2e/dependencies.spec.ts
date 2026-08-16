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

function requestPanelTab(page: Page, name: string) {
  return page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name });
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

async function waitForPersistDebounce(page: Page) {
  await page.waitForTimeout(600);
}

test.describe("Request Dependencies E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("configure request dependency, run chain with token propagation, and verify persistence on reload", async ({ page }) => {
    // 1. Create collection
    await createCollection(page, "Chain Coll");

    // 2. Configure LoginReq tab
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/login?username=ada`);
    
    // Add extraction on LoginReq
    await requestPanelTab(page, "Tests").click();
    await page.getByRole("button", { name: "+ Add Extraction" }).click();
    
    const extractionRow = page.locator("table", { has: page.locator("caption", { hasText: "Extractions" }) }).locator("tbody tr").last();
    await extractionRow.getByLabel("JSON path").fill("$.token");
    await extractionRow.getByLabel("Variable name").fill("token");
    
    // Save LoginReq
    await saveViaDialog(page, "LoginReq", "Chain Coll");
    await expect(sidebar(page).getByText("LoginReq", { exact: true })).toBeVisible();

    // 3. Open a new request tab
    await page.getByRole("button", { name: "New request tab" }).click();

    // Configure WhoamiReq tab
    await setUrl(page, `${FIXTURE_BASE}/whoami`);
    
    // Add header row resolving {{token}}
    await requestPanelTab(page, "Headers").click();
    await page.getByText("+ Add row").click();
    await page.getByLabel("Key", { exact: true }).last().fill("Authorization");
    await page.getByLabel("Value", { exact: true }).last().fill("Bearer {{token}}");
    
    // Save WhoamiReq
    await saveViaDialog(page, "WhoamiReq", "Chain Coll");
    await expect(sidebar(page).getByText("WhoamiReq", { exact: true })).toBeVisible();

    // 4. Configure dependency: WhoamiReq depends on LoginReq
    await requestPanelTab(page, "Dependencies").click();
    await page.getByLabel("Prerequisite Request").selectOption({ label: "Chain Coll › LoginReq" });
    await page.getByRole("button", { name: "Add Dependency" }).click();

    // Verify UI updates with Prerequisites list and Sequence preview
    await expect(page.getByRole("button", { name: "Remove dependency LoginReq" })).toBeVisible();
    await expect(page.locator("ol").getByText("LoginReq")).toBeVisible();
    await expect(page.locator("ol").getByText("WhoamiReq (Current)")).toBeVisible();

    // Save WhoamiReq to persist dependency
    await page.getByLabel("Save request").click();
    await waitForPersistDebounce(page);

    // 5. Send request: runs LoginReq first, extracts token, runs WhoamiReq with Bearer token
    await page.getByRole("button", { name: "Send" }).click();

    // Verify response contains echoed token
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText('"authorization": "Bearer tok-ada"');

    // 6. Reload and verify configuration persists
    await page.reload();
    await expect(sidebar(page).getByText("WhoamiReq", { exact: true })).toBeVisible();
    await sidebar(page).getByText("WhoamiReq", { exact: true }).click();
    
    await requestPanelTab(page, "Dependencies").click();
    await expect(page.getByRole("button", { name: "Remove dependency LoginReq" })).toBeVisible();
  });

  test("surfaces circular dependency errors in the UI and prevents saving", async ({ page }) => {
    await createCollection(page, "Circular Coll");

    // Create Request X
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Req X", "Circular Coll");

    // Open new tab & create Request Y
    await page.getByRole("button", { name: "New request tab" }).click();
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Req Y", "Circular Coll");

    // Make Y depend on X
    await requestPanelTab(page, "Dependencies").click();
    await page.getByLabel("Prerequisite Request").selectOption({ label: "Circular Coll › Req X" });
    await page.getByRole("button", { name: "Add Dependency" }).click();
    await page.getByLabel("Save request").click();
    await waitForPersistDebounce(page);

    // Click on X in sidebar, make X depend on Y
    await sidebar(page).getByText("Req X", { exact: true }).click();
    await requestPanelTab(page, "Dependencies").click();
    await page.getByLabel("Prerequisite Request").selectOption({ label: "Circular Coll › Req Y" });
    await page.getByRole("button", { name: "Add Dependency" }).click();

    // Verify circular warning displays
    await expect(page.getByRole("alert")).toContainText("Circular dependency detected");

    // Verify save fails
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Circular dependency detected");
      await dialog.dismiss();
    });
    await page.getByLabel("Save request").click();
  });
});
