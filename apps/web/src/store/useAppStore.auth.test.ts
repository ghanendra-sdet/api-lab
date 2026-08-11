import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("useAppStore auth", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("setAuth updates the active tab's auth config", () => {
    const { activeTabId, setAuth } = useAppStore.getState();
    setAuth(activeTabId, { type: "bearer", token: "abc123" });
    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!;
    expect(tab.auth).toEqual({ type: "bearer", token: "abc123" });
  });

  it("resetRequest resets auth back to No Auth", () => {
    const { activeTabId, setAuth, resetRequest } = useAppStore.getState();
    setAuth(activeTabId, { type: "bearer", token: "abc123" });
    resetRequest(activeTabId);
    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!;
    expect(tab.auth).toEqual({ type: "none" });
  });

  it("blocks sending when a required auth field is missing", async () => {
    const { activeTabId, setTabUrl, setAuth, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com");
    setAuth(activeTabId, { type: "bearer", token: "" });

    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.sendErrors[activeTabId]?.field).toBe("auth");
    expect(state.sendErrors[activeTabId]?.message).toMatch(/token/i);
    expect(state.requestStatus[activeTabId]).not.toBe("loading");
  });

  it("blocks sending when OAuth 2.0 is selected (honest placeholder, not fake support)", async () => {
    const { activeTabId, setTabUrl, setAuth, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com");
    setAuth(activeTabId, { type: "oauth2" });

    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.sendErrors[activeTabId]?.field).toBe("auth");
    expect(state.sendErrors[activeTabId]?.message).toMatch(/planned/i);
  });

  it("blocks sending when a bearer token variable is unresolved", async () => {
    const { activeTabId, setTabUrl, setAuth, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com");
    setAuth(activeTabId, { type: "bearer", token: "{{missingToken}}" });

    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.sendErrors[activeTabId]?.field).toBe("variables");
    expect(state.sendErrors[activeTabId]?.message).toContain("missingToken");
  });

  it("resolves an environment variable inside a bearer token and sends it as the Authorization header", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { activeTabId, setTabUrl, setAuth, createEnvironment, addVariable, updateVariable, setActiveEnvironment } =
      useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com");
    setAuth(activeTabId, { type: "bearer", token: "{{token}}" });

    const envId = createEnvironment("Dev");
    const variableId = addVariable(envId);
    updateVariable(envId, variableId, { key: "token", value: "resolved-token-value" });
    setActiveEnvironment(envId);

    await useAppStore.getState().sendRequest(activeTabId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer resolved-token-value");
  });

  it("auth-generated Authorization header replaces a manually entered one with the same name", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { activeTabId, setTabUrl, setAuth, addHeaderRow, updateHeaderRow } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com");
    addHeaderRow(activeTabId);
    const rowId = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!.headers.at(-1)!.id;
    updateHeaderRow(activeTabId, rowId, { key: "Authorization", value: "manually-typed-value" });
    setAuth(activeTabId, { type: "bearer", token: "real-token" });

    await useAppStore.getState().sendRequest(activeTabId);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer real-token");
  });
});
