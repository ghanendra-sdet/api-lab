import { render, screen, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace, type WorkspaceMeta } from "@api-lab/workspace-engine";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { useAppStore } from "../../store/useAppStore";
import { createEmptyTab } from "../../lib/seedData";

const DEFAULT_WORKSPACE_META: WorkspaceMeta = {
  id: "default",
  name: "My Workspace",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function resetStore() {
  const freshTab = createEmptyTab();
  window.localStorage.clear();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    workspace: createEmptyWorkspace(),
    workspaceLoadError: null,
    workspaces: [DEFAULT_WORKSPACE_META],
    activeWorkspaceId: "default",
    workspaceRegistryLoadError: null,
    environments: createEmptyEnvironmentWorkspace(),
    environmentsLoadError: null,
    globals: [],
    globalsLoadError: null,
  });
}

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    resetStore();
  });

  it("shows the active workspace's name", () => {
    render(<WorkspaceSwitcher />);
    expect(screen.getByRole("button", { name: /My Workspace/ })).toBeInTheDocument();
  });

  it("opens a dropdown listing all workspaces on click", () => {
    useAppStore.getState().createWorkspace("Second Workspace");
    render(<WorkspaceSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /Second Workspace/ }));
    const listbox = screen.getByRole("listbox", { name: "Workspaces" });
    expect(within(listbox).getByText("My Workspace")).toBeInTheDocument();
    expect(within(listbox).getByText("Second Workspace")).toBeInTheDocument();
  });

  it("switches the active workspace when an entry is clicked", () => {
    const secondId = useAppStore.getState().createWorkspace("Second Workspace");
    useAppStore.getState().switchWorkspace("default");
    render(<WorkspaceSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: /My Workspace/ }));
    fireEvent.click(screen.getByRole("option", { name: "Second Workspace" }));

    expect(useAppStore.getState().activeWorkspaceId).toBe(secondId);
  });

  it("opens the create-workspace dialog from the dropdown", () => {
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /My Workspace/ }));
    fireEvent.click(screen.getByRole("button", { name: /New Workspace/ }));
    expect(screen.getByRole("heading", { name: "New Workspace" })).toBeInTheDocument();
  });

  it("refuses to delete the only remaining workspace", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /My Workspace/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete My Workspace" }));

    expect(alertSpy).toHaveBeenCalled();
    expect(useAppStore.getState().workspaces).toHaveLength(1);
    alertSpy.mockRestore();
  });
});
