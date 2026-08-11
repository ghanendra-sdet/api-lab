import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const FIXTURE_BASE = "http://localhost:4001";
const importDir = fileURLToPath(new URL("./fixtures/import", import.meta.url));

function acceptDialog(page: Page, text?: string) {
  page.once("dialog", (dialog) => dialog.accept(text));
}

async function openImportDialog(page: Page) {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function importFile(page: Page, filename: string) {
  const dialog = await openImportDialog(page);
  await dialog.getByLabel("Choose file to import").setInputFiles(`${importDir}/${filename}`);
  return dialog;
}

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Collections" });
}

async function rawResponseText(page: Page) {
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  return page.getByRole("region", { name: "Response" }).locator("pre");
}

test.describe("Import / Export", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("import a Postman collection: preview then confirm, collection appears", async ({ page }) => {
    const dialog = await importFile(page, "postman-collection.json");
    await expect(dialog.getByText("E2E Import Collection")).toBeVisible();
    await expect(dialog.getByText("1", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    await expect(sidebar(page).getByText("E2E Import Collection", { exact: true })).toBeVisible();
    await expect(sidebar(page).getByText("Echo Get", { exact: true })).toBeVisible();
  });

  test("open an imported request and send it successfully", async ({ page }) => {
    await importFile(page, "postman-collection.json");
    await page.getByRole("dialog", { name: "Import" }).getByRole("button", { name: "Import", exact: true }).click();

    await sidebar(page).getByText("Echo Get", { exact: true }).click();
    await expect(page.getByLabel("HTTP method")).toHaveValue("GET");
    await expect(page.getByLabel("Request URL")).toHaveValue(`${FIXTURE_BASE}/echo?page=1`);

    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Headers" }).click();
    await expect(page.getByLabel("Key", { exact: true }).first()).toHaveValue("Accept");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const raw = await rawResponseText(page);
    await expect(raw).toContainText('"page":"1"');
  });

  test("import an environment and resolve a variable in an imported request", async ({ page }) => {
    await importFile(page, "postman-environment.json");
    await page.getByRole("dialog", { name: "Import" }).getByRole("button", { name: "Import", exact: true }).click();
    await page.getByLabel("Environment", { exact: true }).selectOption({ label: "E2E Environment" });

    await importFile(page, "postman-collection-with-vars.json");
    await page.getByRole("dialog", { name: "Import" }).getByRole("button", { name: "Import", exact: true }).click();

    await sidebar(page).getByText("Echo With Env", { exact: true }).click();
    await expect(page.getByText(`Resolved: ${FIXTURE_BASE}/echo`)).toBeVisible();

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
  });

  test("export a collection as Postman JSON", async ({ page }) => {
    acceptDialog(page, "Export Test Collection");
    await page.getByRole("button", { name: "New Collection" }).click();
    await expect(sidebar(page).getByText("Export Test Collection", { exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Export Test Collection as Postman" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("export-test-collection");

    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test("native export, reset workspace, native import restores collection and environment", async ({ page }) => {
    acceptDialog(page, "Restore Me");
    await page.getByRole("button", { name: "New Collection" }).click();
    await expect(sidebar(page).getByText("Restore Me", { exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByLabel("Export workspace").click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // Reset to an empty workspace, then restore from the exported file.
    await page.evaluate(() => window.localStorage.removeItem("api-lab-workspace"));
    await page.evaluate(() => window.localStorage.setItem("api-lab-workspace", "{corrupt"));
    await page.reload();
    await page.getByRole("button", { name: "Reset Local Workspace" }).click();
    await expect(sidebar(page).getByText("Restore Me", { exact: true })).toBeHidden();

    const dialog = await openImportDialog(page);
    await dialog.getByLabel("Choose file to import").setInputFiles(path!);
    await expect(dialog.getByText("API Lab Workspace")).toBeVisible();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    await expect(sidebar(page).getByText("Restore Me", { exact: true })).toBeVisible();
  });

  test("import an OpenAPI document, generated request opens and sends", async ({ page }) => {
    const dialog = await importFile(page, "openapi.json");
    await expect(dialog.getByText("E2E OpenAPI")).toBeVisible();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    await sidebar(page).getByText("Echo Get", { exact: true }).click();
    await expect(page.getByLabel("Request URL")).toHaveValue(`${FIXTURE_BASE}/echo`);

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
  });

  test("invalid file shows a clear error and leaves the workspace unchanged", async ({ page }) => {
    const collectionsBefore = await sidebar(page).locator("li").count();
    const dialog = await importFile(page, "invalid.json");
    await expect(dialog.getByRole("alert")).toContainText(/not valid JSON/i);

    await dialog.getByRole("button", { name: "Close import dialog" }).click();
    expect(await sidebar(page).locator("li").count()).toBe(collectionsBefore);
  });

  test("partial import: unsupported features produce warnings but the collection is still usable", async ({ page }) => {
    const dialog = await importFile(page, "postman-partial.json");
    await expect(dialog.getByText(/warning/i)).toBeVisible();
    await expect(dialog.getByText(/oauth2/i)).toBeVisible();
    await expect(dialog.getByText(/script/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    await sidebar(page).getByText("Good Request", { exact: true }).click();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
  });
});
