import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";

function resetStore() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    workspace: createEmptyWorkspace(),
    workspaceLoadError: null,
    theme: "light",
    environment: "none",
    sidebarCollapsed: false,
  });
}

describe("useAppStore workspace actions", () => {
  beforeEach(() => {
    resetStore();
  });

  it("creates, renames, and deletes a collection", () => {
    const { createCollection, renameCollection, deleteCollection } = useAppStore.getState();
    const collectionId = createCollection("My Collection");
    expect(useAppStore.getState().workspace.collections).toHaveLength(1);

    renameCollection(collectionId, "Renamed");
    expect(useAppStore.getState().workspace.collections[0]!.name).toBe("Renamed");

    deleteCollection(collectionId);
    expect(useAppStore.getState().workspace.collections).toHaveLength(0);
  });

  it("creates a folder inside a collection", () => {
    const { createCollection, createFolder } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    const folderId = createFolder(collectionId, "Folder");
    const collection = useAppStore.getState().workspace.collections[0]!;
    expect(collection.items).toHaveLength(1);
    expect(collection.items[0]!.id).toBe(folderId);
  });

  it("saves the active tab as a new request and links the tab", () => {
    const { createCollection, saveNewRequest, activeTabId, setTabUrl, setTabMethod } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    setTabUrl(activeTabId, "https://example.com");
    setTabMethod(activeTabId, "POST");
    saveNewRequest(activeTabId, { collectionId }, "My Request");

    const state = useAppStore.getState();
    const tab = state.tabs.find((t) => t.id === activeTabId)!;
    expect(tab.savedRequestId).toBeDefined();
    expect(tab.savedLocation).toEqual({ collectionId });
    expect(tab.name).toBe("My Request");
    expect(state.workspace.collections[0]!.items).toHaveLength(1);
  });

  it("opening an already-open saved request activates the existing tab instead of duplicating it", () => {
    const { createCollection, saveNewRequest, activeTabId, openSavedRequest, openNewTab } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    saveNewRequest(activeTabId, { collectionId }, "Req");
    const savedRequestId = useAppStore.getState().tabs[0]!.savedRequestId!;

    openNewTab();
    const tabCountBefore = useAppStore.getState().tabs.length;

    openSavedRequest({ collectionId }, savedRequestId);
    const state = useAppStore.getState();
    expect(state.tabs).toHaveLength(tabCountBefore);
    expect(state.activeTabId).toBe(useAppStore.getState().tabs[0]!.id);
  });

  it("duplicating a saved request opens the copy, leaving the original unchanged", () => {
    const { createCollection, saveNewRequest, activeTabId, setTabUrl, duplicateSavedRequest, saveTab } =
      useAppStore.getState();
    const collectionId = createCollection("Coll");
    setTabUrl(activeTabId, "https://example.com/original");
    saveNewRequest(activeTabId, { collectionId }, "Original");

    duplicateSavedRequest({ collectionId }, useAppStore.getState().tabs[0]!.savedRequestId!);
    const state = useAppStore.getState();
    expect(state.workspace.collections[0]!.items).toHaveLength(2);

    const copyTab = state.tabs.find((t) => t.id === state.activeTabId)!;
    useAppStore.getState().setTabUrl(copyTab.id, "https://example.com/copy");
    saveTab(copyTab.id);

    const original = useAppStore
      .getState()
      .workspace.collections[0]!.items.find((i) => i.id !== copyTab.savedRequestId)!;
    expect("request" in original && original.request.url).toBe("https://example.com/original");
  });

  it("moving a saved request updates its location and any open tab", () => {
    const { createCollection, createFolder, saveNewRequest, activeTabId, moveSavedRequest } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    const folderId = createFolder(collectionId, "Folder");
    saveNewRequest(activeTabId, { collectionId }, "Req");
    const requestId = useAppStore.getState().tabs[0]!.savedRequestId!;

    moveSavedRequest({ collectionId }, { collectionId, folderId }, requestId);
    const state = useAppStore.getState();
    expect(state.workspace.collections[0]!.items).toHaveLength(1);
    const folder = state.workspace.collections[0]!.items[0];
    expect(folder && "items" in folder && folder.items[0]!.id).toBe(requestId);
    expect(state.tabs[0]!.savedLocation).toEqual({ collectionId, folderId });
  });

  it("deleting a collection unlinks (but does not close) any open tab referencing it", () => {
    const { createCollection, saveNewRequest, activeTabId, deleteCollection } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    saveNewRequest(activeTabId, { collectionId }, "Req");
    deleteCollection(collectionId);

    const state = useAppStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.savedRequestId).toBeUndefined();
    expect(state.tabs[0]!.savedLocation).toBeUndefined();
  });
});
