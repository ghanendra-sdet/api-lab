/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";
import { flattenCollectionRequests } from "../lib/runner";

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
    runnerDelayMs: 0,
    runnerIterations: 1,
    runnerHistory: [],
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

  it("runs dependency chains in Collection Runner with correct ordering, no duplicates, and runtime propagation", async () => {
    const urlsCalled: string[] = [];
    let bAuth = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = url.toString();
        urlsCalled.push(u);
        if (u.includes("/login")) {
          return new Response(JSON.stringify({ token: "runner-token-123" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (u.includes("/whoami")) {
          const hdrs = init ? ((init as RequestInit).headers as Record<string, string>) : {};
          bAuth = hdrs["Authorization"] || "";
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, addExtraction, updateExtraction, updateHeaderRow, addHeaderRow } = useAppStore.getState();
    const collectionId = createCollection("Dependency Runner Collection");
    
    // Create A (Login)
    setTabUrl(activeTabId, "https://example.com/login");
    const extId = addExtraction(activeTabId);
    updateExtraction(activeTabId, extId, { source: "json", path: "$.token", variable: "token" });
    saveNewRequest(activeTabId, { collectionId }, "Login");

    const collectionSnapshot = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const loginId = collectionSnapshot.items.find(i => i.name === "Login")!.id;

    // Create B (Whoami)
    const freshTab = createEmptyTab();
    useAppStore.setState({ tabs: [freshTab], activeTabId: freshTab.id });
    setTabUrl(freshTab.id, "https://example.com/whoami");
    addHeaderRow(freshTab.id);
    const hdrId = useAppStore.getState().tabs[0]!.headers[0]!.id;
    updateHeaderRow(freshTab.id, hdrId, { key: "Authorization", value: "Bearer {{token}}", enabled: true });
    
    // Set dependency
    const workspace = useAppStore.getState().workspace;
    const tabC = useAppStore.getState().tabs[0]!;
    tabC.dependsOn = [loginId];
    useAppStore.setState({ workspace });

    saveNewRequest(tabC.id, { collectionId }, "Whoami");

    const finalCol = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const whoamiId = finalCol.items.find(i => i.name === "Whoami")!.id;

    // Run the Collection Runner selecting ONLY "Whoami"
    await useAppStore.getState().startRunner(collectionId, [whoamiId], null, true);

    expect(urlsCalled).toEqual(["https://example.com/login", "https://example.com/whoami"]);
    expect(bAuth).toBe("Bearer runner-token-123");

    const state = useAppStore.getState();
    expect(state.runnerState.status).toBe("completed");
    
    // Since only Whoami was explicitly requested, only Whoami is in the runner items,
    // but the runner executed Login as a prerequisite behind the scenes
    const runnerItems = state.runnerState.iterations[0]!.items;
    expect(runnerItems).toHaveLength(1);
    expect(runnerItems[0]!.requestId).toBe(whoamiId);
    expect(runnerItems[0]!.status).toBe("skipped"); // no assertions
  });

  it("applies inter-request delays correctly during execution", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, setRunnerDelayMs } = useAppStore.getState();
    const collectionId = createCollection("Delay Collection");
    
    setTabUrl(activeTabId, "https://example.com/a");
    saveNewRequest(activeTabId, { collectionId }, "A");

    const freshTab = createEmptyTab();
    useAppStore.setState({ tabs: [freshTab], activeTabId: freshTab.id });
    setTabUrl(freshTab.id, "https://example.com/b");
    saveNewRequest(freshTab.id, { collectionId }, "B");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    setRunnerDelayMs(100);

    const start = Date.now();
    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);
    const end = Date.now();

    expect(end - start).toBeGreaterThanOrEqual(100);
    const state = useAppStore.getState();
    expect(state.runnerState.status).toBe("completed");
  });

  it("cancels runner delays immediately without hanging when cancelled mid-flight", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, setRunnerDelayMs, cancelRunner } = useAppStore.getState();
    const collectionId = createCollection("Cancel Delay Collection");
    
    setTabUrl(activeTabId, "https://example.com/a");
    saveNewRequest(activeTabId, { collectionId }, "A");

    const freshTab = createEmptyTab();
    useAppStore.setState({ tabs: [freshTab], activeTabId: freshTab.id });
    setTabUrl(freshTab.id, "https://example.com/b");
    saveNewRequest(freshTab.id, { collectionId }, "B");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    setRunnerDelayMs(5000); // 5 seconds delay

    const start = Date.now();
    const runnerPromise = useAppStore.getState().startRunner(collectionId, requestIds, null, true);
    
    // Cancel almost immediately
    setTimeout(() => {
      cancelRunner();
    }, 50);

    await runnerPromise;
    const end = Date.now();

    expect(end - start).toBeLessThan(1000); // Must finish long before 5 seconds
    const state = useAppStore.getState();
    expect(state.runnerState.status).toBe("cancelled");
  });

  it("halts execution on target request extraction failure when stopOnFailure is true", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, addExtraction, updateExtraction } = useAppStore.getState();
    const collectionId = createCollection("Extraction Failure Collection");
    
    // A: Fails extraction (looking for missing token in empty response)
    setTabUrl(activeTabId, "https://example.com/a");
    const extId = addExtraction(activeTabId);
    updateExtraction(activeTabId, extId, { source: "json", path: "$.missing_token", variable: "token" });
    saveNewRequest(activeTabId, { collectionId }, "A");

    // B: Skipped because A fails extraction and stopOnFailure is true
    const freshTab = createEmptyTab();
    useAppStore.setState({ tabs: [freshTab], activeTabId: freshTab.id });
    setTabUrl(freshTab.id, "https://example.com/b");
    saveNewRequest(freshTab.id, { collectionId }, "B");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const state = useAppStore.getState();
    const [itemA, itemB] = state.runnerState.iterations[0]!.items;
    expect(itemA!.status).toBe("error");
    expect(itemA!.extractionResults?.[0]?.ok).toBe(false);
    expect(itemB!.status).toBe("skipped");
  });

  it("continues execution past target request extraction failure when stopOnFailure is false", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      console.log("Mock fetch invoked for:", url.toString());
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, addExtraction, updateExtraction } = useAppStore.getState();
    const collectionId = createCollection("Extraction Fail Collection 2");
    
    // A: Fails extraction
    setTabUrl(activeTabId, "https://example.com/a");
    const extId = addExtraction(activeTabId);
    updateExtraction(activeTabId, extId, { source: "json", path: "$.missing_token", variable: "token" });
    saveNewRequest(activeTabId, { collectionId }, "A");

    // B: Still runs since stopOnFailure is false
    const freshTab = createEmptyTab();
    useAppStore.setState({ tabs: [freshTab], activeTabId: freshTab.id });
    setTabUrl(freshTab.id, "https://example.com/b");
    saveNewRequest(freshTab.id, { collectionId }, "B");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    const requestIds = collection.items.map((i) => i.id);

    await useAppStore.getState().startRunner(collectionId, requestIds, null, false);

    const state = useAppStore.getState();
    const [itemA, itemB] = state.runnerState.iterations[0]!.items;
    expect(itemA!.status).toBe("error");
    expect(itemB!.status).toBe("skipped"); // no assertions on B, so it executes and skips assertions
  });

  describe("useAppStore runner — Milestone C.2: Folder Runner", () => {
    beforeEach(() => {
      resetStore();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("runs only requests inside the target folder and skips sibling folder requests", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }));

      const { createCollection, createFolder, saveNewRequest, activeTabId, setTabUrl } = useAppStore.getState();
      const collectionId = createCollection("Folder Run Collection");
      const folderAId = createFolder(collectionId, "Folder A");
      const folderBId = createFolder(collectionId, "Folder B");

      // Request A1 in Folder A
      setTabUrl(activeTabId, "https://example.com/a1");
      saveNewRequest(activeTabId, { collectionId, folderId: folderAId }, "A1");

      // Request A2 in Folder A
      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/a2");
      saveNewRequest(tab2.id, { collectionId, folderId: folderAId }, "A2");

      // Request B1 in Folder B
      const tab3 = createEmptyTab();
      useAppStore.setState({ tabs: [tab3], activeTabId: tab3.id });
      setTabUrl(tab3.id, "https://example.com/b1");
      saveNewRequest(tab3.id, { collectionId, folderId: folderBId }, "B1");

      const state = useAppStore.getState();
      const collection = state.workspace.collections.find((c) => c.id === collectionId)!;
      
      // Get only requests in Folder A
      const folderA: any = collection.items.find((item) => item.type === "folder" && item.id === folderAId)!;
      const requestIds = folderA.items.map((i: any) => i.id);

      await state.startRunner(collectionId, requestIds, null, true, folderAId);

      const run = useAppStore.getState().runnerState;
      expect(run.status).toBe("completed");
      expect(run.folderId).toBe(folderAId);
      expect(run.iterations[0]!.items.length).toBe(2);
      expect(run.iterations[0]!.items[0]!.name).toBe("A1");
      expect(run.iterations[0]!.items[0]!.status).toBe("skipped"); // no assertions
      expect(run.iterations[0]!.items[1]!.name).toBe("A2");
      expect(run.iterations[0]!.items[1]!.status).toBe("skipped"); // no assertions
    });

    it("executes external prerequisite outside the folder only once and propagates variables", async () => {
      let callCount = 0;
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        callCount++;
        if (url.toString().includes("login")) {
          return new Response(JSON.stringify({ token: "my-secret-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }));

      const { createCollection, createFolder, saveNewRequest, activeTabId, setTabUrl, addExtraction, updateExtraction, addHeaderRow, updateHeaderRow } = useAppStore.getState();
      const collectionId = createCollection("Dependency Collection");
      const authFolderId = createFolder(collectionId, "Auth");
      const userFolderId = createFolder(collectionId, "Users");

      // Login in Auth folder, extracts token
      setTabUrl(activeTabId, "https://example.com/login");
      const extId = addExtraction(activeTabId);
      updateExtraction(activeTabId, extId, { source: "json", path: "$.token", variable: "sessionToken" });
      saveNewRequest(activeTabId, { collectionId, folderId: authFolderId }, "Login");

      const collSnap1 = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const fAuth = collSnap1.items.find((i) => i.id === authFolderId)! as any;
      const loginReqId = fAuth.items.find((r: any) => r.name === "Login")!.id;

      // Get Users in Users folder, depends on Login
      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/users");
      addHeaderRow(tab2.id);
      const hdrId = useAppStore.getState().tabs.find((t) => t.id === tab2.id)!.headers[0]!.id;
      updateHeaderRow(tab2.id, hdrId, { key: "Authorization", value: "Bearer {{sessionToken}}", enabled: true });
      useAppStore.getState().tabs.find((t) => t.id === tab2.id)!.dependsOn = [loginReqId];
      saveNewRequest(tab2.id, { collectionId, folderId: userFolderId }, "Get Users");

      const collSnap2 = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const fUsers = collSnap2.items.find((i) => i.id === userFolderId)! as any;
      const getUsersReqId = fUsers.items.find((r: any) => r.name === "Get Users")!.id;

      const state = useAppStore.getState();
      
      // Run the Users folder only
      await state.startRunner(collectionId, [getUsersReqId], null, true, userFolderId);

      const run = useAppStore.getState().runnerState;
      expect(run.status).toBe("completed");
      expect(run.iterations[0]!.items.length).toBe(1);
      expect(run.iterations[0]!.items[0]!.name).toBe("Get Users");
      expect(run.iterations[0]!.items[0]!.status).toBe("skipped");

      // Prerequisite Login must have executed exactly once
      expect(callCount).toBe(2); // Login and Get Users
    });

    it("fails with circular dependency error when external dependency has cycles", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        return new Response("{}", { status: 200 });
      }));

      const { createCollection, createFolder, saveNewRequest, activeTabId, setTabUrl } = useAppStore.getState();
      const collectionId = createCollection("Circular Collection");
      const folderAId = createFolder(collectionId, "Folder A");
      const folderBId = createFolder(collectionId, "Folder B");

      // Request A depends on B
      setTabUrl(activeTabId, "https://example.com/a");
      saveNewRequest(activeTabId, { collectionId, folderId: folderAId }, "A");

      // Request B depends on A
      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/b");
      saveNewRequest(tab2.id, { collectionId, folderId: folderBId }, "B");

      const snap1 = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const fA: any = snap1.items.find((item) => item.id === folderAId)!;
      const fB: any = snap1.items.find((item) => item.id === folderBId)!;
      const reqAId = fA.items.find((r: any) => r.name === "A")!.id;
      const reqBId = fB.items.find((r: any) => r.name === "B")!.id;

      // Setup cycle A <-> B
      useAppStore.setState((s) => {
        const collections = [...s.workspace.collections];
        const coll = collections.find((c) => c.id === collectionId)!;
        const folderA: any = coll.items.find((item) => item.id === folderAId)!;
        const folderB: any = coll.items.find((item) => item.id === folderBId)!;
        folderA.items.find((r: any) => r.id === reqAId)!.request.dependsOn = [reqBId];
        folderB.items.find((r: any) => r.id === reqBId)!.request.dependsOn = [reqAId];
        return { workspace: { ...s.workspace, collections } };
      });

      const state = useAppStore.getState();
      
      // Run folder A
      await state.startRunner(collectionId, [reqAId], null, true, folderAId);

      const run = useAppStore.getState().runnerState;
      expect(run.iterations[0]!.items[0]!.status).toBe("error");
      expect(run.iterations[0]!.items[0]!.validationError?.message).toContain("Circular dependency detected");
    });

    it("halts folder run on failure when stopOnFailure is enabled", async () => {
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        if (url.toString().includes("fail")) {
          return new Response("{}", { status: 500 });
        }
        return new Response("{}", { status: 200 });
      }));

      const { createCollection, createFolder, saveNewRequest, activeTabId, setTabUrl, addAssertion, updateAssertion } = useAppStore.getState();
      const collectionId = createCollection("Stop On Failure Coll");
      const folderId = createFolder(collectionId, "Folder F");

      // Req A: fails
      setTabUrl(activeTabId, "https://example.com/fail");
      const assertionId = addAssertion(activeTabId);
      updateAssertion(activeTabId, assertionId, { target: "status", operator: "equals", expected: "200" });
      saveNewRequest(activeTabId, { collectionId, folderId }, "A");

      // Req B: skips
      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/ok");
      saveNewRequest(tab2.id, { collectionId, folderId }, "B");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const folder: any = snap.items.find((item) => item.id === folderId)!;
      const reqAId = folder.items.find((r: any) => r.name === "A")!.id;
      const reqBId = folder.items.find((r: any) => r.name === "B")!.id;

      const state = useAppStore.getState();
      await state.startRunner(collectionId, [reqAId, reqBId], null, true, folderId);

      const run = useAppStore.getState().runnerState;
      expect(run.iterations[0]!.items[0]!.status).toBe("failed");
      expect(run.iterations[0]!.items[1]!.status).toBe("skipped");
    });

    it("runs multiple iterations with isolated contexts using datasets in folder execution", async () => {
      let callCount = 0;
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        callCount++;
        if (url.toString().includes("login")) {
          // returns a different token depending on calls
          return new Response(JSON.stringify({ token: `tok-${callCount}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }));

      const { createCollection, createFolder, saveNewRequest, activeTabId, setTabUrl, addExtraction, updateExtraction, addHeaderRow, updateHeaderRow, setRunnerDataset } = useAppStore.getState();
      const collectionId = createCollection("Dataset Folder Collection");
      const folderId = createFolder(collectionId, "Folder F");

      // Login
      setTabUrl(activeTabId, "https://example.com/login");
      const extId = addExtraction(activeTabId);
      updateExtraction(activeTabId, extId, { source: "json", path: "$.token", variable: "token" });
      saveNewRequest(activeTabId, { collectionId, folderId }, "Login");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const folder: any = snap.items.find((item) => item.id === folderId)!;
      const loginReqId = folder.items.find((r: any) => r.name === "Login")!.id;

      // Whoami
      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/whoami");
      addHeaderRow(tab2.id);
      const hdrId = useAppStore.getState().tabs.find((t) => t.id === tab2.id)!.headers[0]!.id;
      updateHeaderRow(tab2.id, hdrId, { key: "Authorization", value: "Bearer {{token}}", enabled: true });
      useAppStore.getState().tabs.find((t) => t.id === tab2.id)!.dependsOn = [loginReqId];
      saveNewRequest(tab2.id, { collectionId, folderId }, "Whoami");

      const snap2 = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const folder2: any = snap2.items.find((item) => item.id === folderId)!;
      const whoamiReqId = folder2.items.find((r: any) => r.name === "Whoami")!.id;

      // Setup 2 rows of dataset
      setRunnerDataset({
        columns: ["dummy"],
        rows: [{ dummy: "1" }, { dummy: "2" }],
      }, "test.json");

      const state = useAppStore.getState();
      await state.startRunner(collectionId, [whoamiReqId], null, true, folderId);

      const run = useAppStore.getState().runnerState;
      expect(run.iterations.length).toBe(2);
      expect(run.iterations[0]!.items[0]!.status).toBe("skipped");
      expect(run.iterations[1]!.items[0]!.status).toBe("skipped");
    });

    it("supports runner delays between requests during folder runs", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        return new Response("{}", { status: 200 });
      }));

      const { createCollection, createFolder, saveNewRequest, activeTabId, setTabUrl, setRunnerDelayMs } = useAppStore.getState();
      const collectionId = createCollection("Delay Folder Collection");
      const folderId = createFolder(collectionId, "Folder F");

      setTabUrl(activeTabId, "https://example.com/a");
      saveNewRequest(activeTabId, { collectionId, folderId }, "A");

      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/b");
      saveNewRequest(tab2.id, { collectionId, folderId }, "B");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const folder: any = snap.items.find((item) => item.id === folderId)!;
      const reqAId = folder.items.find((r: any) => r.name === "A")!.id;
      const reqBId = folder.items.find((r: any) => r.name === "B")!.id;

      // Setup 250ms delay
      setRunnerDelayMs(250);

      const state = useAppStore.getState();
      const runPromise = state.startRunner(collectionId, [reqAId, reqBId], null, true, folderId);

      // Let first request complete, then expect delay sleep
      await vi.advanceTimersByTimeAsync(50);
      expect(useAppStore.getState().runnerState.status).toBe("running");

      // Advance past delay
      await vi.advanceTimersByTimeAsync(250);
      await runPromise;

      const run = useAppStore.getState().runnerState;
      expect(run.status).toBe("completed");
    });
  });

  describe("useAppStore runner — Milestone C.3: Manual Iteration Count", () => {
    it("runs once by default when no dataset is present", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

      const { createCollection, saveNewRequest, activeTabId, setTabUrl } = useAppStore.getState();
      const collectionId = createCollection("Default Iter Collection");
      setTabUrl(activeTabId, "https://example.com/a");
      saveNewRequest(activeTabId, { collectionId }, "A");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const reqId = snap.items[0]!.id;

      const state = useAppStore.getState();
      await state.startRunner(collectionId, [reqId], null, true);

      const run = useAppStore.getState().runnerState;
      expect(run.iterations.length).toBe(1);
    });

    it("runs exactly three times when configured with manual iteration count = 3", async () => {
      let callCount = 0;
      vi.stubGlobal("fetch", vi.fn(async () => {
        callCount++;
        return new Response("{}", { status: 200 });
      }));

      const { createCollection, saveNewRequest, activeTabId, setTabUrl, setRunnerIterations } = useAppStore.getState();
      const collectionId = createCollection("Iter 3 Collection");
      setTabUrl(activeTabId, "https://example.com/a");
      saveNewRequest(activeTabId, { collectionId }, "A");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const reqId = snap.items[0]!.id;

      setRunnerIterations(3);

      const state = useAppStore.getState();
      await state.startRunner(collectionId, [reqId], null, true);

      const run = useAppStore.getState().runnerState;
      expect(run.iterations.length).toBe(3);
      expect(callCount).toBe(3);
    });

    it("keeps runtime contexts completely isolated between manual iterations", async () => {
      let callCount = 0;
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        callCount++;
        if (url.toString().includes("a")) {
          return new Response(JSON.stringify({ token: `tok-${callCount}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }));

      const { createCollection, saveNewRequest, activeTabId, setTabUrl, addExtraction, updateExtraction, addHeaderRow, updateHeaderRow, setRunnerIterations } = useAppStore.getState();
      const collectionId = createCollection("Context Isolation Collection");

      // Req A: Extracts "token"
      setTabUrl(activeTabId, "https://example.com/a");
      const extId = addExtraction(activeTabId);
      updateExtraction(activeTabId, extId, { source: "json", path: "$.token", variable: "token" });
      saveNewRequest(activeTabId, { collectionId }, "A");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const reqAId = snap.items.find((item: any) => item.name === "A")!.id;

      // Req B: Consumes "token" in Header
      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/b");
      addHeaderRow(tab2.id);
      const hdrId = useAppStore.getState().tabs.find((t) => t.id === tab2.id)!.headers[0]!.id;
      updateHeaderRow(tab2.id, hdrId, { key: "Authorization", value: "Bearer {{token}}", enabled: true });
      saveNewRequest(tab2.id, { collectionId }, "B");

      const snap2 = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const reqBId = snap2.items.find((item: any) => item.name === "B")!.id;

      setRunnerIterations(2);

      const state = useAppStore.getState();
      await state.startRunner(collectionId, [reqAId, reqBId], null, true);

      // Verify that iteration 2's request B used token `tok-3` (from iteration 2's A), not `tok-1`
      const calls = vi.mocked(fetch).mock.calls;
      const bCalls = calls.filter((c) => c[0].toString().includes("b"));
      expect(bCalls.length).toBe(2);
      expect(bCalls[0]![1]!.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer tok-1",
      }));
      expect(bCalls[1]![1]!.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer tok-3",
      }));
    });

    it("runs folder execution multiple times with manual iterations and preserves B3 external dependencies", async () => {
      let callCount = 0;
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        callCount++;
        if (url.toString().includes("login")) {
          return new Response(JSON.stringify({ token: `t-${callCount}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }));

      const { createCollection, createFolder, saveNewRequest, activeTabId, setTabUrl, addExtraction, updateExtraction, addHeaderRow, updateHeaderRow, setRunnerIterations } = useAppStore.getState();
      const collectionId = createCollection("Folder Iter Collection");
      const folderId = createFolder(collectionId, "Users");

      // Req Login (prerequisite outside folder)
      setTabUrl(activeTabId, "https://example.com/login");
      const extId = addExtraction(activeTabId);
      updateExtraction(activeTabId, extId, { source: "json", path: "$.token", variable: "token" });
      saveNewRequest(activeTabId, { collectionId }, "Login");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const loginId = snap.items.find((item: any) => item.name === "Login")!.id;

      // Req Whoami (inside folder "Users", depends on Login)
      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/whoami");
      addHeaderRow(tab2.id);
      const hdrId = useAppStore.getState().tabs.find((t) => t.id === tab2.id)!.headers[0]!.id;
      updateHeaderRow(tab2.id, hdrId, { key: "Authorization", value: "Bearer {{token}}", enabled: true });
      useAppStore.getState().tabs.find((t) => t.id === tab2.id)!.dependsOn = [loginId];
      saveNewRequest(tab2.id, { collectionId, folderId }, "Whoami");

      const snap2 = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const folder: any = snap2.items.find((item: any) => item.id === folderId)!;
      const whoamiId = folder.items.find((r: any) => r.name === "Whoami")!.id;

      setRunnerIterations(2);

      const state = useAppStore.getState();
      await state.startRunner(collectionId, [whoamiId], null, true, folderId);

      const run = useAppStore.getState().runnerState;
      expect(run.iterations.length).toBe(2);

      // Verify fetch calls order: Login -> Whoami -> Login -> Whoami
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls.map((c) => c[0].toString())).toEqual([
        "https://example.com/login",
        "https://example.com/whoami",
        "https://example.com/login",
        "https://example.com/whoami",
      ]);
    });

    it("halts manual iterations when stopOnFailure is true and continues when false", async () => {
      let fails = true;
      vi.stubGlobal("fetch", vi.fn(async () => {
        if (fails) {
          fails = false; // first call fails
          return new Response("{}", { status: 500 });
        }
        return new Response("{}", { status: 200 });
      }));

      const { createCollection, saveNewRequest, activeTabId, setTabUrl, addAssertion, updateAssertion, setRunnerIterations } = useAppStore.getState();
      const collectionId = createCollection("Stop On Failure Iter Collection");

      setTabUrl(activeTabId, "https://example.com/a");
      const assertionId = addAssertion(activeTabId);
      updateAssertion(activeTabId, assertionId, { target: "status", operator: "equals", expected: "200" });
      saveNewRequest(activeTabId, { collectionId }, "A");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const reqId = snap.items[0]!.id;

      // Case 1: stopOnFailure is true (halts on iteration 1)
      setRunnerIterations(3);
      let state = useAppStore.getState();
      await state.startRunner(collectionId, [reqId], null, true);

      let run = useAppStore.getState().runnerState;
      expect(run.iterations.length).toBe(3);
      expect(run.iterations[0]!.items[0]!.status).toBe("failed");
      expect(run.iterations[1]!.items[0]!.status).toBe("skipped");
      expect(run.iterations[2]!.items[0]!.status).toBe("skipped");

      // Case 2: stopOnFailure is false (runs iteration 2 and 3 despite iteration 1 failure)
      fails = true; // reset fail state
      setRunnerIterations(3);
      state = useAppStore.getState();
      await state.startRunner(collectionId, [reqId], null, false);

      run = useAppStore.getState().runnerState;
      expect(run.iterations[0]!.items[0]!.status).toBe("failed");
      expect(run.iterations[1]!.items[0]!.status).toBe("passed");
      expect(run.iterations[2]!.items[0]!.status).toBe("passed");
    });
  });

  describe("runner run history", () => {
    it("creates history entry on successful run", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
      const collectionId = setupCollectionWithRequests(["A"], { withStatusAssertion: true });
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const requestIds = collection.items.map((i) => i.id);

      await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

      const history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(1);
      expect(history[0]!.collectionId).toBe(collectionId);
      expect(history[0]!.overallStatus).toBe("passed");
      expect(history[0]!.passedCount).toBe(1);
      expect(history[0]!.failedCount).toBe(0);
      expect(history[0]!.iterations.length).toBe(1);
    });

    it("creates history entry on failed run", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
      const collectionId = setupCollectionWithRequests(["A"], { withStatusAssertion: true });
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const requestIds = collection.items.map((i) => i.id);

      await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

      const history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(1);
      expect(history[0]!.overallStatus).toBe("failed");
      expect(history[0]!.passedCount).toBe(0);
      expect(history[0]!.failedCount).toBe(1);
    });

    it("creates history entry on cancelled run", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        useAppStore.getState().cancelRunner();
        return new Response("{}", { status: 200 });
      }));
      const collectionId = setupCollectionWithRequests(["A", "B"]);
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const requestIds = collection.items.map((i) => i.id);

      await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

      const history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(1);
      expect(history[0]!.overallStatus).toBe("cancelled");
    });

    it("creates history entry for folder run with correct scope", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
      const { createCollection, createFolder, saveNewRequest, activeTabId, setTabUrl } = useAppStore.getState();
      const collectionId = createCollection("Run Folder History Collection");
      const folderId = createFolder(collectionId, "Folder A");
      
      setTabUrl(activeTabId, "https://example.com/folder-item");
      saveNewRequest(activeTabId, { collectionId, folderId }, "FolderItem1");

      const runStore = useAppStore.getState();
      const collection = runStore.workspace.collections.find((c) => c.id === collectionId)!;
      const requests = flattenCollectionRequests(collection).filter((r) => r.location.folderId === folderId);
      const requestIds = requests.map((r) => r.id);

      await useAppStore.getState().startRunner(collectionId, requestIds, null, true, folderId);

      const history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(1);
      expect(history[0]!.folderId).toBe(folderId);
      expect(history[0]!.folderName).toBe("Folder A");
    });

    it("prunes response body and headers from history entries", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ secret: "data" }), {
        status: 200,
        headers: { "x-custom": "header-value" }
      })));
      const collectionId = setupCollectionWithRequests(["A"]);
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const requestIds = collection.items.map((i) => i.id);

      await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

      const run = useAppStore.getState().runnerState;
      expect(run.iterations[0]!.items[0]!.response?.body).toBeDefined();

      const history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(1);
      const histItem = history[0]!.iterations[0]!.items[0]!;
      expect(histItem.response).toBeDefined();
      expect((histItem.response as any).body).toBeUndefined();
      expect((histItem.response as any).rawBody).toBeUndefined();
      expect((histItem.response as any).headers).toBeUndefined();
      expect(histItem.response!.status).toBe(200);
    });

    it("enforces history retention limits to max 50 entries", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
      const collectionId = setupCollectionWithRequests(["A"]);
      const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const requestIds = collection.items.map((i) => i.id);

      const existingHistory: any[] = Array.from({ length: 52 }, (_, i) => ({
        id: `run_${i}`,
        collectionId,
        collectionName: "Old Run",
        startedAt: Date.now() - i * 1000,
        endedAt: Date.now() - i * 1000 + 50,
        iterations: []
      }));
      useAppStore.setState({ runnerHistory: existingHistory });

      await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

      const history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(50);
      expect(history[0]!.id).not.toBe("run_0");
    });

    it("deletes individual entries and clears whole history", async () => {
      const run1: any = { id: "1", collectionId: "c1", collectionName: "C1", folderId: null, startedAt: 1, endedAt: 2, iterations: [] };
      const run2: any = { id: "2", collectionId: "c2", collectionName: "C2", folderId: null, startedAt: 3, endedAt: 4, iterations: [] };
      useAppStore.setState({ runnerHistory: [run1, run2] });

      useAppStore.getState().removeRunnerHistoryEntry("1");
      expect(useAppStore.getState().runnerHistory.length).toBe(1);
      expect(useAppStore.getState().runnerHistory[0]!.id).toBe("2");

      useAppStore.getState().clearRunnerHistory();
      expect(useAppStore.getState().runnerHistory.length).toBe(0);
    });

    it("clears runner history scoped to collection and folder", async () => {
      const run1: any = { id: "1", collectionId: "colA", folderId: null, iterations: [] };
      const run2: any = { id: "2", collectionId: "colA", folderId: "foldX", iterations: [] };
      const run3: any = { id: "3", collectionId: "colB", folderId: null, iterations: [] };
      useAppStore.setState({ runnerHistory: [run1, run2, run3] });

      // Clear collection A folder X scope
      useAppStore.getState().clearRunnerHistory("colA", "foldX");
      let history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(2);
      expect(history.map(h => h.id)).toEqual(["1", "3"]);

      // Clear collection A collection-wide (folderId = null) scope
      useAppStore.getState().clearRunnerHistory("colA", null);
      history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(1);
      expect(history[0]!.id).toBe("3");
    });

    it("verifies live execution value extraction works and propagates, while persisted history redacts value", async () => {
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        if (url.toString().includes("a")) {
          return new Response(JSON.stringify({ token: "SUPER_SECRET_TEST_TOKEN_123" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }));

      const { createCollection, saveNewRequest, activeTabId, setTabUrl, addExtraction, updateExtraction, addHeaderRow, updateHeaderRow, setTabDependsOn } = useAppStore.getState();
      const collectionId = createCollection("Security Chain Collection");

      // Req A extracts token
      setTabUrl(activeTabId, "https://example.com/a");
      const extId = addExtraction(activeTabId);
      updateExtraction(activeTabId, extId, { source: "json", path: "$.token", variable: "token" });
      saveNewRequest(activeTabId, { collectionId }, "A");

      const snap = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const reqAId = snap.items.find((item: any) => item.name === "A")!.id;

      // Req B headers use {{token}}
      const tab2 = createEmptyTab();
      useAppStore.setState({ tabs: [tab2], activeTabId: tab2.id });
      setTabUrl(tab2.id, "https://example.com/b");
      addHeaderRow(tab2.id);
      const snapHdr = useAppStore.getState().tabs.find((t) => t.id === tab2.id)!;
      const hdrId = snapHdr.headers[0]!.id;
      updateHeaderRow(tab2.id, hdrId, { key: "Authorization", value: "Bearer {{token}}" });
      setTabDependsOn(tab2.id, [reqAId]);
      saveNewRequest(tab2.id, { collectionId }, "B");

      const snap2 = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
      const reqBId = snap2.items.find((item: any) => item.name === "B")!.id;

      // Execute run
      await useAppStore.getState().startRunner(collectionId, [reqAId, reqBId], null, true);

      // 1. Verify live runner execution contains the token and propagated it
      const calls = vi.mocked(fetch).mock.calls;
      const bCalls = calls.filter((c) => c[0].toString().includes("b"));
      expect(bCalls.length).toBe(1);
      expect(bCalls[0]![1]!.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer SUPER_SECRET_TEST_TOKEN_123",
      }));

      // 2. Verify persisted history has redacted the token
      const history = useAppStore.getState().runnerHistory;
      expect(history.length).toBe(1);
      const histItem = history[0]!.iterations[0]!.items[0]!;
      expect(histItem.extractionResults).toBeDefined();
      expect(histItem.extractionResults!.length).toBe(1);
      
      const extResult = histItem.extractionResults![0]!;
      expect(extResult.ok).toBe(true);
      expect((extResult as any).value).toBeUndefined(); // value is redacted/deleted
      expect(extResult.extraction.variable).toBe("token");

      // 3. Explicitly verify the serialized run history JSON does NOT contain the secret
      const serialized = JSON.stringify(history);
      expect(serialized.includes("SUPER_SECRET_TEST_TOKEN_123")).toBe(false);
    });
  });
});

