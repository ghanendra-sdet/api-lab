// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DependenciesPanel } from "./DependenciesPanel";
import { useAppStore } from "../../store/useAppStore";
import { createEmptyTab } from "../../lib/seedData";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";

function setupStoreWithRequests(dependsOnC: string[] = []) {
  const workspace = createEmptyWorkspace();
  const collectionId = "col-1";
  const reqAId = "req-a";
  const reqBId = "req-b";
  const reqCId = "req-c";

  workspace.collections = [{
    id: collectionId,
    name: "My Collection",
    createdAt: "2026-08-17T00:00:00Z",
    updatedAt: "2026-08-17T00:00:00Z",
    items: [
      {
        id: reqAId,
        type: "request",
        name: "Req A",
        createdAt: "2026-08-17T00:00:00Z",
        updatedAt: "2026-08-17T00:00:00Z",
        request: {
          method: "GET",
          url: "https://example.com/a",
          params: [],
          headers: [],
          auth: { type: "none" },
          bodyMode: "none",
          bodyRawFormat: "Text",
          bodyRawContent: "",
          preRequestScript: "",
          postResponseScript: "",
          tests: [],
          extractions: [],
          dependsOn: []
        }
      },
      {
        id: reqBId,
        type: "request",
        name: "Req B",
        createdAt: "2026-08-17T00:00:00Z",
        updatedAt: "2026-08-17T00:00:00Z",
        request: {
          method: "POST",
          url: "https://example.com/b",
          params: [],
          headers: [],
          auth: { type: "none" },
          bodyMode: "none",
          bodyRawFormat: "Text",
          bodyRawContent: "",
          preRequestScript: "",
          postResponseScript: "",
          tests: [],
          extractions: [],
          dependsOn: ["req-a"]
        }
      },
      {
        id: reqCId,
        type: "request",
        name: "Req C",
        createdAt: "2026-08-17T00:00:00Z",
        updatedAt: "2026-08-17T00:00:00Z",
        request: {
          method: "GET",
          url: "https://example.com/c",
          params: [],
          headers: [],
          auth: { type: "none" },
          bodyMode: "none",
          bodyRawFormat: "Text",
          bodyRawContent: "",
          preRequestScript: "",
          postResponseScript: "",
          tests: [],
          extractions: [],
          dependsOn: dependsOnC
        }
      }
    ]
  }];

  const tab = createEmptyTab({
    id: "tab-c",
    name: "Req C",
    savedRequestId: reqCId,
    savedLocation: { collectionId },
    dependsOn: dependsOnC
  });

  useAppStore.setState({
    workspace,
    tabs: [tab],
    activeTabId: tab.id,
    environments: createEmptyEnvironmentWorkspace()
  });

  return { collectionId, reqAId, reqBId, reqCId, tab };
}

describe("DependenciesPanel", () => {
  beforeEach(() => {
    useAppStore.setState({
      workspace: createEmptyWorkspace(),
      tabs: [createEmptyTab()],
      activeTabId: "",
      environments: createEmptyEnvironmentWorkspace()
    });
  });

  it("1. Dependency UI renders with no dependencies", () => {
    const { tab } = setupStoreWithRequests();
    render(<DependenciesPanel tab={tab} />);

    expect(screen.getByText("No dependencies configured. This request will execute immediately when sent.")).toBeDefined();
  });

  it("2. Existing dependencies render correctly", () => {
    const { tab } = setupStoreWithRequests(["req-a"]);
    render(<DependenciesPanel tab={tab} />);

    expect(screen.getAllByText("Req A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("My Collection › Req A")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove dependency Req A" })).toBeDefined();
  });

  it("3. User can add one dependency", () => {
    const { tab } = setupStoreWithRequests([]);
    render(<DependenciesPanel tab={tab} />);

    const select = screen.getByRole("combobox", { name: "Prerequisite Request" });
    fireEvent.change(select, { target: { value: "req-a" } });

    const addButton = screen.getByRole("button", { name: "Add Dependency" });
    fireEvent.click(addButton);

    // Verify it updates state and adds to UI
    const state = useAppStore.getState();
    expect(state.tabs[0]!.dependsOn).toEqual(["req-a"]);
  });

  it("4. User can add multiple dependencies", () => {
    const { tab } = setupStoreWithRequests(["req-a"]);
    render(<DependenciesPanel tab={tab} />);

    const select = screen.getByRole("combobox", { name: "Prerequisite Request" });
    fireEvent.change(select, { target: { value: "req-b" } });

    const addButton = screen.getByRole("button", { name: "Add Dependency" });
    fireEvent.click(addButton);

    const state = useAppStore.getState();
    expect(state.tabs[0]!.dependsOn).toEqual(["req-a", "req-b"]);
  });

  it("5. User can remove a dependency", () => {
    const { tab } = setupStoreWithRequests(["req-a", "req-b"]);
    render(<DependenciesPanel tab={tab} />);

    const removeButton = screen.getByRole("button", { name: "Remove dependency Req A" });
    fireEvent.click(removeButton);

    const state = useAppStore.getState();
    expect(state.tabs[0]!.dependsOn).toEqual(["req-b"]);
  });

  it("6. Current request cannot be selected as its own dependency", () => {
    const { tab } = setupStoreWithRequests([]);
    render(<DependenciesPanel tab={tab} />);

    const optionC = screen.queryByRole("option", { name: "My Collection › Req C" });
    expect(optionC).toBeNull();
  });

  it("7. Duplicate dependency cannot be added (filtered from select)", () => {
    const { tab } = setupStoreWithRequests(["req-a"]);
    render(<DependenciesPanel tab={tab} />);

    const optionA = screen.queryByRole("option", { name: "My Collection › Req A" });
    expect(optionA).toBeNull();
  });

  it("8. Missing/dangling dependency is represented correctly", () => {
    const { tab } = setupStoreWithRequests(["nonexistent-id"]);
    render(<DependenciesPanel tab={tab} />);

    expect(screen.getByText("Deleted request (ID: nonexistent-id)")).toBeDefined();
    expect(screen.getByText("Missing reference")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove dependency Deleted request (ID: nonexistent-id)" })).toBeDefined();
  });

  it("9. Circular dependency validation is surfaced correctly", () => {
    const { tab } = setupStoreWithRequests(["req-b"]);
    render(<DependenciesPanel tab={tab} />);

    const workspace = useAppStore.getState().workspace;
    const col = workspace.collections[0]!;
    const reqA = col.items.find(i => i.name === "Req A")!;
    if ("request" in reqA) {
      reqA.request.dependsOn = ["req-c"];
    }
    useAppStore.setState({ workspace });

    render(<DependenciesPanel tab={tab} />);

    expect(screen.getByText("Graph Validation Failed")).toBeDefined();
    expect(screen.getByText(/Circular dependency detected:.*Req C.*Req B.*Req A/)).toBeDefined();
  });

  it("10. Dependencies persist after save", () => {
    const { tab, reqCId } = setupStoreWithRequests(["req-a"]);
    
    // Save tab
    const { saveTab } = useAppStore.getState();
    saveTab(tab.id);

    // Verify workspace includes the dependency config
    const workspace = useAppStore.getState().workspace;
    const req = workspace.collections[0]!.items.find(i => i.id === reqCId)!;
    expect("request" in req && req.request.dependsOn).toEqual(["req-a"]);
  });
});
