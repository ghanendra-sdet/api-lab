import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
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
    environments: createEmptyEnvironmentWorkspace(),
    environmentsLoadError: null,
    theme: "light",
    sidebarCollapsed: false,
    requestStatus: {},
    responses: {},
    sendErrors: {},
  });
}

describe("useAppStore environment actions", () => {
  beforeEach(() => {
    resetStore();
  });

  it("creates, renames, and deletes an environment", () => {
    const { createEnvironment, renameEnvironment, deleteEnvironment } = useAppStore.getState();
    const id = createEnvironment("Development");
    expect(useAppStore.getState().environments.environments).toHaveLength(1);

    renameEnvironment(id, "Dev");
    expect(useAppStore.getState().environments.environments[0]!.name).toBe("Dev");

    deleteEnvironment(id);
    expect(useAppStore.getState().environments.environments).toHaveLength(0);
  });

  it("switches to No Environment when the active environment is deleted", () => {
    const { createEnvironment, setActiveEnvironment, deleteEnvironment } = useAppStore.getState();
    const id = createEnvironment("Development");
    setActiveEnvironment(id);
    expect(useAppStore.getState().environments.activeEnvironmentId).toBe(id);

    deleteEnvironment(id);
    expect(useAppStore.getState().environments.activeEnvironmentId).toBeNull();
  });

  it("duplicating an environment does not affect the original", () => {
    const { createEnvironment, addVariable, updateVariable, duplicateEnvironment } = useAppStore.getState();
    const id = createEnvironment("Development");
    const variableId = addVariable(id);
    updateVariable(id, variableId, { key: "baseUrl", value: "https://dev.example.com" });

    const copyId = duplicateEnvironment(id);
    const copyVariableId = useAppStore.getState().environments.environments.find((e) => e.id === copyId)!
      .variables[0]!.id;
    updateVariable(copyId, copyVariableId, { value: "https://changed.example.com" });

    const original = useAppStore.getState().environments.environments.find((e) => e.id === id)!;
    expect(original.variables[0]!.value).toBe("https://dev.example.com");
  });

  it("adds, updates, and removes a variable", () => {
    const { createEnvironment, addVariable, updateVariable, removeVariable } = useAppStore.getState();
    const id = createEnvironment("Development");
    const variableId = addVariable(id);
    updateVariable(id, variableId, { key: "token", value: "abc123", secret: true });

    const variable = useAppStore.getState().environments.environments[0]!.variables[0]!;
    expect(variable.key).toBe("token");
    expect(variable.secret).toBe(true);

    removeVariable(id, variableId);
    expect(useAppStore.getState().environments.environments[0]!.variables).toHaveLength(0);
  });
});

describe("useAppStore.sendRequest variable resolution", () => {
  beforeEach(() => {
    resetStore();
  });

  it("blocks sending and reports unresolved variables without hitting the network", async () => {
    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "{{baseUrl}}/users");

    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.sendErrors[activeTabId]?.field).toBe("variables");
    expect(state.sendErrors[activeTabId]?.message).toContain("baseUrl");
    expect(state.requestStatus[activeTabId]).not.toBe("loading");
  });

  it("blocks sending on a circular variable reference", async () => {
    const { createEnvironment, addVariable, updateVariable, setActiveEnvironment, activeTabId, setTabUrl, sendRequest } =
      useAppStore.getState();
    const envId = createEnvironment("Dev");
    const aId = addVariable(envId);
    updateVariable(envId, aId, { key: "a", value: "{{b}}" });
    const bId = addVariable(envId);
    updateVariable(envId, bId, { key: "b", value: "{{a}}" });
    setActiveEnvironment(envId);
    setTabUrl(activeTabId, "https://example.com/{{a}}");

    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.sendErrors[activeTabId]?.field).toBe("variables");
    expect(state.sendErrors[activeTabId]?.message).toMatch(/circular/i);
  });
});
