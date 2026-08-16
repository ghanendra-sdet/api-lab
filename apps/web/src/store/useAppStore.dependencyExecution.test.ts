// @vitest-environment jsdom
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

function setupCollectionWithDependencyChain(names: string[], dependencies: Record<string, string[]>, urls: Record<string, string>) {
  const { createCollection, saveNewRequest, setTabUrl, activeTabId } = useAppStore.getState();
  const collectionId = createCollection("Dependency Collection");
  const requestIds: Record<string, string> = {};

  for (const name of names) {
    setTabUrl(activeTabId, urls[name] || "https://example.com");
    saveNewRequest(activeTabId, { collectionId }, name);
    const savedId = useAppStore.getState().tabs[0]!.savedRequestId!;
    requestIds[name] = savedId;
  }

  // Update dependencies in workspace
  const workspace = useAppStore.getState().workspace;
  const col = workspace.collections.find(c => c.id === collectionId)!;
  for (const item of col.items) {
    if (item.type === "request" && dependencies[item.name]) {
      item.request.dependsOn = dependencies[item.name]!.map(depName => requestIds[depName]!);
    }
  }
  useAppStore.setState({ workspace });

  // Clear tabs to force openSavedRequest to reload fresh configs from workspace
  const freshTab = createEmptyTab();
  useAppStore.setState({ tabs: [freshTab], activeTabId: freshTab.id });

  return { collectionId, requestIds };
}

describe("useAppStore dependency execution orchestration", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1. Request with no dependencies executes normally", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url.toString());
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const { createCollection, saveNewRequest, activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    setTabUrl(activeTabId, "https://example.com/A");
    saveNewRequest(activeTabId, { collectionId }, "Req A");

    await sendRequest(activeTabId);

    expect(calls).toEqual(["https://example.com/A"]);
    const state = useAppStore.getState();
    expect(state.responses[activeTabId]).toBeDefined();
    expect(state.sendErrors[activeTabId]).toBeUndefined();
  });

  it("2. A -> B executes A before B", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url.toString());
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    // Open request B
    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: useAppStore.getState().workspace.collections[0]!.id }, requestIds["B"]!);

    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    expect(calls).toEqual(["https://example.com/A", "https://example.com/B"]);
    const state = useAppStore.getState();
    expect(state.responses[tabId]).toBeDefined();
    expect(state.sendErrors[tabId]).toBeUndefined();
  });

  it("3. A -> B -> C executes A, then B, then C", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url.toString());
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B", "C"],
      { "B": ["A"], "C": ["B"] },
      { "A": "https://example.com/A", "B": "https://example.com/B", "C": "https://example.com/C" }
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    const collectionId = useAppStore.getState().workspace.collections[0]!.id;
    openSavedRequest({ collectionId }, requestIds["C"]!);

    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    expect(calls).toEqual([
      "https://example.com/A",
      "https://example.com/B",
      "https://example.com/C"
    ]);
  });

  it("4. Diamond dependency executes prerequisites deterministically and A once", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url.toString());
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    // D depends on [B, C], which both depend on A
    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B", "C", "D"],
      { "B": ["A"], "C": ["A"], "D": ["B", "C"] },
      {
        "A": "https://example.com/A",
        "B": "https://example.com/B",
        "C": "https://example.com/C",
        "D": "https://example.com/D"
      }
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    const collectionId = useAppStore.getState().workspace.collections[0]!.id;
    openSavedRequest({ collectionId }, requestIds["D"]!);

    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    // A should execute first, then B, then C, then D. A executes only once.
    expect(calls).toEqual([
      "https://example.com/A",
      "https://example.com/B",
      "https://example.com/C",
      "https://example.com/D"
    ]);
  });

  it("5. Failed prerequisite prevents dependent request execution and propagates failure", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url.toString());
        if (url.toString().includes("/A")) {
          return new Response("{}", { status: 500, headers: { "content-type": "application/json" } });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    // We add an assertion that status equals 200 on A, so A fails
    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.tests = [{
        id: "status-test",
        target: "status",
        operator: "equals",
        expected: "200",
        enabled: true
      }];
    }
    useAppStore.setState({ workspace });

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: col.id }, requestIds["B"]!);

    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    // A was executed, B was not
    expect(calls).toEqual(["https://example.com/A"]);
    
    // sendErrors on B should describe the failure of A
    const state = useAppStore.getState();
    expect(state.sendErrors[tabId]).toBeDefined();
    expect(state.sendErrors[tabId]!.message).toContain("Prerequisite request 'A' failed assertions.");
    expect(state.responses[tabId]).toBeUndefined();
  });

  it("6. Existing non-dependent runner behavior remains unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
    );

    const { createCollection, saveNewRequest, setTabUrl, activeTabId, startRunner } = useAppStore.getState();
    const collectionId = createCollection("Normal Collection");
    setTabUrl(activeTabId, "https://example.com");
    saveNewRequest(activeTabId, { collectionId }, "X");
    const idX = useAppStore.getState().tabs[0]!.savedRequestId!;

    await startRunner(collectionId, [idX], null, false);

    const state = useAppStore.getState();
    expect(state.runnerState.status).toBe("completed");
    expect(state.runnerState.iterations[0]!.items[0]!.status).toBe("skipped");
  });

  it("7. Dependent Collection Runner executes prerequisites and target in order", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url.toString());
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const { collectionId, requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    // Run Collection Runner selecting ONLY "B"
    const { startRunner } = useAppStore.getState();
    await startRunner(collectionId, [requestIds["B"]!], null, false);

    // Verify both A and B executed in order
    expect(calls).toEqual(["https://example.com/A", "https://example.com/B"]);

    const state = useAppStore.getState();
    expect(state.runnerState.status).toBe("completed");
    
    // Prerequisites that were executed but not selected in runner items are not in items,
    // only selected items are in iterations[0].items
    const items = state.runnerState.iterations[0]!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.requestId).toBe(requestIds["B"]);
    expect(items[0]!.status).toBe("skipped");
  });

  it("8. Cancellation aborts execution mid-chain", async () => {
    const calls: string[] = [];
    let cancelTriggered = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url.toString());
        if (url.toString().includes("/A")) {
          // Trigger cancellation of B's execution mid-chain while A is running
          const activeTabId = useAppStore.getState().activeTabId;
          useAppStore.getState().cancelRequest(activeTabId);
          cancelTriggered = true;
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    const collectionId = useAppStore.getState().workspace.collections[0]!.id;
    openSavedRequest({ collectionId }, requestIds["B"]!);

    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    // Fetch was called for A, but B was aborted and never called
    expect(calls).toEqual(["https://example.com/A"]);
    expect(cancelTriggered).toBe(true);

    const state = useAppStore.getState();
    expect(state.responses[tabId]).toBeUndefined();
    // Verify it registers as aborted/idle
    expect(state.requestStatus[tabId]).toBe("idle");
  });
});
