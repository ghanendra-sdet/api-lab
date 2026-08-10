import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";

function resetStore() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    responses: {},
    requestStatus: {},
    sendErrors: {},
    abortControllers: {},
  });
}

describe("useAppStore request execution", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a request and stores a normalized response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com/users");
    await sendRequest(activeTabId);

    const state = useAppStore.getState();
    expect(state.responses[activeTabId]?.status).toBe(200);
    expect(state.responses[activeTabId]?.body).toEqual({ ok: true });
    expect(state.requestStatus[activeTabId]).toBe("idle");
  });

  it("does not call fetch and records a validation error for an empty URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "");
    await sendRequest(activeTabId);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().sendErrors[activeTabId]?.field).toBe("url");
    expect(useAppStore.getState().responses[activeTabId]).toBeUndefined();
  });

  it("does not call fetch and records a validation error for invalid JSON body", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { activeTabId, setTabUrl, setTabMethod, setBodyMode, setBodyRawContent, sendRequest } =
      useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com/users");
    setTabMethod(activeTabId, "POST");
    setBodyMode(activeTabId, "raw");
    setBodyRawContent(activeTabId, "{not valid json");

    await sendRequest(activeTabId);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().sendErrors[activeTabId]?.field).toBe("body");
  });

  it("clears a previous validation error on a subsequent successful send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "");
    await sendRequest(activeTabId);
    expect(useAppStore.getState().sendErrors[activeTabId]).toBeDefined();

    setTabUrl(activeTabId, "https://example.com/users");
    await sendRequest(activeTabId);
    expect(useAppStore.getState().sendErrors[activeTabId]).toBeUndefined();
  });

  it("resetRequest clears params, headers, body, and any stored response", () => {
    const { activeTabId, addParamRow, addHeaderRow, setBodyRawContent, resetRequest } =
      useAppStore.getState();
    addParamRow(activeTabId);
    addHeaderRow(activeTabId);
    setBodyRawContent(activeTabId, "{}");
    useAppStore.setState((s) => ({
      responses: { ...s.responses, [activeTabId]: s.responses[activeTabId] },
    }));

    resetRequest(activeTabId);

    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!;
    expect(tab.params).toEqual([]);
    expect(tab.headers).toEqual([]);
    expect(tab.bodyRawContent).toBe("");
    expect(useAppStore.getState().responses[activeTabId]).toBeUndefined();
  });

  it("cancelRequest aborts the in-flight request's signal", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const { activeTabId, setTabUrl, sendRequest, cancelRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com/users");

    const sendPromise = sendRequest(activeTabId);
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    cancelRequest(activeTabId);
    await sendPromise;

    expect(capturedSignal?.aborted).toBe(true);
    expect(useAppStore.getState().responses[activeTabId]?.error).toBe("Request was cancelled.");
  });
});
