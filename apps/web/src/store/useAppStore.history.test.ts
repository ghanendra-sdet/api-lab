import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";
import type { RequestConfig } from "@api-lab/workspace-engine";

function resetStore() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    responses: {},
    requestStatus: {},
    sendErrors: {},
    abortControllers: {},
    history: [],
  });
}

function baseRequestConfig(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    method: "GET",
    url: "https://api.example.com/items",
    headers: [],
    params: [],
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    tests: [],
    extractions: [],
    auth: { type: "none" },
    ...overrides,
  };
}

describe("useAppStore request history", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends successful request runs to history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json" } }),
      ),
    );

    const { activeTabId, setTabUrl, setTabMethod, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://api.example.com/items");
    setTabMethod(activeTabId, "POST");
    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.history.length).toBe(1);
    expect(state.history[0]?.method).toBe("POST");
    expect(state.history[0]?.url).toBe("https://api.example.com/items");
    expect(state.history[0]?.status).toBe(201);
    expect(state.history[0]?.requestConfig.method).toBe("POST");
  });

  it("records HTTP error responses (4xx/5xx) in history — a real status is not a history failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"nope"}', { status: 500 })),
    );

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://api.example.com/items");
    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.history.length).toBe(1);
    expect(state.history[0]?.status).toBe(500);
  });

  it("does NOT record a cancelled request in history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    );

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://api.example.com/items");
    await sendRequest(activeTabId);

    expect(useAppStore.getState().history.length).toBe(0);
  });

  it("does NOT record a network-failed request in history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://api.example.com/items");
    await sendRequest(activeTabId);

    expect(useAppStore.getState().history.length).toBe(0);
  });

  it("caps history at 50 entries via the real send path, keeping the newest first", async () => {
    let statusCounter = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 + (statusCounter++ % 1) })),
    );

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    for (let i = 0; i < 55; i++) {
      setTabUrl(activeTabId, `https://api.example.com/items/${i}`);
      await sendRequest(activeTabId);
    }

    const state = useAppStore.getState();
    expect(state.history.length).toBe(50);
    // Newest request (the 55th, index 54) must be first — capping must drop
    // the oldest entries, not the newest.
    expect(state.history[0]?.url).toBe("https://api.example.com/items/54");
    expect(state.history[49]?.url).toBe("https://api.example.com/items/5");
  });

  it("never stores a resolved secret — only the unresolved {{variable}} template", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    const CANARY = "API-LAB-SECRET-CANARY";
    const { activeTabId, setTabUrl, sendRequest, createEnvironment, addVariable, updateVariable, setActiveEnvironment } =
      useAppStore.getState();

    const envId = createEnvironment("Canary Env");
    const varId = addVariable(envId);
    updateVariable(envId, varId, { key: "secretToken", value: CANARY });
    setActiveEnvironment(envId);

    setTabUrl(activeTabId, "https://api.example.com/items?token={{secretToken}}");
    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.history.length).toBe(1);
    // The template, not the resolved value, must be what's persisted.
    expect(state.history[0]?.url).toBe("https://api.example.com/items?token={{secretToken}}");
    expect(state.history[0]?.requestConfig.url).not.toContain(CANARY);
    expect(JSON.stringify(state.history)).not.toContain(CANARY);
  });

  it("opens a history item in a new tab with correct configuration", () => {
    const { openHistoryItem } = useAppStore.getState();

    const historicalItem = {
      id: "hist-test-1",
      method: "DELETE" as const,
      url: "https://api.example.com/resource/42",
      timestamp: new Date().toISOString(),
      status: 200,
      requestConfig: baseRequestConfig({
        method: "DELETE",
        url: "https://api.example.com/resource/42",
        headers: [{ id: "r-1", key: "X-Test", value: "Value", description: "", enabled: true }],
        auth: { type: "bearer", token: "token-123" },
      }),
    };

    openHistoryItem(historicalItem);

    const state = useAppStore.getState();
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    expect(activeTab).toBeDefined();
    expect(activeTab?.name).toContain("DELETE");
    expect(activeTab?.name).toContain("/resource/42");
    expect(activeTab?.method).toBe("DELETE");
    expect(activeTab?.url).toBe("https://api.example.com/resource/42");
    expect(activeTab?.headers.length).toBe(1);
    expect(activeTab?.headers[0]?.key).toBe("X-Test");
    expect(activeTab?.auth.type).toBe("bearer");
    expect(activeTab?.auth.type === "bearer" && activeTab.auth.token).toBe("token-123");
  });

  it("clears the history array", () => {
    useAppStore.setState({
      history: [
        {
          id: "1",
          method: "GET",
          url: "https://example.com",
          timestamp: new Date().toISOString(),
          status: 200,
          requestConfig: baseRequestConfig({ url: "https://example.com" }),
        },
      ],
    });

    const { clearHistory } = useAppStore.getState();
    clearHistory();

    expect(useAppStore.getState().history.length).toBe(0);
  });
});
