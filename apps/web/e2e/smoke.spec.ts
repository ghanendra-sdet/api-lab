import { test, expect } from "@playwright/test";

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
    await page.getByRole("tab", { name: "Headers" }).click();
    await expect(page.getByRole("heading", { name: "Headers" })).toBeVisible();

    await page.getByRole("tab", { name: "Body" }).click();
    await expect(page.getByText("This request does not have a body.")).toBeVisible();
  });

  test("clicking Send shows the not-yet-available notice instead of a fake response", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Request execution isn't available yet/)).toBeVisible();
  });

  test("theme toggle switches the document to dark mode", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);
    await page.getByRole("button", { name: /Switch to dark theme/ }).click();
    await expect(html).toHaveClass(/dark/);
  });
});
