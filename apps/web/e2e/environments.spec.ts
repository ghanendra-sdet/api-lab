import { test, expect, type Page } from "@playwright/test";

const FIXTURE_BASE = "http://localhost:4001";

function acceptDialog(page: Page, text?: string) {
  page.once("dialog", (dialog) => dialog.accept(text));
}

async function openManager(page: Page) {
  await page.getByLabel("Manage environments").click();
  const dialog = page.getByRole("dialog", { name: "Manage environments" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createEnvironmentInManager(page: Page, name: string) {
  const dialog = await openManager(page);
  acceptDialog(page, name);
  await dialog.getByRole("button", { name: "New Environment" }).click();
  await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible();
  return dialog;
}

async function addVariableInManager(
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

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

async function selectEnvironment(page: Page, name: string) {
  await page.getByLabel("Environment", { exact: true }).selectOption({ label: name });
}

test.describe("Environments & variables", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("create environment", async ({ page }) => {
    const dialog = await createEnvironmentInManager(page, "Development");
    await expect(dialog.getByRole("button", { name: "Development", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close environment manager" }).click();
    await expect(page.getByLabel("Environment", { exact: true }).locator("option", { hasText: "Development" })).toHaveCount(1);
  });

  test("add variables", async ({ page }) => {
    const dialog = await createEnvironmentInManager(page, "Dev");
    await addVariableInManager(dialog, "baseUrl", FIXTURE_BASE);
    await addVariableInManager(dialog, "userId", "123");

    const rows = dialog.locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByLabel("Key")).toHaveValue("baseUrl");
    await expect(rows.nth(1).getByLabel("Key")).toHaveValue("userId");
  });

  test("resolve URL and send a real request", async ({ page }) => {
    const dialog = await createEnvironmentInManager(page, "Dev");
    await addVariableInManager(dialog, "baseUrl", FIXTURE_BASE);
    await dialog.getByRole("button", { name: "Close environment manager" }).click();
    await selectEnvironment(page, "Dev");

    await setUrl(page, "{{baseUrl}}/echo");
    await expect(page.getByText(`Resolved: ${FIXTURE_BASE}/echo`)).toBeVisible();

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText('"method": "GET"');
  });

  test("header variable is resolved and sent", async ({ page }) => {
    const dialog = await createEnvironmentInManager(page, "Dev");
    await addVariableInManager(dialog, "baseUrl", FIXTURE_BASE);
    await addVariableInManager(dialog, "token", "test-token-abc");
    await dialog.getByRole("button", { name: "Close environment manager" }).click();
    await selectEnvironment(page, "Dev");

    await setUrl(page, "{{baseUrl}}/echo");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Headers" }).click();
    await page.getByText("+ Add row").click();
    await page.getByLabel("Key", { exact: true }).last().fill("X-Token");
    await page.getByLabel("Value", { exact: true }).last().fill("{{token}}");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText("test-token-abc");
  });

  test("body variable is resolved and sent", async ({ page }) => {
    const dialog = await createEnvironmentInManager(page, "Dev");
    await addVariableInManager(dialog, "baseUrl", FIXTURE_BASE);
    await addVariableInManager(dialog, "userId", "456");
    await dialog.getByRole("button", { name: "Close environment manager" }).click();
    await selectEnvironment(page, "Dev");

    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, "{{baseUrl}}/echo");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Body" }).click();
    await page.getByRole("radio", { name: "raw" }).click();

    const editorContainer = page.locator(".monaco-editor").first();
    await editorContainer.locator(".view-lines").click();
    await page.keyboard.type('{"id":"{{userId}}"}', { delay: 20 });

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    await expect(page.getByRole("region", { name: "Response" }).locator("pre")).toContainText('"id":"456"');
  });

  test("switching environments changes which value resolves", async ({ page }) => {
    const devDialog = await createEnvironmentInManager(page, "Development");
    await addVariableInManager(devDialog, "baseUrl", "https://dev.example.com");
    acceptDialog(page, "Testing");
    await devDialog.getByRole("button", { name: "New Environment" }).click();
    await addVariableInManager(devDialog, "baseUrl", "https://test.example.com");
    await devDialog.getByRole("button", { name: "Close environment manager" }).click();

    await setUrl(page, "{{baseUrl}}/users");

    await selectEnvironment(page, "Development");
    await expect(page.getByText("Resolved: https://dev.example.com/users")).toBeVisible();

    await selectEnvironment(page, "Testing");
    await expect(page.getByText("Resolved: https://test.example.com/users")).toBeVisible();
  });

  test("environments and variables persist across a real browser reload", async ({ page }) => {
    const dialog = await createEnvironmentInManager(page, "Persisted Env");
    await addVariableInManager(dialog, "baseUrl", FIXTURE_BASE);
    await dialog.getByRole("button", { name: "Close environment manager" }).click();

    await page.waitForTimeout(500);
    await page.reload();

    await expect(page.getByLabel("Environment", { exact: true }).locator("option", { hasText: "Persisted Env" })).toHaveCount(1);
    await page.getByLabel("Manage environments").click();
    const reopened = page.getByRole("dialog", { name: "Manage environments" });
    await reopened.getByRole("button", { name: "Persisted Env", exact: true }).click();
    await expect(reopened.locator("tbody tr").getByLabel("Key")).toHaveValue("baseUrl");
  });

  test("unknown variable blocks send with a clear error", async ({ page }) => {
    await setUrl(page, "{{doesNotExist}}/users");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("alert")).toContainText("Unresolved variable");
    await expect(page.getByRole("alert")).toContainText("doesNotExist");
  });

  test("secret variables are masked in the manager and in the resolved preview", async ({ page }) => {
    const dialog = await createEnvironmentInManager(page, "Dev");
    await addVariableInManager(dialog, "token", "super-secret-value", { secret: true });

    const valueInput = dialog.locator("tbody tr").last().getByLabel("Value", { exact: true });
    await expect(valueInput).toHaveAttribute("type", "password");
    await dialog.locator("tbody tr").last().getByRole("button", { name: /Show value/ }).click();
    await expect(valueInput).toHaveAttribute("type", "text");

    await dialog.getByRole("button", { name: "Close environment manager" }).click();
    await selectEnvironment(page, "Dev");
    await setUrl(page, "https://example.com/{{token}}");
    await expect(page.locator("text=Resolved:")).not.toContainText("super-secret-value");
  });
});
