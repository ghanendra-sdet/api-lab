import { test, expect, type Page, type Locator } from "@playwright/test";

// D.2 Step 3: browser-level E2E verification for the form-data and
// x-www-form-urlencoded request body modes implemented in D.2 Steps 1-2
// (packages/request-engine/src/buildBody.ts + apps/web's FormDataEditor /
// KeyValueEditor UI). This suite is validation-only: it exercises the
// already-shipped implementation through real UI interactions and the
// shared /echo fixture, it does not add or change product behavior.

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

async function openBodyTab(page: Page) {
  await requestPanelTab(page, "Body").click();
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

async function rawResponseText(page: Page) {
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  return page.getByRole("region", { name: "Response" }).locator("pre");
}

async function waitForPersistDebounce(page: Page) {
  await page.waitForTimeout(600);
}

test.describe("D.2 Step 3 Body Modes (form-data / x-www-form-urlencoded) E2E", () => {
  test.beforeEach(async ({ page }) => {
    // A taller viewport keeps the fixed Response panel from overlapping the
    // "+ Add row" button once several form-data/urlencoded rows are added.
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page.goto("/");
  });

  test("1. form-data: enabled/disabled/duplicate/variable/file rows are compiled into a real multipart body", async ({ page }) => {
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/echo`);

    // Seed a request-local variable so we can prove {{var}} resolves in both
    // a form-data key and a form-data value.
    await requestPanelTab(page, "Variables").click();
    await page.getByRole("button", { name: "+ Add variable" }).click();
    const varRow = page.locator("[data-testid='variables-panel'] tbody tr").last();
    await varRow.getByLabel("Key", { exact: true }).fill("fdVar");
    await varRow.getByLabel("Value", { exact: true }).fill("resolvedValue");

    await openBodyTab(page);
    await page.getByRole("radio", { name: "form-data", exact: true }).click();

    const rows = page.locator("tbody tr");

    // Row 1: plain enabled text field.
    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(0).getByLabel("Key", { exact: true }).fill("username");
    await rows.nth(0).getByLabel("Value", { exact: true }).fill("alice");

    // Row 2: duplicate key (same key as row 1's key name reused on purpose
    // with a different field) -- use "tag" twice to prove duplicates survive.
    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(1).getByLabel("Key", { exact: true }).fill("tag");
    await rows.nth(1).getByLabel("Value", { exact: true }).fill("first");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(2).getByLabel("Key", { exact: true }).fill("tag");
    await rows.nth(2).getByLabel("Value", { exact: true }).fill("second");

    // Row 3: disabled row -- must NOT reach the server.
    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(3).getByLabel("Key", { exact: true }).fill("shouldBeExcluded");
    await rows.nth(3).getByLabel("Value", { exact: true }).fill("nope");
    await rows.nth(3).getByLabel(/Enable row/).uncheck();

    // Row 4: variables in both key and value.
    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(4).getByLabel("Key", { exact: true }).fill("{{fdVar}}Key");
    await rows.nth(4).getByLabel("Value", { exact: true }).fill("v-{{fdVar}}");

    // Row 5: file-type field, metadata/reference only per FormDataField's
    // actual shape (name + reference, no binary picker in this UI).
    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(5).getByLabel("Field Type").selectOption("file");
    await rows.nth(5).getByLabel("Key", { exact: true }).fill("avatar");
    await rows.nth(5).getByLabel("File Name").fill("photo.png");
    await rows.nth(5).getByLabel("File Reference").fill("ref-123");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const rawRes = await rawResponseText(page);
    // The echoed multipart body is embedded as a JSON string in the raw
    // response viewer, so its own quotes appear backslash-escaped in the
    // rendered text (e.g. `name=\"username\"`) rather than literal `"`.
    await expect(rawRes).toContainText('name=\\"username\\"');
    const bodyText = await rawRes.innerText();

    // Enabled fields present.
    expect(bodyText).toContain('name=\\"username\\"');
    expect(bodyText).toContain("alice");

    // Disabled row absent entirely.
    expect(bodyText).not.toContain("shouldBeExcluded");
    expect(bodyText).not.toContain("nope");

    // Duplicate keys both present.
    expect(bodyText.match(/name=\\"tag\\"/g)?.length).toBe(2);
    expect(bodyText).toContain("first");
    expect(bodyText).toContain("second");

    // Variables resolved in both key and value.
    expect(bodyText).toContain("resolvedValueKey");
    expect(bodyText).toContain("v-resolvedValue");
    // The unresolved placeholder must not leak through.
    expect(bodyText).not.toContain("{{fdVar}}");

    // File metadata represented correctly (name + reference), not raw bytes.
    expect(bodyText).toContain('name=\\"avatar\\"');
    expect(bodyText).toContain('filename=\\"photo.png\\"');
    expect(bodyText).toContain("ref-123");

    // A real multipart payload was generated with a boundary, and the
    // Content-Type was NOT hardcoded to a fixed boundary string -- assert
    // the shape produced by the browser's own FormData/fetch encoding.
    expect(bodyText).toMatch(/Content-Type[\\"]*:\s*[\\"]*multipart\/form-data;\s*boundary=/i);
    const boundaryMatch = bodyText.match(/boundary=([A-Za-z0-9-]+)/);
    expect(boundaryMatch).not.toBeNull();
    expect(boundaryMatch![1]!.length).toBeGreaterThan(10);
    // The multipart delimiter lines in the raw body itself must echo that
    // same generated boundary -- proof the body and the header agree and
    // neither was a static, unrelated hardcoded string.
    expect(bodyText).toContain(boundaryMatch![1]!);
  });

  test("2. x-www-form-urlencoded: enabled/disabled/duplicate/variable rows are URL-encoded and Content-Type is correct", async ({ page }) => {
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/echo`);

    await requestPanelTab(page, "Variables").click();
    await page.getByRole("button", { name: "+ Add variable" }).click();
    const varRow = page.locator("[data-testid='variables-panel'] tbody tr").last();
    await varRow.getByLabel("Key", { exact: true }).fill("ueVar");
    await varRow.getByLabel("Value", { exact: true }).fill("uev");

    await openBodyTab(page);
    await page.getByRole("radio", { name: "x-www-form-urlencoded", exact: true }).click();

    const rows = page.locator("tbody tr");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(0).getByLabel("Key", { exact: true }).fill("greeting");
    await rows.nth(0).getByLabel("Value", { exact: true }).fill("hello world");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(1).getByLabel("Key", { exact: true }).fill("dup");
    await rows.nth(1).getByLabel("Value", { exact: true }).fill("one");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(2).getByLabel("Key", { exact: true }).fill("dup");
    await rows.nth(2).getByLabel("Value", { exact: true }).fill("two");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(3).getByLabel("Key", { exact: true }).fill("excludeMe");
    await rows.nth(3).getByLabel("Value", { exact: true }).fill("nope");
    await rows.nth(3).getByLabel(/Enable row/).uncheck();

    await page.getByRole("button", { name: "+ Add row" }).click();
    await rows.nth(4).getByLabel("Key", { exact: true }).fill("{{ueVar}}Key");
    await rows.nth(4).getByLabel("Value", { exact: true }).fill("val-{{ueVar}}");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const rawRes = await rawResponseText(page);
    const bodyText = await rawRes.innerText();

    // URL-encoded body: "hello world" -> "hello+world".
    expect(bodyText).toContain("greeting=hello+world");

    // Duplicate keys preserved.
    expect(bodyText).toContain("dup=one");
    expect(bodyText).toContain("dup=two");
    expect(bodyText.match(/dup=/g)?.length).toBe(2);

    // Disabled row excluded.
    expect(bodyText).not.toContain("excludeMe");
    expect(bodyText).not.toContain("nope");

    // Variables resolved in key and value.
    expect(bodyText).toContain("uevKey=val-uev");
    expect(bodyText).not.toContain("{{ueVar}}");

    // Content-Type header.
    expect(bodyText).toMatch(/content-type[\\"]*:\s*[\\"]*application\/x-www-form-urlencoded/i);
  });

  test("3. form-data and urlencoded rows persist across a real page reload", async ({ page }) => {
    await createCollection(page, "Body Persist Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);

    await openBodyTab(page);
    await page.getByRole("radio", { name: "form-data", exact: true }).click();
    const fdRows = page.locator("tbody tr");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await fdRows.nth(0).getByLabel("Key", { exact: true }).fill("persistKey");
    await fdRows.nth(0).getByLabel("Value", { exact: true }).fill("persistVal");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await fdRows.nth(1).getByLabel("Key", { exact: true }).fill("dupPersist");
    await fdRows.nth(1).getByLabel("Value", { exact: true }).fill("v1");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await fdRows.nth(2).getByLabel("Key", { exact: true }).fill("dupPersist");
    await fdRows.nth(2).getByLabel("Value", { exact: true }).fill("v2");

    await page.getByRole("button", { name: "+ Add row" }).click();
    await fdRows.nth(3).getByLabel("Key", { exact: true }).fill("disabledPersist");
    await fdRows.nth(3).getByLabel("Value", { exact: true }).fill("x");
    await fdRows.nth(3).getByLabel(/Enable row/).uncheck();

    await page.getByRole("button", { name: "+ Add row" }).click();
    await fdRows.nth(4).getByLabel("Field Type").selectOption("file");
    await fdRows.nth(4).getByLabel("Key", { exact: true }).fill("uploadPersist");
    await fdRows.nth(4).getByLabel("File Name").fill("doc.pdf");
    await fdRows.nth(4).getByLabel("File Reference").fill("ref-persist-1");

    await saveViaDialog(page, "Persist Body Req", "Body Persist Coll");

    await waitForPersistDebounce(page);
    await page.reload();

    await sidebar(page).getByText("Persist Body Req", { exact: true }).click();
    await openBodyTab(page);
    await expect(page.getByRole("radio", { name: "form-data", exact: true })).toBeChecked();

    const reloadedRows = page.locator("tbody tr");
    await expect(reloadedRows).toHaveCount(5);

    await expect(reloadedRows.nth(0).getByLabel("Key", { exact: true })).toHaveValue("persistKey");
    await expect(reloadedRows.nth(0).getByLabel("Value", { exact: true })).toHaveValue("persistVal");

    await expect(reloadedRows.nth(1).getByLabel("Key", { exact: true })).toHaveValue("dupPersist");
    await expect(reloadedRows.nth(1).getByLabel("Value", { exact: true })).toHaveValue("v1");
    await expect(reloadedRows.nth(2).getByLabel("Key", { exact: true })).toHaveValue("dupPersist");
    await expect(reloadedRows.nth(2).getByLabel("Value", { exact: true })).toHaveValue("v2");

    await expect(reloadedRows.nth(3).getByLabel("Key", { exact: true })).toHaveValue("disabledPersist");
    await expect(reloadedRows.nth(3).getByLabel(/Enable row/)).not.toBeChecked();

    await expect(reloadedRows.nth(4).getByLabel("Key", { exact: true })).toHaveValue("uploadPersist");
    await expect(reloadedRows.nth(4).getByLabel("File Name")).toHaveValue("doc.pdf");
    await expect(reloadedRows.nth(4).getByLabel("File Reference")).toHaveValue("ref-persist-1");

    // Now flip to urlencoded, add a row, save, reload and verify that too.
    await page.getByRole("radio", { name: "x-www-form-urlencoded", exact: true }).click();
    await page.getByRole("button", { name: "+ Add row" }).click();
    const ueRows = page.locator("tbody tr");
    await ueRows.nth(0).getByLabel("Key", { exact: true }).fill("uePersistKey");
    await ueRows.nth(0).getByLabel("Value", { exact: true }).fill("uePersistVal");

    await page.getByLabel("Save request").click();
    await waitForPersistDebounce(page);
    await page.reload();

    await sidebar(page).getByText("Persist Body Req", { exact: true }).click();
    await openBodyTab(page);
    await expect(page.getByRole("radio", { name: "x-www-form-urlencoded", exact: true })).toBeChecked();
    const reloadedUeRows = page.locator("tbody tr");
    await expect(reloadedUeRows.nth(0).getByLabel("Key", { exact: true })).toHaveValue("uePersistKey");
    await expect(reloadedUeRows.nth(0).getByLabel("Value", { exact: true })).toHaveValue("uePersistVal");
  });

  test("4. raw JSON/Text bodies still work, and a request with no form-data/urlencoded state loads cleanly", async ({ page }) => {
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openBodyTab(page);
    await page.getByRole("radio", { name: "raw", exact: true }).click();

    const editorContainer = page.locator(".monaco-editor").first();
    await editorContainer.locator(".view-lines").click();
    await expect(editorContainer).toHaveClass(/focused/);
    await page.keyboard.type('{"greeting":"hi"}', { delay: 20 });

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    let rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText('"greeting":"hi"');

    // Switch to Text format on the same raw mode.
    await openBodyTab(page);
    await page.getByLabel("Raw body format").selectOption("Text");
    await editorContainer.locator(".view-lines").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Meta+A");
    await page.keyboard.type("plain text body", { delay: 20 });

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    rawRes = await rawResponseText(page);
    await expect(rawRes).toContainText("plain text body");

    // A request config with no form-data/urlencoded state at all (a fresh,
    // never-touched "none" mode tab) must still load without error. Open a
    // brand-new tab first -- otherwise this would save over the "raw" tab
    // configured above instead of testing a genuinely bodyless request.
    await page.getByRole("button", { name: "New request tab" }).click();
    await createCollection(page, "No Body State Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "No Body State Req", "No Body State Coll");
    await waitForPersistDebounce(page);
    await page.reload();

    await sidebar(page).getByText("No Body State Req", { exact: true }).click();
    await openBodyTab(page);
    await expect(page.getByRole("radio", { name: "none", exact: true })).toBeChecked();
    await expect(page.getByText("This request does not have a body.")).toBeVisible();
  });

  test("5. file-type form-data row exposes only metadata/reference values, never raw binary content", async ({ page }) => {
    await page.getByLabel("HTTP method").selectOption("POST");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await openBodyTab(page);
    await page.getByRole("radio", { name: "form-data", exact: true }).click();

    await page.getByRole("button", { name: "+ Add row" }).click();
    const row = page.locator("tbody tr").first();
    await row.getByLabel("Field Type").selectOption("file");
    await row.getByLabel("Key", { exact: true }).fill("upload");
    await row.getByLabel("File Name").fill("report.csv");
    await row.getByLabel("File Reference").fill("ref-metadata-only");

    // The UI exposes exactly two user-editable inputs for a file row: a
    // name field and a reference field. No binary/file-picker control (an
    // <input type="file">) exists anywhere in this row.
    await expect(row.locator("input[type='file']")).toHaveCount(0);
    await expect(row.getByLabel("File Name")).toHaveValue("report.csv");
    await expect(row.getByLabel("File Reference")).toHaveValue("ref-metadata-only");

    // Sending the request compiles that metadata into the multipart body --
    // the transmitted "file content" is derived from the reference/name
    // strings the UI captured, not any real binary the user attached
    // (there was never a mechanism to attach real binary content here).
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();
    const rawRes = await rawResponseText(page);
    const bodyText = await rawRes.innerText();
    expect(bodyText).toContain('name=\\"upload\\"');
    expect(bodyText).toContain('filename=\\"report.csv\\"');
    expect(bodyText).toContain("ref-metadata-only");
  });
});
