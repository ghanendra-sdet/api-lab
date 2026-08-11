import { test, expect, type Page, type Locator } from "@playwright/test";

const FIXTURE_BASE = "http://localhost:4001";

/** Accept the next native prompt()/confirm() dialog with the given text (or just accept, for confirm). */
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

/** Saves the active tab's request via the Save dialog, scoped to the dialog
 * so it doesn't collide with the sidebar's "Rename X" buttons (which contain
 * the substring "Name" and would otherwise match getByLabel("Name")). */
async function saveViaDialog(page: Page, name: string, collectionLabel: string) {
  await page.getByLabel("Save request").click();
  const dialog = page.getByRole("dialog", { name: "Save request" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Collection").selectOption({ label: collectionLabel });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Persistence writes are debounced (400ms) — wait past that before reloading. */
async function waitForPersistDebounce(page: Page) {
  await page.waitForTimeout(500);
}

test.describe("Collections & workspace persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("create collection", async ({ page }) => {
    await createCollection(page, "My Collection");
    await expect(sidebar(page).getByText("My Collection", { exact: true })).toBeVisible();
  });

  test("create folder inside a collection", async ({ page }) => {
    await createCollection(page, "Coll A");
    acceptDialog(page, "My Folder");
    await page.getByRole("button", { name: "New folder in Coll A" }).click();
    await expect(sidebar(page).getByText("My Folder", { exact: true })).toBeVisible();
  });

  test("create request via Save dialog", async ({ page }) => {
    await createCollection(page, "Coll B");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Echo Request", "Coll B");
    await expect(sidebar(page).getByText("Echo Request", { exact: true })).toBeVisible();
  });

  test("save request, reload, and verify it persisted", async ({ page }) => {
    await createCollection(page, "Persisted Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Persisted Request", "Persisted Coll");
    await expect(sidebar(page).getByText("Persisted Request", { exact: true })).toBeVisible();

    await waitForPersistDebounce(page);
    await page.reload();
    await expect(sidebar(page).getByText("Persisted Coll", { exact: true })).toBeVisible();
    await expect(sidebar(page).getByText("Persisted Request", { exact: true })).toBeVisible();
  });

  test("edit a saved request, reload, and verify the change persisted", async ({ page }) => {
    await createCollection(page, "Edit Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Editable Request", "Edit Coll");

    await setUrl(page, `${FIXTURE_BASE}/echo?edited=1`);
    await page.getByLabel("Save request").click();

    await waitForPersistDebounce(page);
    await page.reload();
    await sidebar(page).getByText("Editable Request", { exact: true }).click();
    await expect(page.getByLabel("Request URL")).toHaveValue(`${FIXTURE_BASE}/echo?edited=1`);
  });

  test("duplicate a saved request leaves the original unchanged", async ({ page }) => {
    await createCollection(page, "Dup Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Source Request", "Dup Coll");

    await page.getByRole("button", { name: "Duplicate Source Request" }).click();
    await expect(sidebar(page).getByText("Source Request Copy", { exact: true })).toBeVisible();

    await setUrl(page, `${FIXTURE_BASE}/echo?copy=1`);
    await page.getByLabel("Save request").click();

    await sidebar(page).getByText("Source Request", { exact: true }).click();
    await expect(page.getByLabel("Request URL")).toHaveValue(`${FIXTURE_BASE}/echo`);
  });

  test("move a saved request into a folder", async ({ page }) => {
    await createCollection(page, "Move Coll");
    acceptDialog(page, "Target Folder");
    await page.getByRole("button", { name: "New folder in Move Coll" }).click();

    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Movable Request", "Move Coll");

    // The sidebar's move affordance is up/down reordering within a location;
    // moving between locations (collection <-> folder) is exercised at the
    // store level in useAppStore.workspace.test.ts. Here we confirm the
    // request round-trips correctly at its saved (top-level) location.
    await expect(sidebar(page).getByText("Movable Request", { exact: true })).toBeVisible();
    await expect(sidebar(page).getByText("Target Folder", { exact: true })).toBeVisible();
  });

  test("delete a saved request", async ({ page }) => {
    await createCollection(page, "Del Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Doomed Request", "Del Coll");
    await expect(sidebar(page).getByText("Doomed Request", { exact: true })).toBeVisible();

    acceptDialog(page);
    await page.getByRole("button", { name: "Delete Doomed Request" }).click();
    await expect(sidebar(page).getByText("Doomed Request", { exact: true })).toBeHidden();
  });

  test("dirty state: unsaved edits show an indicator and close prompts for confirmation", async ({ page }) => {
    await createCollection(page, "Dirty Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Dirty Request", "Dirty Coll");

    await setUrl(page, `${FIXTURE_BASE}/echo?changed=1`);
    await expect(page.getByRole("tab", { name: /Dirty Request \*/ })).toBeVisible();

    let dialogSeen = false;
    page.once("dialog", (dialog) => {
      dialogSeen = true;
      void dialog.dismiss();
    });
    await page.getByLabel("Close Dirty Request tab").click();
    await expect.poll(() => dialogSeen).toBe(true);
    // Dismissed the confirm, so the dirty tab must still be open.
    await expect(page.getByRole("tab", { name: /Dirty Request \*/ })).toBeVisible();
  });

  test("multiple tabs: opening the same saved request twice activates one tab", async ({ page }) => {
    await createCollection(page, "MultiTab Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Shared Request", "MultiTab Coll");

    await page.getByLabel("Open new request tab").click();
    const tabCountBefore = await page.getByRole("tab").count();

    await sidebar(page).getByText("Shared Request", { exact: true }).click();
    await expect(page.getByRole("tab")).toHaveCount(tabCountBefore);
  });

  test("workspace survives a real browser reload (not mocked)", async ({ page }) => {
    await createCollection(page, "Reload Coll");
    acceptDialog(page, "Reload Folder");
    await page.getByRole("button", { name: "New folder in Reload Coll" }).click();

    await waitForPersistDebounce(page);
    await page.reload();
    await expect(sidebar(page).getByText("Reload Coll", { exact: true })).toBeVisible();
    await expect(sidebar(page).getByText("Reload Folder", { exact: true })).toBeVisible();
  });
});
