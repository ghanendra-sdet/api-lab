import type { WorkspaceMeta, WorkspaceRegistry } from "./types.ts";
import { createWorkspaceId } from "./id.ts";
import { touch } from "./internal.ts";

/**
 * Pure functions over a `WorkspaceRegistry` — the list-of-workspaces
 * metadata, not the workspace *data* itself (collections/folders/requests
 * live in a separate `Workspace` blob per entry, see apps/web/src/lib/
 * persistence.ts for the storage-key mapping). Follows the same
 * immutable-update + `touch()` pattern as collection.ts/folder.ts.
 */

export function createWorkspaceMeta(
  registry: WorkspaceRegistry,
  name: string,
  description?: string,
): { registry: WorkspaceRegistry; workspaceId: string } {
  const now = touch();
  const meta: WorkspaceMeta = {
    id: createWorkspaceId("ws"),
    name,
    description,
    createdAt: now,
    updatedAt: now,
  };
  return {
    registry: { ...registry, workspaces: [...registry.workspaces, meta] },
    workspaceId: meta.id,
  };
}

export function renameWorkspaceMeta(
  registry: WorkspaceRegistry,
  workspaceId: string,
  name: string,
): WorkspaceRegistry {
  return {
    ...registry,
    workspaces: registry.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, name, updatedAt: touch() } : w,
    ),
  };
}

export function updateWorkspaceDescription(
  registry: WorkspaceRegistry,
  workspaceId: string,
  description: string,
): WorkspaceRegistry {
  return {
    ...registry,
    workspaces: registry.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, description, updatedAt: touch() } : w,
    ),
  };
}

/**
 * Removes a workspace's registry entry. Never leaves the registry with zero
 * workspaces — throws rather than allow the app to end up with no workspace
 * to show. If the deleted workspace was active, falls back to the first
 * remaining workspace. This module is storage-agnostic: callers own deleting
 * the workspace's persisted `Workspace` data separately (see
 * apps/web/src/lib/persistence.ts's resetWorkspaceStorage).
 */
export function deleteWorkspaceMeta(registry: WorkspaceRegistry, workspaceId: string): WorkspaceRegistry {
  if (registry.workspaces.length <= 1) {
    throw new Error("Cannot delete the only remaining workspace.");
  }
  const workspaces = registry.workspaces.filter((w) => w.id !== workspaceId);
  const activeWorkspaceId =
    registry.activeWorkspaceId === workspaceId ? workspaces[0]!.id : registry.activeWorkspaceId;
  return { ...registry, workspaces, activeWorkspaceId };
}

export function setActiveWorkspace(registry: WorkspaceRegistry, workspaceId: string): WorkspaceRegistry {
  const exists = registry.workspaces.some((w) => w.id === workspaceId);
  if (!exists) throw new Error(`Workspace not found: ${workspaceId}`);
  return { ...registry, activeWorkspaceId: workspaceId };
}

export function findWorkspaceMeta(registry: WorkspaceRegistry, workspaceId: string): WorkspaceMeta | undefined {
  return registry.workspaces.find((w) => w.id === workspaceId);
}
