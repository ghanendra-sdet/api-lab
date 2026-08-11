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
    testResults: {},
    sendErrors: {},
    tabRuntimeVariables: {},
    runnerDataset: null,
    runnerDatasetName: null,
  });
}

function setupCollectionWithRequests(names: string[], options: { withStatusAssertion?: boolean } = {}) {
  const { createCollection, saveNewRequest, setTabUrl, activeTabId, addAssertion, updateAssertion } = useAppStore.getState();
  const collectionId = createCollection("Runner Collection");
  for (const name of names) {
    setTabUrl(activeTabId, "https://example.com");
    if (options.withStatusAssertion) {
      const assertionId = addAssertion(activeTabId);
      updateAssertion(activeTabId, assertionId, { target: "status", operator: "equals", expected: "200" });
    }
    saveNewRequest(activeTabId, { collectionId }, name);
  }
  return collectionId;
}

describe("useAppStore runner", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs requests sequentially in collection order and reports a summary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));

    const collectionId = setupCollectionWithRequests(["A", "B", "C"]);
    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const state = useAppStore.getState();
    expect(state.runnerState.status).toBe("completed");
    expect(state.runnerState.iterations).toHaveLength(1);
    const items = state.runnerState.iterations[0]!.items;
    expect(items.map((i) => i.name)).toEqual(["A", "B", "C"]);
    // No assertions were defined on any request, so each one executes
    // successfully but has nothing to assert — "skipped", not "passed".
    expect(items.every((i) => i.status === "skipped")).toBe(true);
  });

  it("stops on failure when stopOnFailure is true, leaving later requests skipped", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        // Second request (B) fails its status-equals-200 assertion.
        const status = call === 2 ? 500 : 200;
        return new Response("{}", { status, headers: { "content-type": "application/json" } });
      }),
    );

    const collectionId = setupCollectionWithRequests(["A", "B", "C"], { withStatusAssertion: true });
    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const state = useAppStore.getState();
    const [a, b, c] = state.runnerState.iterations[0]!.items;
    expect(a!.status).toBe("passed");
    expect(b!.status).toBe("failed");
    expect(c!.status).toBe("skipped");
  });

  it("continues past a failure when stopOnFailure is false", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        const status = call === 2 ? 500 : 200;
        return new Response("{}", { status, headers: { "content-type": "application/json" } });
      }),
    );

    const collectionId = setupCollectionWithRequests(["A", "B", "C"], { withStatusAssertion: true });
    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    await useAppStore.getState().startRunner(collectionId, requestIds, null, false);

    const state = useAppStore.getState();
    const [a, b, c] = state.runnerState.iterations[0]!.items;
    expect(a!.status).toBe("passed");
    expect(b!.status).toBe("failed");
    expect(c!.status).toBe("passed");
  });

  it("marks unexecuted requests as cancelled when the run is cancelled mid-flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            // Never resolves on its own — only cancellation ends it.
            setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 50);
          }),
      ),
    );

    const collectionId = setupCollectionWithRequests(["A", "B"]);
    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    const runPromise = useAppStore.getState().startRunner(collectionId, requestIds, null, true);
    await vi.waitFor(() => expect(useAppStore.getState().runnerState.status).toBe("running"));
    useAppStore.getState().cancelRunner();
    await runPromise;

    const state = useAppStore.getState();
    expect(state.runnerState.status).toBe("cancelled");
  });

  it("resetRunner returns to idle", () => {
    useAppStore.setState((s) => ({ runnerState: { ...s.runnerState, status: "completed" } }));
    useAppStore.getState().resetRunner();
    expect(useAppStore.getState().runnerState.status).toBe("idle");
  });

  it("does not touch open tab state while running", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const collectionId = setupCollectionWithRequests(["A"]);
    const tabsBefore = useAppStore.getState().tabs;

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    await useAppStore.getState().startRunner(collectionId, collection.items.map((i) => i.id), null, true);

    expect(useAppStore.getState().tabs).toBe(tabsBefore);
  });
});

