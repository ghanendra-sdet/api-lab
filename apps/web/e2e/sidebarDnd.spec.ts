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

async function saveViaDialog(page: Page, name: string, collectionLabel: string) {
  await page.getByLabel("Save request").click();
  const dialog = page.getByRole("dialog", { name: "Save request" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Collection").selectOption({ label: collectionLabel });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Phase 3 of Workspace Management: `@dnd-kit` listens for real pointer
 * events (not the HTML5 `dragstart`/`dragover`/`drop` events Playwright's
 * built-in `locator.dragTo()` simulates), so a manual mouse-move sequence is
 * required instead. Several intermediate `mouse.move()` calls matter, not
 * just move-then-up: `@dnd-kit`'s `PointerSensor` needs to see movement past
 * its activation-distance threshold before a drag is considered "started"
 * at all, and its collision detection (`closestCenter`) is only recomputed
 * on each move event, so a single jump straight to the target can land on
 * the wrong drop target under CI timing.
 */
async function dragElement(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("dragElement: source or target has no bounding box");

  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  const endX = to.x + to.width / 2;
  const endY = to.y + to.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Small initial nudge past the activation-distance threshold, then step
  // toward the target so intermediate collision detection fires.
  await page.mouse.move(startX + 6, startY + 6, { steps: 5 });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + ((endX - startX) * i) / steps, startY + ((endY - startY) * i) / steps, {
      steps: 2,
    });
  }
  await page.mouse.move(endX, endY, { steps: 2 });
  await page.mouse.up();
}

/** The visible drag-handle for a sidebar row (folder or request), addressed by its accessible label. */
function dragHandle(page: Page, itemName: string): Locator {
  return sidebar(page).getByLabel(`Drag to move ${itemName}`, { exact: true });
}

/** The `<ul>` panel a folder's children render into, resolved via the folder toggle's `aria-controls`. */
async function folderPanel(page: Page, folderName: string): Promise<Locator> {
  const toggle = sidebar(page).getByRole("button", { expanded: true }).filter({ hasText: folderName }).first();
  const panelId = await toggle.getAttribute("aria-controls");
  if (!panelId) throw new Error(`folderPanel: no aria-controls found for folder "${folderName}"`);
  return page.locator(`#${panelId}`);
}

test.describe("Sidebar drag-and-drop (Phase 3 of Workspace Management)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("drag-to-reorder: dragging a request past a sibling changes their sidebar order", async ({ page }) => {
    await createCollection(page, "DnD Reorder Coll");
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Request A", "DnD Reorder Coll");
    await page.getByLabel("Open new request tab").click();
    await setUrl(page, `${FIXTURE_BASE}/echo?b=1`);
    await saveViaDialog(page, "Request B", "DnD Reorder Coll");

    // Sanity: A is listed before B before any drag.
    const namesBefore = await sidebar(page).getByRole("button", { name: /Request [AB]/ }).allTextContents();
    expect(namesBefore.findIndex((t) => t.includes("Request A"))).toBeLessThan(
      namesBefore.findIndex((t) => t.includes("Request B")),
    );

    await dragElement(page, dragHandle(page, "Request A"), dragHandle(page, "Request B"));

    await expect
      .poll(async () => {
        const names = await sidebar(page).getByRole("button", { name: /Request [AB]/ }).allTextContents();
        return names.findIndex((t) => t.includes("Request A")) > names.findIndex((t) => t.includes("Request B"));
      })
      .toBe(true);
  });

  test("drag a request into a folder: it moves out of the collection's top level and into the folder", async ({
    page,
  }) => {
    await createCollection(page, "DnD Move Coll");
    acceptDialog(page, "Target Folder");
    await page.getByRole("button", { name: "New folder in DnD Move Coll" }).click();
    await expect(sidebar(page).getByText("Target Folder", { exact: true })).toBeVisible();

    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Movable Request", "DnD Move Coll");

    await dragElement(page, dragHandle(page, "Movable Request"), sidebar(page).getByText("Target Folder", { exact: true }));

    const panel = await folderPanel(page, "Target Folder");
    await expect(panel.getByText("Movable Request", { exact: true })).toBeVisible();
  });

  test("drag a folder into another folder: its whole subtree moves with it", async ({ page }) => {
    await createCollection(page, "DnD Nest Coll");
    acceptDialog(page, "Outer Folder");
    await page.getByRole("button", { name: "New folder in DnD Nest Coll" }).click();
    acceptDialog(page, "Inner Folder");
    await page.getByRole("button", { name: "New folder in DnD Nest Coll" }).click();
    await expect(sidebar(page).getByText("Outer Folder", { exact: true })).toBeVisible();
    await expect(sidebar(page).getByText("Inner Folder", { exact: true })).toBeVisible();

    // Give "Inner Folder" a request, so we can confirm the whole subtree
    // survives the move — not just the empty folder shell.
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Nested Request", "DnD Nest Coll");
    await dragElement(page, dragHandle(page, "Nested Request"), sidebar(page).getByText("Inner Folder", { exact: true }));
    const innerPanelBefore = await folderPanel(page, "Inner Folder");
    await expect(innerPanelBefore.getByText("Nested Request", { exact: true })).toBeVisible();

    await dragElement(page, dragHandle(page, "Inner Folder"), sidebar(page).getByText("Outer Folder", { exact: true }));

    const outerPanel = await folderPanel(page, "Outer Folder");
    await expect(outerPanel.getByText("Inner Folder", { exact: true })).toBeVisible();
    await expect(outerPanel.getByText("Nested Request", { exact: true })).toBeVisible();
  });

  test("drag-and-drop reorganization persists across a reload", async ({ page }) => {
    await createCollection(page, "DnD Persist Coll");
    acceptDialog(page, "Persist Folder");
    await page.getByRole("button", { name: "New folder in DnD Persist Coll" }).click();
    await setUrl(page, `${FIXTURE_BASE}/echo`);
    await saveViaDialog(page, "Persist Request", "DnD Persist Coll");

    await dragElement(page, dragHandle(page, "Persist Request"), sidebar(page).getByText("Persist Folder", { exact: true }));
    const panel = await folderPanel(page, "Persist Folder");
    await expect(panel.getByText("Persist Request", { exact: true })).toBeVisible();

    // Persistence writes are debounced (400ms) — wait past that before reloading.
    await page.waitForTimeout(500);
    await page.reload();

    const panelAfterReload = await folderPanel(page, "Persist Folder");
    await expect(panelAfterReload.getByText("Persist Request", { exact: true })).toBeVisible();
  });
});
