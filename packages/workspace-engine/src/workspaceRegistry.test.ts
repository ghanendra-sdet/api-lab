import { describe, expect, it } from "vitest";
import type { WorkspaceRegistry } from "./types.ts";
import {
  createWorkspaceMeta,
  deleteWorkspaceMeta,
  findWorkspaceMeta,
  renameWorkspaceMeta,
  setActiveWorkspace,
  updateWorkspaceDescription,
} from "./workspaceRegistry.ts";

function emptyRegistry(): WorkspaceRegistry {
  return { workspaces: [], activeWorkspaceId: "" };
}

describe("createWorkspaceMeta", () => {
  it("adds a new workspace entry and returns its id", () => {
    const { registry, workspaceId } = createWorkspaceMeta(emptyRegistry(), "My Workspace");
    expect(registry.workspaces).toHaveLength(1);
    expect(registry.workspaces[0]).toMatchObject({ id: workspaceId, name: "My Workspace" });
  });

  it("gives each workspace a stable, distinct id", () => {
    const first = createWorkspaceMeta(emptyRegistry(), "A");
    const second = createWorkspaceMeta(first.registry, "B");
    expect(second.workspaceId).not.toBe(first.workspaceId);
  });

  it("stores an optional description", () => {
    const { registry, workspaceId } = createWorkspaceMeta(emptyRegistry(), "A", "For testing");
    expect(findWorkspaceMeta(registry, workspaceId)?.description).toBe("For testing");
  });
});

describe("renameWorkspaceMeta", () => {
  it("renames only the targeted workspace", () => {
    const { registry, workspaceId } = createWorkspaceMeta(emptyRegistry(), "Old Name");
    const renamed = renameWorkspaceMeta(registry, workspaceId, "New Name");
    expect(renamed.workspaces[0]!.name).toBe("New Name");
  });
});

describe("updateWorkspaceDescription", () => {
  it("updates only the targeted workspace's description", () => {
    const { registry, workspaceId } = createWorkspaceMeta(emptyRegistry(), "A");
    const updated = updateWorkspaceDescription(registry, workspaceId, "New description");
    expect(updated.workspaces[0]!.description).toBe("New description");
  });
});

describe("deleteWorkspaceMeta", () => {
  it("removes the targeted workspace", () => {
    const first = createWorkspaceMeta(emptyRegistry(), "A");
    const second = createWorkspaceMeta(first.registry, "B");
    const result = deleteWorkspaceMeta(second.registry, first.workspaceId);
    expect(result.workspaces.map((w) => w.id)).toEqual([second.workspaceId]);
  });

  it("falls back the active workspace to the first remaining one when the active workspace is deleted", () => {
    const first = createWorkspaceMeta(emptyRegistry(), "A");
    const second = createWorkspaceMeta(first.registry, "B");
    const active = setActiveWorkspace(second.registry, first.workspaceId);
    const result = deleteWorkspaceMeta(active, first.workspaceId);
    expect(result.activeWorkspaceId).toBe(second.workspaceId);
  });

  it("throws rather than delete the only remaining workspace", () => {
    const { registry, workspaceId } = createWorkspaceMeta(emptyRegistry(), "Only");
    expect(() => deleteWorkspaceMeta(registry, workspaceId)).toThrow();
  });
});

describe("setActiveWorkspace", () => {
  it("switches the active workspace id", () => {
    const first = createWorkspaceMeta(emptyRegistry(), "A");
    const second = createWorkspaceMeta(first.registry, "B");
    const result = setActiveWorkspace(second.registry, second.workspaceId);
    expect(result.activeWorkspaceId).toBe(second.workspaceId);
  });

  it("throws for an unknown workspace id", () => {
    const { registry } = createWorkspaceMeta(emptyRegistry(), "A");
    expect(() => setActiveWorkspace(registry, "nope")).toThrow();
  });
});