describe("useAppStore runner — Milestone 8: chaining, datasets, isolation", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chains a value extracted from one request into a later request's header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes("/a")) {
          return new Response(JSON.stringify({ token: "abc" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const headers = new Headers(init?.headers);
        const auth = headers.get("authorization");
        return new Response(JSON.stringify({ received: auth }), {
          status: auth === "Bearer abc" ? 200 : 500,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, addExtraction, updateExtraction, addHeaderRow, updateHeaderRow, addAssertion, updateAssertion } =
      useAppStore.getState();
    const collectionId = createCollection("Chaining Collection");

    setTabUrl(activeTabId, "https://example.com/a");
    const extractionId = addExtraction(activeTabId);
    updateExtraction(activeTabId, extractionId, { source: "json", path: "$.token", variable: "authToken" });
    saveNewRequest(activeTabId, { collectionId }, "Login");

    useAppStore.getState().openNewTab();
    const tabB = useAppStore.getState().activeTabId;
    setTabUrl(tabB, "https://example.com/b");
    addHeaderRow(tabB);
    const headerRow = useAppStore.getState().tabs.find((t) => t.id === tabB)!.headers[0]!;
    updateHeaderRow(tabB, headerRow.id, { key: "Authorization", value: "Bearer {{authToken}}", enabled: true });
    const assertionId = addAssertion(tabB);
    updateAssertion(tabB, assertionId, { target: "status", operator: "equals", expected: "200" });
    saveNewRequest(tabB, { collectionId }, "Whoami");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);
    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const state = useAppStore.getState();
    const [login, whoami] = state.runnerState.iterations[0]!.items;
    expect(login!.extractionResults?.[0]).toMatchObject({ ok: true, value: "abc" });
    expect(whoami!.status).toBe("passed");
  });

  it("runs one iteration per dataset row and substitutes iteration variables into the request", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requestedUrls.push(input.toString());
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, setRunnerDataset } = useAppStore.getState();
    const collectionId = createCollection("Dataset Collection");
    setTabUrl(activeTabId, "https://example.com/items/{{id}}");
    saveNewRequest(activeTabId, { collectionId }, "Get Item");

    setRunnerDataset({ columns: ["id"], rows: [{ id: "1" }, { id: "2" }] }, "items.json");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);
    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const state = useAppStore.getState();
    expect(state.runnerState.iterations).toHaveLength(2);
    expect(state.runnerState.datasetName).toBe("items.json");
    expect(requestedUrls).toEqual(["https://example.com/items/1", "https://example.com/items/2"]);
  });

  it("keeps runtime variables isolated between iterations — an extraction in one row never leaks into the next", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes("/login")) {
          const id = new URL(url).searchParams.get("id");
          return new Response(JSON.stringify({ token: `tok-${id}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const headers = new Headers(init?.headers);
        return new Response(JSON.stringify({ received: headers.get("authorization") }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, addExtraction, updateExtraction, addHeaderRow, updateHeaderRow, setRunnerDataset } =
      useAppStore.getState();
    const collectionId = createCollection("Isolation Collection");

    setTabUrl(activeTabId, "https://example.com/login?id={{id}}");
    const extractionId = addExtraction(activeTabId);
    updateExtraction(activeTabId, extractionId, { source: "json", path: "$.token", variable: "authToken" });
    saveNewRequest(activeTabId, { collectionId }, "Login");

    useAppStore.getState().openNewTab();
    const tabB = useAppStore.getState().activeTabId;
    setTabUrl(tabB, "https://example.com/whoami");
    addHeaderRow(tabB);
    const headerRow = useAppStore.getState().tabs.find((t) => t.id === tabB)!.headers[0]!;
    updateHeaderRow(tabB, headerRow.id, { key: "Authorization", value: "{{authToken}}", enabled: true });
    saveNewRequest(tabB, { collectionId }, "Whoami");

    setRunnerDataset({ columns: ["id"], rows: [{ id: "1" }, { id: "2" }] }, "ids.json");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);
    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const state = useAppStore.getState();
    const [iter1, iter2] = state.runnerState.iterations;
    expect(iter1!.items[0]!.extractionResults?.[0]).toMatchObject({ ok: true, value: "tok-1" });
    expect(iter2!.items[0]!.extractionResults?.[0]).toMatchObject({ ok: true, value: "tok-2" });
    expect(iter1!.items[1]!.response?.body).toMatchObject({ received: "tok-1" });
    expect(iter2!.items[1]!.response?.body).toMatchObject({ received: "tok-2" });
  });

  it("keeps runtime variables isolated between separate startRunner calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ token: "abc" }), { status: 200, headers: { "content-type": "application/json" } })),
    );

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, addExtraction, updateExtraction } = useAppStore.getState();
    const collectionId = createCollection("Repeat Collection");
    setTabUrl(activeTabId, "https://example.com/login");
    const extractionId = addExtraction(activeTabId);
    updateExtraction(activeTabId, extractionId, { source: "json", path: "$.token", variable: "authToken" });
    saveNewRequest(activeTabId, { collectionId }, "Login");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);
    // The Runner's own execution never writes to `tabRuntimeVariables`
    // (that's the tab-Send-only chaining map) — a fresh startRunner call
    // starts with an empty runtime map regardless of a prior run's results.
    expect(useAppStore.getState().tabRuntimeVariables).toEqual({});

    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);
    const state = useAppStore.getState();
    expect(state.runnerState.iterations[0]!.items[0]!.extractionResults?.[0]).toMatchObject({ ok: true, value: "abc" });
  });
});
