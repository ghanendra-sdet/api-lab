import { test, expect, type Page } from "@playwright/test";

const FIXTURE_BASE = "http://localhost:4001";

function acceptDialog(page: Page, text?: string) {
  page.once("dialog", (dialog) => dialog.accept(text));
}

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

async function openAuthTab(page: Page) {
  await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Authorization" }).click();
}

async function selectAuthType(page: Page, label: string) {
  await page.getByLabel("Authorization Type").selectOption({ label });
}

/** Monaco virtualizes long content in the Pretty viewer, so full-text
 * response assertions use the plain-text Raw view instead — same pattern
 * as smoke.spec.ts's POST-JSON-body test. */
async function rawResponseText(page: Page) {
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  return page.getByRole("region", { name: "Response" }).locator("pre");
}

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("No Auth sends the request unmodified", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const raw1 = await rawResponseText(page);
    await expect(raw1).toContainText('"method":"GET"');
  });

  test("API Key auth adds the configured header", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openAuthTab(page);
    await selectAuthType(page, "API Key");
    await page.getByLabel("Key").fill("X-API-Key");
    await page.getByLabel("Value").fill("my-api-key-value");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const raw2 = await rawResponseText(page);
    await expect(raw2).toContainText("my-api-key-value");
  });

  test("API Key auth (query) adds the configured query parameter", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openAuthTab(page);
    await selectAuthType(page, "API Key");
    await page.getByLabel("Key").fill("api_key");
    await page.getByLabel("Value").fill("query-key-value");
    await page.getByLabel("Add to").selectOption("query");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const raw3 = await rawResponseText(page);
    await expect(raw3).toContainText("query-key-value");
  });

  test("Basic auth sends a correctly encoded Authorization header", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openAuthTab(page);
    await selectAuthType(page, "Basic Auth");
    await page.getByLabel("Username").fill("alice");
    await page.getByLabel("Password").fill("wonderland");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const expected = `Basic ${btoa("alice:wonderland")}`;
    const raw4 = await rawResponseText(page);
    await expect(raw4).toContainText(expected);
  });

  test("Bearer token sends the Authorization header", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openAuthTab(page);
    await selectAuthType(page, "Bearer Token");
    await page.getByLabel("Token").fill("my-bearer-token");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const raw5 = await rawResponseText(page);
    await expect(raw5).toContainText("Bearer my-bearer-token");
  });

  test("JWT Bearer sends the Authorization header the same way as Bearer", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openAuthTab(page);
    await selectAuthType(page, "JWT Bearer");
    await page.getByLabel("JWT Token").fill("my-jwt-token");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const raw6 = await rawResponseText(page);
    await expect(raw6).toContainText("Bearer my-jwt-token");
  });

  test("environment switch changes the resolved bearer token without editing the saved request", async ({ page }) => {
    await page.getByLabel("Manage environments").click();
    const dialog = page.getByRole("dialog", { name: "Manage environments" });
    acceptDialog(page, "Development");
    await dialog.getByRole("button", { name: "New Environment" }).click();
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    let row = dialog.locator("tbody tr").last();
    await row.getByLabel("Key", { exact: true }).fill("token");
    await row.getByLabel("Value", { exact: true }).fill("dev-token");

    acceptDialog(page, "Testing");
    await dialog.getByRole("button", { name: "New Environment" }).click();
    await dialog.getByRole("button", { name: "+ Add variable" }).click();
    row = dialog.locator("tbody tr").last();
    await row.getByLabel("Key", { exact: true }).fill("token");
    await row.getByLabel("Value", { exact: true }).fill("test-token");
    await dialog.getByRole("button", { name: "Close environment manager" }).click();

    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openAuthTab(page);
    await selectAuthType(page, "Bearer Token");
    await page.getByLabel("Token").fill("{{token}}");

    await page.getByLabel("Environment", { exact: true }).selectOption({ label: "Development" });
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const rawDev = await rawResponseText(page);
    await expect(rawDev).toContainText("Bearer dev-token");

    await page.getByLabel("Environment", { exact: true }).selectOption({ label: "Testing" });
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const rawTest = await rawResponseText(page);
    await expect(rawTest).toContainText("Bearer test-token");
  });

  test("authorization configuration persists across a real browser reload", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openAuthTab(page);
    await selectAuthType(page, "Bearer Token");
    await page.getByLabel("Token").fill("persisted-token");

    await page.waitForTimeout(500);
    await page.reload();

    await openAuthTab(page);
    await expect(page.getByLabel("Token")).toHaveValue("persisted-token");
  });

  test("secret auth fields are masked by default", async ({ page }) => {
    await openAuthTab(page);
    await selectAuthType(page, "Bearer Token");
    const tokenInput = page.getByLabel("Token");
    await tokenInput.fill("super-secret-token");
    await expect(tokenInput).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show values" }).click();
    await expect(tokenInput).toHaveAttribute("type", "text");
  });

  test("manually typed Authorization header is overridden by the auth configuration", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Headers" }).click();
    await page.getByText("+ Add row").click();
    await page.getByLabel("Key", { exact: true }).last().fill("Authorization");
    await page.getByLabel("Value", { exact: true }).last().fill("manually-typed-value");

    await openAuthTab(page);
    await selectAuthType(page, "Bearer Token");
    await page.getByLabel("Token").fill("real-token");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const rawOverride = await rawResponseText(page);
    await expect(rawOverride).toContainText("Bearer real-token");
    await expect(rawOverride).not.toContainText("manually-typed-value");
  });

  test("OAuth 2.0 is an honest placeholder — blocks send with a clear message", async ({ page }) => {
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openAuthTab(page);
    await selectAuthType(page, "OAuth 2.0");
    await expect(page.getByText(/OAuth 2\.0 support is planned/)).toBeVisible();

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("alert")).toContainText(/planned/i);
  });
});
