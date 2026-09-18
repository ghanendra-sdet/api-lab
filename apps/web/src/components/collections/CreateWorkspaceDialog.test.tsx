import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace, type WorkspaceMeta } from "@api-lab/workspace-engine";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
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
  });
}

describe("CreateWorkspaceDialog", () => {
  beforeEach(() => {
    resetStore();
  });

  it("creates a workspace with the given name and closes", () => {
    const onClose = vi.fn();
    render(<CreateWorkspaceDialog onClose={onClose} />);

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "My New Workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const state = useAppStore.getState();
    expect(state.workspaces.some((w) => w.name === "My New Workspace")).toBe(true);
    expect(state.activeWorkspaceId).not.toBe("default");
    expect(onClose).toHaveBeenCalled();
  });

  it("disables Create when the name is blank", () => {
    render(<CreateWorkspaceDialog onClose={() => {}} />);
    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});
