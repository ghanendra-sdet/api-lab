import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkspace, type WorkspaceMeta } from "@api-lab/workspace-engine";
import type { NormalizedCollectionImport } from "@api-lab/collection-format";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";

const DEFAULT_WORKSPACE_META: WorkspaceMeta = {
  id: "default",
  name: "My Workspace",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function resetStore() {
  const freshTab = createEmptyTab();
  window.localStorage.clear();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    workspace: createEmptyWorkspace(),
    workspaceLoadError: null,
    workspaces: [DEFAULT_WORKSPACE_META],
    activeWorkspaceId: "default",
    workspaceRegistryLoadError: null,
    theme: "light",
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

    moveSavedRequest({ collectionId }, { collectionId, folderPath: [folderId] }, requestId);
    const state = useAppStore.getState();
    expect(state.workspace.collections[0]!.items).toHaveLength(1);
    const folder = state.workspace.collections[0]!.items[0];
    expect(folder && "items" in folder && folder.items[0]!.id).toBe(requestId);
    expect(state.tabs[0]!.savedLocation).toEqual({ collectionId, folderPath: [folderId] });
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

describe("useAppStore workspace switching (Phase 1: Workspace Management)", () => {
  beforeEach(() => {
    resetStore();
  });

  it("createWorkspace adds a registry entry, switches to it, and starts it empty", () => {
    const { createWorkspace, createCollection } = useAppStore.getState();
    createCollection("In Default Workspace");

    const newId = createWorkspace("Second Workspace");

    const state = useAppStore.getState();
    expect(state.workspaces.map((w) => w.id)).toContain(newId);
    expect(state.workspaces.find((w) => w.id === newId)!.name).toBe("Second Workspace");
    expect(state.activeWorkspaceId).toBe(newId);
    expect(state.workspace.collections).toHaveLength(0);
  });

  it("switchWorkspace moves between workspaces without leaking data across them", () => {
    const { createCollection, createWorkspace, switchWorkspace } = useAppStore.getState();
    createCollection("Collection A");
    const defaultId = useAppStore.getState().activeWorkspaceId;

    const secondId = createWorkspace("Second Workspace");
    createCollection("Collection B");
    expect(useAppStore.getState().workspace.collections.map((c) => c.name)).toEqual(["Collection B"]);

    switchWorkspace(defaultId);
    const backInDefault = useAppStore.getState();
    expect(backInDefault.activeWorkspaceId).toBe(defaultId);
    expect(backInDefault.workspace.collections.map((c) => c.name)).toEqual(["Collection A"]);

    switchWorkspace(secondId);
    const backInSecond = useAppStore.getState();
    expect(backInSecond.activeWorkspaceId).toBe(secondId);
    expect(backInSecond.workspace.collections.map((c) => c.name)).toEqual(["Collection B"]);
  });

  it("a request saved in one workspace is not visible or resolvable after switching to another", () => {
    const { createCollection, saveNewRequest, activeTabId, createWorkspace, switchWorkspace } =
      useAppStore.getState();
    const collectionId = createCollection("Coll");
    saveNewRequest(activeTabId, { collectionId }, "Only In Default");
    const requestId = useAppStore.getState().tabs[0]!.savedRequestId!;
    const defaultId = useAppStore.getState().activeWorkspaceId;

    const secondId = createWorkspace("Second Workspace");
    const secondState = useAppStore.getState();
    const found = secondState.workspace.collections.some((c) =>
      c.items.some((item) => item.id === requestId),
    );
    expect(found).toBe(false);
    expect(secondState.workspace.collections).toHaveLength(0);

    switchWorkspace(defaultId);
    expect(
      useAppStore.getState().workspace.collections[0]!.items.some((item) => item.id === requestId),
    ).toBe(true);
    void secondId;
  });

  it("switching workspaces resets tabs to a single fresh tab", () => {
    const { openNewTab, createWorkspace } = useAppStore.getState();
    openNewTab();
    openNewTab();
    expect(useAppStore.getState().tabs.length).toBeGreaterThan(1);

    createWorkspace("Second Workspace");

    const state = useAppStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.tabs[0]!.id);
  });

  it("renameWorkspace renames only the targeted workspace entry", () => {
    const { createWorkspace, renameWorkspace } = useAppStore.getState();
    const secondId = createWorkspace("Second Workspace");
    renameWorkspace(secondId, "Renamed");

    const state = useAppStore.getState();
    expect(state.workspaces.find((w) => w.id === secondId)!.name).toBe("Renamed");
    expect(state.workspaces.find((w) => w.id === "default")!.name).toBe("My Workspace");
  });

  it("deleteWorkspace removes a non-active workspace without disturbing the active one", () => {
    const { createWorkspace, switchWorkspace, deleteWorkspace, createCollection } = useAppStore.getState();
    const defaultId = useAppStore.getState().activeWorkspaceId;
    const secondId = createWorkspace("Second Workspace");
    switchWorkspace(defaultId);
    createCollection("Still Here");

    deleteWorkspace(secondId);

    const state = useAppStore.getState();
    expect(state.workspaces.map((w) => w.id)).not.toContain(secondId);
    expect(state.activeWorkspaceId).toBe(defaultId);
    expect(state.workspace.collections.map((c) => c.name)).toEqual(["Still Here"]);
  });

  it("deleteWorkspace falls back to another workspace when the active one is deleted", () => {
    const { createWorkspace, deleteWorkspace } = useAppStore.getState();
    const defaultId = useAppStore.getState().activeWorkspaceId;
    deleteWorkspace(defaultId);
    expect(useAppStore.getState().activeWorkspaceId).toBe(defaultId);

    const secondId = createWorkspace("Second Workspace");
    expect(useAppStore.getState().activeWorkspaceId).toBe(secondId);

    deleteWorkspace(secondId);
    const state = useAppStore.getState();
    expect(state.activeWorkspaceId).toBe(defaultId);
    expect(state.workspaces).toHaveLength(1);
  });

  it("deleteWorkspace refuses to delete the only remaining workspace", () => {
    const { deleteWorkspace } = useAppStore.getState();
    const onlyId = useAppStore.getState().activeWorkspaceId;
    deleteWorkspace(onlyId);
    const state = useAppStore.getState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.activeWorkspaceId).toBe(onlyId);
  });

  it("import targets whichever workspace is active at call time, even after a switch", () => {
    const { createWorkspace, switchWorkspace, importCollection } = useAppStore.getState();
    const defaultId = useAppStore.getState().activeWorkspaceId;
    const secondId = createWorkspace("Second Workspace");
    switchWorkspace(defaultId);

    const normalized: NormalizedCollectionImport = {
      kind: "collection",
      name: "Imported",
      items: [],
      warnings: [],
      sourceFormat: "api-lab-native",
    };
    importCollection(normalized);

    const defaultState = useAppStore.getState();
    expect(defaultState.workspace.collections.map((c) => c.name)).toEqual(["Imported"]);

    switchWorkspace(secondId);
    expect(useAppStore.getState().workspace.collections).toHaveLength(0);
  });
});
