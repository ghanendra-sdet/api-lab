import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";

function resetStore() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    theme: "light",
    environments: createEmptyEnvironmentWorkspace(),
    environmentsLoadError: null,
    sidebarCollapsed: false,
  });
}

describe("useAppStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("changes the active tab's method", () => {
    const { activeTabId, setTabMethod } = useAppStore.getState();
    setTabMethod(activeTabId, "POST");
    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId);
    expect(tab?.method).toBe("POST");
  });

  it("opens a new tab and makes it active", () => {
    const before = useAppStore.getState().tabs.length;
    useAppStore.getState().openNewTab();
    const state = useAppStore.getState();
    expect(state.tabs.length).toBe(before + 1);
    expect(state.activeTabId).toBe(state.tabs[state.tabs.length - 1]!.id);
  });

  it("closes a tab and falls back to another tab when the active one closes", () => {
    useAppStore.getState().openNewTab();
    const state = useAppStore.getState();
    const firstTabId = state.tabs[0]!.id;
    const secondTabId = state.tabs[1]!.id;
    useAppStore.getState().setActiveTab(secondTabId);
    useAppStore.getState().closeTab(secondTabId);
    const after = useAppStore.getState();
    expect(after.tabs.find((t) => t.id === secondTabId)).toBeUndefined();
    expect(after.activeTabId).toBe(firstTabId);
  });

  it("always keeps at least one tab open", () => {
    const { activeTabId, closeTab } = useAppStore.getState();
    closeTab(activeTabId);
    expect(useAppStore.getState().tabs.length).toBe(1);
  });

  it("switches the active panel for a tab", () => {
    const { activeTabId, setActivePanel } = useAppStore.getState();
    setActivePanel(activeTabId, "headers");
    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId);
    expect(tab?.activePanel).toBe("headers");
  });

  it("adds and removes a param row", () => {
    const { activeTabId, addParamRow, removeParamRow } = useAppStore.getState();
    const before = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!.params.length;
    addParamRow(activeTabId);
    const afterAdd = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!.params;
    expect(afterAdd.length).toBe(before + 1);
    removeParamRow(activeTabId, afterAdd[afterAdd.length - 1]!.id);
    const afterRemove = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!.params;
    expect(afterRemove.length).toBe(before);
  });

  it("adds and updates a header row", () => {
    const { activeTabId, addHeaderRow, updateHeaderRow } = useAppStore.getState();
    addHeaderRow(activeTabId);
    const rowId = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!.headers.at(-1)!
      .id;
    updateHeaderRow(activeTabId, rowId, { key: "Content-Type", value: "application/json" });
    const row = useAppStore
      .getState()
      .tabs.find((t) => t.id === activeTabId)!
      .headers.find((r) => r.id === rowId)!;
    expect(row.key).toBe("Content-Type");
    expect(row.value).toBe("application/json");
  });

  it("toggles the theme and persists it to localStorage", () => {
    const before = useAppStore.getState().theme;
    useAppStore.getState().toggleTheme();
    const after = useAppStore.getState().theme;
    expect(after).not.toBe(before);
    expect(window.localStorage.getItem("api-lab-theme")).toBe(after);
  });

  it("creates an environment and sets it active", () => {
    const id = useAppStore.getState().createEnvironment("Production");
    useAppStore.getState().setActiveEnvironment(id);
    const state = useAppStore.getState();
    expect(state.environments.activeEnvironmentId).toBe(id);
    expect(state.environments.environments[0]!.name).toBe("Production");
  });
});
