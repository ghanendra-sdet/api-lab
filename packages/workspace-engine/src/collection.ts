import type { Collection, Workspace } from "./types.ts";
import { createWorkspaceId } from "./id.ts";
import { touch } from "./internal.ts";

export function createCollection(
  workspace: Workspace,
  name: string,
): { workspace: Workspace; collectionId: string } {
  const now = touch();
  const collection: Collection = {
    id: createWorkspaceId("col"),
    name,
    items: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    workspace: { ...workspace, collections: [...workspace.collections, collection] },
    collectionId: collection.id,
  };
}

export function renameCollection(workspace: Workspace, collectionId: string, name: string): Workspace {
  return {
    ...workspace,
    collections: workspace.collections.map((c) =>
      c.id === collectionId ? { ...c, name, updatedAt: touch() } : c,
    ),
  };
}

export function deleteCollection(workspace: Workspace, collectionId: string): Workspace {
  return {
    ...workspace,
    collections: workspace.collections.filter((c) => c.id !== collectionId),
  };
}
