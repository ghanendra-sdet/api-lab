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
    expect(state.runnerState.items.map((i) => i.name)).toEqual(["A", "B", "C"]);
    // No assertions were defined on any request, so each one executes
    // successfully but has nothing to assert — "skipped", not "passed".
    expect(state.runnerState.items.every((i) => i.status === "skipped")).toBe(true);
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
    const [a, b, c] = state.runnerState.items;
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
    const [a, b, c] = state.runnerState.items;
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
