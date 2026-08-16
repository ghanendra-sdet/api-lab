import { beforeEach, describe, expect, it } from "vitest";
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
    theme: "light",
    sidebarCollapsed: false,
  });
}

describe("useAppStore dependency validation", () => {
  beforeEach(() => {
    resetStore();
  });

  it("1. Valid dependency accepted", () => {
    const { createCollection, saveNewRequest, activeTabId, openNewTab } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    // Save Request A first
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    const reqAId = useAppStore.getState().tabs[0]!.savedRequestId!;
    
    // Open new tab for Request B
    openNewTab();
    const state2 = useAppStore.getState();
    const tabBId = state2.activeTabId;
    
    // Configure B dependsOn [A]
    useAppStore.setState({
      tabs: state2.tabs.map(t => t.id === tabBId ? { ...t, dependsOn: [reqAId] } : t)
    });
    
    // Save Request B
    saveNewRequest(tabBId, { collectionId }, "Req B");
    
    const state3 = useAppStore.getState();
    const col = state3.workspace.collections[0]!;
    expect(col.items).toHaveLength(2);
    
    const reqB = col.items.find(item => item.name === "Req B");
    expect(reqB && "request" in reqB && reqB.request.dependsOn).toEqual([reqAId]);
  });

  it("2. Self dependency rejected before persistence", () => {
    const { createCollection, saveNewRequest, activeTabId } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    // Save Req A first
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    const reqAId = useAppStore.getState().tabs[0]!.savedRequestId!;
    
    // Configure Req A to depend on itself
    const state2 = useAppStore.getState();
    useAppStore.setState({
      tabs: state2.tabs.map(t => t.id === activeTabId ? { ...t, dependsOn: [reqAId] } : t)
    });
    
    // Attempt saveTab (update) - should fail
    const { saveTab } = useAppStore.getState();
    expect(() => saveTab(activeTabId)).toThrow("Request Req A cannot depend on itself.");
    
    // Verify not persisted (dependsOn remains undefined in workspace)
    const col = useAppStore.getState().workspace.collections[0]!;
    const savedReq = col.items[0];
    expect(savedReq && "request" in savedReq && savedReq.request.dependsOn).toBeUndefined();
  });

  it("3. Two-request cycle rejected before persistence", () => {
    const { createCollection, saveNewRequest, activeTabId, openNewTab, saveTab } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    // Save Request A
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    const reqAId = useAppStore.getState().tabs[0]!.savedRequestId!;
    
    // Open new tab and save Request B dependsOn [A]
    openNewTab();
    const stateB = useAppStore.getState();
    const tabBId = stateB.activeTabId;
    useAppStore.setState({
      tabs: stateB.tabs.map(t => t.id === tabBId ? { ...t, dependsOn: [reqAId] } : t)
    });
    saveNewRequest(tabBId, { collectionId }, "Req B");
    const reqBId = useAppStore.getState().tabs.find(t => t.id === tabBId)!.savedRequestId!;
    
    // Now, update Request A to depend on B (creating cycle: A -> B -> A)
    const stateAUpdate = useAppStore.getState();
    useAppStore.setState({
      tabs: stateAUpdate.tabs.map(t => t.id === activeTabId ? { ...t, dependsOn: [reqBId] } : t)
    });
    
    // Saving A should throw circular dependency error
    expect(() => saveTab(activeTabId)).toThrow("Circular dependency detected:\nReq A → Req B → Req A");
    
    // Verify A's dependsOn remains undefined in workspace (not persisted)
    const col = useAppStore.getState().workspace.collections[0]!;
    const reqA = col.items.find(i => i.id === reqAId);
    expect(reqA && "request" in reqA && reqA.request.dependsOn).toBeUndefined();
  });

  it("4. Three-request cycle rejected before persistence", () => {
    const { createCollection, saveNewRequest, activeTabId, openNewTab, saveTab } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    // Save A
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    const reqAId = useAppStore.getState().tabs[0]!.savedRequestId!;
    
    // Save B dependsOn A
    openNewTab();
    const tabBId = useAppStore.getState().activeTabId;
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map(t => t.id === tabBId ? { ...t, dependsOn: [reqAId] } : t)
    });
    saveNewRequest(tabBId, { collectionId }, "Req B");
    const reqBId = useAppStore.getState().tabs.find(t => t.id === tabBId)!.savedRequestId!;
    
    // Save C dependsOn B
    openNewTab();
    const tabCId = useAppStore.getState().activeTabId;
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map(t => t.id === tabCId ? { ...t, dependsOn: [reqBId] } : t)
    });
    saveNewRequest(tabCId, { collectionId }, "Req C");
    const reqCId = useAppStore.getState().tabs.find(t => t.id === tabCId)!.savedRequestId!;
    
    // Update A to depend on C (cycle: A -> B -> C -> A)
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map(t => t.id === activeTabId ? { ...t, dependsOn: [reqCId] } : t)
    });
    
    expect(() => saveTab(activeTabId)).toThrow("Circular dependency detected:\nReq A → Req C → Req B → Req A");
  });

  it("5. Duplicate dependency rejected before persistence", () => {
    const { createCollection, saveNewRequest, activeTabId, openNewTab } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    const reqAId = useAppStore.getState().tabs[0]!.savedRequestId!;
    
    openNewTab();
    const tabBId = useAppStore.getState().activeTabId;
    // B depends on [A, A]
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map(t => t.id === tabBId ? { ...t, dependsOn: [reqAId, reqAId] } : t)
    });
    
    expect(() => saveNewRequest(tabBId, { collectionId }, "Req B")).toThrow("Request Req B contains duplicate dependency Req A.");
  });

  it("6. Missing dependency rejected before persistence", () => {
    const { createCollection, saveNewRequest, activeTabId } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map(t => t.id === activeTabId ? { ...t, dependsOn: ["missing-req-id"] } : t)
    });
    
    expect(() => saveNewRequest(activeTabId, { collectionId }, "Req A")).toThrow("Request Req A depends on missing request missing-req-id.");
  });

  it("7. Failed validation leaves existing state unchanged", () => {
    const { createCollection, saveNewRequest, activeTabId, saveTab } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    // Save valid Req A
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    const originalWorkspace = useAppStore.getState().workspace;
    
    // Try to update with self dependency
    const reqAId = useAppStore.getState().tabs[0]!.savedRequestId!;
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map(t => t.id === activeTabId ? { ...t, dependsOn: [reqAId] } : t)
    });
    
    expect(() => saveTab(activeTabId)).toThrow();
    
    // Check that workspace state remains completely identical to originalWorkspace
    expect(useAppStore.getState().workspace).toBe(originalWorkspace);
  });

  it("8. Valid dependency survives serialization/reload", () => {
    const { createCollection, saveNewRequest, activeTabId, openNewTab } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    const reqAId = useAppStore.getState().tabs[0]!.savedRequestId!;
    
    openNewTab();
    const tabBId = useAppStore.getState().activeTabId;
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map(t => t.id === tabBId ? { ...t, dependsOn: [reqAId] } : t)
    });
    
    saveNewRequest(tabBId, { collectionId }, "Req B");
    
    // Check the snapshot of Request B saved
    const state = useAppStore.getState();
    const tabB = state.tabs.find(t => t.id === tabBId)!;
    expect(tabB.savedSnapshot?.dependsOn).toEqual([reqAId]);
    
    const col = state.workspace.collections[0]!;
    const reqB = col.items.find(i => i.name === "Req B");
    expect(reqB && "request" in reqB && reqB.request.dependsOn).toEqual([reqAId]);
  });

  it("9. Existing requests without dependsOn continue working", () => {
    const { createCollection, saveNewRequest, activeTabId } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    
    const state = useAppStore.getState();
    const col = state.workspace.collections[0]!;
    expect(col.items).toHaveLength(1);
    const reqA = col.items[0];
    expect(reqA && "request" in reqA && reqA.request.dependsOn).toBeUndefined();
  });

  it("10. Multiple valid dependencies remain accepted", () => {
    const { createCollection, saveNewRequest, activeTabId, openNewTab } = useAppStore.getState();
    const collectionId = createCollection("Coll");
    
    // Save A
    saveNewRequest(activeTabId, { collectionId }, "Req A");
    const reqAId = useAppStore.getState().tabs[0]!.savedRequestId!;
    
    // Save B
    openNewTab();
    const tabBId = useAppStore.getState().activeTabId;
    saveNewRequest(tabBId, { collectionId }, "Req B");
    const reqBId = useAppStore.getState().tabs.find(t => t.id === tabBId)!.savedRequestId!;
    
    // Save C dependsOn [A, B]
    openNewTab();
    const tabCId = useAppStore.getState().activeTabId;
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map(t => t.id === tabCId ? { ...t, dependsOn: [reqAId, reqBId] } : t)
    });
    saveNewRequest(tabCId, { collectionId }, "Req C");
    
    const state = useAppStore.getState();
    const col = state.workspace.collections[0]!;
    const reqC = col.items.find(i => i.name === "Req C");
    expect(reqC && "request" in reqC && reqC.request.dependsOn).toEqual([reqAId, reqBId]);
  });
});
