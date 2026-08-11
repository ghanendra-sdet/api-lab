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

describe("useAppStore assertions", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("addAssertion creates a default status assertion on the tab", () => {
    const { activeTabId, addAssertion } = useAppStore.getState();
    const id = addAssertion(activeTabId);
    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!;
    expect(tab.tests).toHaveLength(1);
    expect(tab.tests[0]!.id).toBe(id);
    expect(tab.tests[0]!.target).toBe("status");
  });

  it("updateAssertion patches the assertion by id", () => {
    const { activeTabId, addAssertion, updateAssertion } = useAppStore.getState();
    const id = addAssertion(activeTabId);
    updateAssertion(activeTabId, id, { expected: "404" });
    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!;
    expect(tab.tests[0]!.expected).toBe("404");
  });

  it("removeAssertion deletes only the targeted assertion", () => {
    const { activeTabId, addAssertion, removeAssertion } = useAppStore.getState();
    const id1 = addAssertion(activeTabId);
    addAssertion(activeTabId);
    removeAssertion(activeTabId, id1);
    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!;
    expect(tab.tests).toHaveLength(1);
    expect(tab.tests[0]!.id).not.toBe(id1);
  });

  it("sendRequest evaluates assertions and stores a TestResult keyed by tab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));

    const { activeTabId, setTabUrl, addAssertion, updateAssertion, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com");
    const id = addAssertion(activeTabId);
    updateAssertion(activeTabId, id, { target: "status", operator: "equals", expected: "200" });

    await sendRequest(activeTabId);

    const result = useAppStore.getState().testResults[activeTabId];
    expect(result?.status).toBe("passed");
    expect(result?.assertions).toHaveLength(1);
    expect(result?.assertions[0]!.passed).toBe(true);
  });

  it("sendRequest reports a failed TestResult when an assertion does not hold", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })));

    const { activeTabId, setTabUrl, addAssertion, updateAssertion, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com");
    const id = addAssertion(activeTabId);
    updateAssertion(activeTabId, id, { target: "status", operator: "equals", expected: "200" });

    await sendRequest(activeTabId);

    const result = useAppStore.getState().testResults[activeTabId];
    expect(result?.status).toBe("failed");
  });

  it("resetRequest clears assertions and any stored test result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { activeTabId, setTabUrl, addAssertion, sendRequest, resetRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com");
    addAssertion(activeTabId);
    await sendRequest(activeTabId);

    resetRequest(activeTabId);

    const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId)!;
    expect(tab.tests).toEqual([]);
    expect(useAppStore.getState().testResults[activeTabId]).toBeUndefined();
  });
});
