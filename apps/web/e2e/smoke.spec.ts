import { test, expect, type Page } from "@playwright/test";

const FIXTURE_BASE = "http://localhost:4001";

function requestPanelTab(page: Page, name: string) {
  return page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name });
}

function responseSectionTab(page: Page, name: string) {
  return page.getByRole("tablist", { name: "Response section" }).getByRole("tab", { name });
}

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

test.describe("API Lab application shell", () => {
  test("loads and shows the core workspace areas", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("API Lab", { exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Collections sidebar" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Collections" })).toBeVisible();
    await expect(page.getByRole("main", { name: "Request workspace" })).toBeVisible();
    await expect(page.getByLabel("HTTP method")).toBeVisible();
    await expect(page.getByLabel("Request URL")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Response" })).toBeVisible();
    await expect(page.getByText("Send a request to see the response here.")).toBeVisible();
  });

  test("switching HTTP method updates the selector", async ({ page }) => {
    await page.goto("/");
    const methodSelect = page.getByLabel("HTTP method");
    await methodSelect.selectOption("POST");
    await expect(methodSelect).toHaveValue("POST");
  });

  test("switching request config panels shows the right panel", async ({ page }) => {
    await page.goto("/");
    await requestPanelTab(page, "Headers").click();
    await expect(page.getByRole("heading", { name: "Headers" })).toBeVisible();

    await requestPanelTab(page, "Body").click();
    await expect(page.getByText("This request does not have a body.")).toBeVisible();
  });

  test("theme toggle switches the document to dark mode", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);
    await page.getByRole("button", { name: /Switch to dark theme/ }).click();
    await expect(html).toHaveClass(/dark/);
  });
});

test.describe("Request execution", () => {
  test("GET request against the fixture server shows a real response", async ({ page }) => {
    await page.goto("/");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText('"method": "GET"');
  });

  test("query parameters are sent and echoed back", async ({ page }) => {
    await page.goto("/");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await requestPanelTab(page, "Params").click();
    await page.getByText("+ Add row").click();
    await page.getByLabel("Key", { exact: true }).last().fill("search");
    await page.getByLabel("Value", { exact: true }).last().fill("api-lab");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText('"search": "api-lab"');
  });

  test("custom headers are actually sent to the server", async ({ page }) => {
    await page.goto("/");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await requestPanelTab(page, "Headers").click();
    await page.getByText("+ Add row").click();
    await page.getByLabel("Key", { exact: true }).last().fill("x-request-id");
    await page.getByLabel("Value", { exact: true }).last().fill("test-abc-123");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText("test-abc-123");
  });

  test("POST with a JSON body is sent and echoed back", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await requestPanelTab(page, "Body").click();
    await page.getByRole("radio", { name: "raw" }).click();

    const editorContainer = page.locator(".monaco-editor").first();
    await editorContainer.locator(".view-lines").click();
    await expect(editorContainer).toHaveClass(/focused/);
    await page.keyboard.type('{"name":"API Lab"}', { delay: 20 });

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    // Monaco virtualizes long content, so switch to the plain-text Raw view
    // (not subject to viewport virtualization) to assert on body content that
    // may be scrolled out of view in the Pretty (Monaco) viewer.
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    await expect(page.getByRole("region", { name: "Response" }).locator("pre")).toContainText(
      '"name":"API Lab"',
    );
  });

  test("204 empty response is handled without crashing", async ({ page }) => {
    await page.goto("/");
    await setUrl(page, `${FIXTURE_BASE}/empty`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^204/)).toBeVisible();
    await expect(page.getByText("No response body.")).toBeVisible();
  });

  test("non-JSON text response is displayed as text", async ({ page }) => {
    await page.goto("/");
    await setUrl(page, `${FIXTURE_BASE}/text`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(page.getByText("Hello API Lab")).toBeVisible();
  });

  test("response headers tab shows real headers", async ({ page }) => {
    await page.goto("/");
    await setUrl(page, `${FIXTURE_BASE}/text`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    await responseSectionTab(page, "Headers").click();
    await expect(page.getByText("content-type")).toBeVisible();
  });

  test("invalid URL shows friendly validation and does not crash the app", async ({ page }) => {
    await page.goto("/");
    await setUrl(page, "not a url");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Please enter a valid HTTP or HTTPS URL.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("invalid JSON body is rejected before sending", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await requestPanelTab(page, "Body").click();
    await page.getByRole("radio", { name: "raw" }).click();

    const editorContainer = page.locator(".monaco-editor").first();
    await editorContainer.locator(".view-lines").click();
    await expect(editorContainer).toHaveClass(/focused/);
    await page.keyboard.type("{not valid json", { delay: 20 });

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Invalid JSON body/)).toBeVisible();
  });

  test("multiple tabs keep independent request state", async ({ page }) => {
    await page.goto("/");

    await setUrl(page, `${FIXTURE_BASE}/echo?tab=A`);
    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/echo?tab=B`);
    await page.getByLabel("HTTP method").selectOption("POST");

    await page.getByRole("tab", { name: /Users/ }).first().click();
    await expect(page.getByLabel("Request URL")).toHaveValue(`${FIXTURE_BASE}/echo?tab=A`);
    await expect(page.getByLabel("HTTP method")).toHaveValue("GET");
  });
});
