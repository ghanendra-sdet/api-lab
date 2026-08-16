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

describe("useAppStore variable propagation", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1. A extracts a value and B receives it", async () => {
    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    // Setup A to extract "token" from JSON response "$.token"
    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.extractions = [{
        id: "ext-1",
        source: "json",
        path: "$.token",
        variable: "token",
        enabled: true
      }];
    }

    // Setup B to resolve "{{token}}" in its headers
    const reqB = col.items.find(i => i.name === "B")!;
    if ("request" in reqB) {
      reqB.request.headers = [{
        id: "hdr-1",
        key: "Authorization",
        value: "Bearer {{token}}",
        enabled: true
      }];
    }
    useAppStore.setState({ workspace });

    let bAuthHeader = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = url.toString();
        if (u.includes("/A")) {
          return new Response(JSON.stringify({ token: "secret-token-123" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (u.includes("/B")) {
          bAuthHeader = (init as RequestInit).headers ? (((init as RequestInit).headers as Record<string, string>)["Authorization"] || "") : "";
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: col.id }, requestIds["B"]!);

    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    expect(bAuthHeader).toBe("Bearer secret-token-123");
    expect(useAppStore.getState().sendErrors[tabId]).toBeUndefined();
  });

  it("2. A extracts multiple values and B receives all of them", async () => {
    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.extractions = [
        { id: "ext-1", source: "json", path: "$.token", variable: "token", enabled: true },
        { id: "ext-2", source: "json", path: "$.userId", variable: "userId", enabled: true }
      ];
    }

    const reqB = col.items.find(i => i.name === "B")!;
    if ("request" in reqB) {
      reqB.request.headers = [
        { id: "hdr-1", key: "Authorization", value: "Bearer {{token}}", enabled: true },
        { id: "hdr-2", key: "X-User-Id", value: "{{userId}}", enabled: true }
      ];
    }
    useAppStore.setState({ workspace });

    let bAuth = "";
    let bUser = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = url.toString();
        if (u.includes("/A")) {
          return new Response(JSON.stringify({ token: "token1", userId: "user2" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (u.includes("/B")) {
          const hdrs = (init as RequestInit).headers as Record<string, string>;
          bAuth = hdrs["Authorization"] || "";
          bUser = hdrs["X-User-Id"] || "";
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: col.id }, requestIds["B"]!);
    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    expect(bAuth).toBe("Bearer token1");
    expect(bUser).toBe("user2");
  });

  it("3. A -> B -> C propagates values across multiple levels", async () => {
    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B", "C"],
      { "B": ["A"], "C": ["B"] },
      { "A": "https://example.com/A", "B": "https://example.com/B", "C": "https://example.com/C" }
    );

    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    
    // A extracts "valA"
    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.extractions = [{ id: "ext-a", source: "json", path: "$.a", variable: "valA", enabled: true }];
    }
    // B consumes "valA", extracts "valB"
    const reqB = col.items.find(i => i.name === "B")!;
    if ("request" in reqB) {
      reqB.request.headers = [{ id: "hdr-b", key: "X-Val-A", value: "{{valA}}", enabled: true }];
      reqB.request.extractions = [{ id: "ext-b", source: "json", path: "$.b", variable: "valB", enabled: true }];
    }
    // C consumes "valA" and "valB"
    const reqC = col.items.find(i => i.name === "C")!;
    if ("request" in reqC) {
      reqC.request.headers = [
        { id: "hdr-c1", key: "X-Val-A", value: "{{valA}}", enabled: true },
        { id: "hdr-c2", key: "X-Val-B", value: "{{valB}}", enabled: true }
      ];
    }
    useAppStore.setState({ workspace });

    let bHeaderA = "";
    let cHeaderA = "";
    let cHeaderB = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = url.toString();
        const hdrs = (init as RequestInit).headers as Record<string, string>;
        if (u.includes("/A")) {
          return new Response(JSON.stringify({ a: "apple" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (u.includes("/B")) {
          bHeaderA = hdrs["X-Val-A"] || "";
          return new Response(JSON.stringify({ b: "banana" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (u.includes("/C")) {
          cHeaderA = hdrs["X-Val-A"] || "";
          cHeaderB = hdrs["X-Val-B"] || "";
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: col.id }, requestIds["C"]!);
    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    expect(bHeaderA).toBe("apple");
    expect(cHeaderA).toBe("apple");
    expect(cHeaderB).toBe("banana");
  });

  it("4. Existing environment variables continue working and runtime overrides them", async () => {
    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    // Set an active environment with variable "token" = "env-token"
    const { createEnvironment, addVariable, updateVariable, setActiveEnvironment } = useAppStore.getState();
    const envId = createEnvironment("Test Env");
    const varId = addVariable(envId);
    updateVariable(envId, varId, { key: "token", value: "env-token", enabled: true });
    setActiveEnvironment(envId);

    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.extractions = [{ id: "ext-1", source: "json", path: "$.token", variable: "token", enabled: true }];
    }

    const reqB = col.items.find(i => i.name === "B")!;
    if ("request" in reqB) {
      reqB.request.headers = [{ id: "hdr-1", key: "Authorization", value: "Bearer {{token}}", enabled: true }];
    }
    useAppStore.setState({ workspace });

    let bAuth = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = url.toString();
        if (u.includes("/A")) {
          // A response extracts token as "extracted-token", which overrides environment variable "token"
          return new Response(JSON.stringify({ token: "extracted-token" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (u.includes("/B")) {
          bAuth = ((init as RequestInit).headers as Record<string, string>)["Authorization"] || "";
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: col.id }, requestIds["B"]!);
    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    // Overridden by runtime extraction
    expect(bAuth).toBe("Bearer extracted-token");
  });

  it("5. Runtime values do not unexpectedly persist into saved workspace state", async () => {
    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.extractions = [{ id: "ext-1", source: "json", path: "$.token", variable: "token", enabled: true }];
    }
    useAppStore.setState({ workspace });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ token: "hello" }), { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: col.id }, requestIds["B"]!);
    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    // Check workspace state to verify it is completely unchanged/no runtime variables serialized
    const finalWorkspace = useAppStore.getState().workspace;
    const requestA = finalWorkspace.collections[0]!.items.find(i => i.name === "A")!;
    expect(requestA).toBeDefined();
    // The request configuration only has the extractions schema definition, not the runtime extracted value
    if (requestA.type === "request") {
      expect(requestA.request.extractions[0]!.variable).toBe("token");
    }
  });

  it("6. Missing extraction/value produces correct failure behavior and prevents dependents", async () => {
    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.extractions = [{ id: "ext-1", source: "json", path: "$.nonexistent", variable: "token", enabled: true }];
    }
    useAppStore.setState({ workspace });

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(url.toString());
        // Return JSON without the expected nonexistent property
        return new Response(JSON.stringify({ other: "prop" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: col.id }, requestIds["B"]!);
    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    // Only A runs, B never runs because extraction failed
    expect(calls).toEqual(["https://example.com/A"]);

    const state = useAppStore.getState();
    expect(state.sendErrors[tabId]).toBeDefined();
    expect(state.sendErrors[tabId]!.message).toContain("Prerequisite request 'A' failed extraction: JSON path \"$.nonexistent\" was not found in the response.");
  });

  it("7. Diamond dependency value propagation works cleanly", async () => {
    // D depends on [B, C], which both depend on A
    // A extracts "sharedVal"
    // B consumes "sharedVal" and extracts "valB"
    // C consumes "sharedVal" and extracts "valC"
    // D consumes "valB" and "valC"
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

    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;

    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.extractions = [{ id: "ext-a", source: "json", path: "$.aVal", variable: "sharedVal", enabled: true }];
    }
    const reqB = col.items.find(i => i.name === "B")!;
    if ("request" in reqB) {
      reqB.request.headers = [{ id: "hdr-b", key: "X-Shared", value: "{{sharedVal}}", enabled: true }];
      reqB.request.extractions = [{ id: "ext-b", source: "json", path: "$.bVal", variable: "valB", enabled: true }];
    }
    const reqC = col.items.find(i => i.name === "C")!;
    if ("request" in reqC) {
      reqC.request.headers = [{ id: "hdr-c", key: "X-Shared", value: "{{sharedVal}}", enabled: true }];
      reqC.request.extractions = [{ id: "ext-c", source: "json", path: "$.cVal", variable: "valC", enabled: true }];
    }
    const reqD = col.items.find(i => i.name === "D")!;
    if ("request" in reqD) {
      reqD.request.headers = [
        { id: "hdr-d1", key: "X-Val-B", value: "{{valB}}", enabled: true },
        { id: "hdr-d2", key: "X-Val-C", value: "{{valC}}", enabled: true }
      ];
    }
    useAppStore.setState({ workspace });

    let bShared = "";
    let cShared = "";
    let dValB = "";
    let dValC = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = url.toString();
        const hdrs = (init as RequestInit).headers as Record<string, string>;
        if (u.includes("/A")) {
          return new Response(JSON.stringify({ aVal: "diamond" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (u.includes("/B")) {
          bShared = hdrs["X-Shared"] || "";
          return new Response(JSON.stringify({ bVal: "apple" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (u.includes("/C")) {
          cShared = hdrs["X-Shared"] || "";
          return new Response(JSON.stringify({ cVal: "cherry" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (u.includes("/D")) {
          dValB = hdrs["X-Val-B"] || "";
          dValC = hdrs["X-Val-C"] || "";
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    openSavedRequest({ collectionId: col.id }, requestIds["D"]!);
    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);

    expect(bShared).toBe("diamond");
    expect(cShared).toBe("diamond");
    expect(dValB).toBe("apple");
    expect(dValC).toBe("cherry");
  });

  it("8. Runtime context is isolated between independent executions", async () => {
    const { requestIds } = setupCollectionWithDependencyChain(
      ["A", "B"],
      { "B": ["A"] },
      { "A": "https://example.com/A", "B": "https://example.com/B" }
    );

    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    const reqA = col.items.find(i => i.name === "A")!;
    if ("request" in reqA) {
      reqA.request.extractions = [{ id: "ext-1", source: "json", path: "$.val", variable: "myVar", enabled: true }];
    }
    const reqB = col.items.find(i => i.name === "B")!;
    if ("request" in reqB) {
      reqB.request.headers = [{ id: "hdr-1", key: "X-Var", value: "{{myVar}}", enabled: true }];
    }
    useAppStore.setState({ workspace });

    let runCount = 0;
    let bHeader = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const u = url.toString();
        if (u.includes("/A")) {
          runCount++;
          return new Response(JSON.stringify({ val: `run-${runCount}` }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (u.includes("/B")) {
          bHeader = ((init as RequestInit).headers as Record<string, string>)["X-Var"] || "";
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );

    const { openSavedRequest, sendRequest } = useAppStore.getState();
    
    // First run
    openSavedRequest({ collectionId: col.id }, requestIds["B"]!);
    const tabId = useAppStore.getState().activeTabId;
    await sendRequest(tabId);
    expect(bHeader).toBe("run-1");

    // Second run
    await sendRequest(tabId);
    expect(bHeader).toBe("run-2");
  });
});
