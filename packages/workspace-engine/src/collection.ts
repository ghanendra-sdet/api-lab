import type { Collection, Workspace } from "./types.ts";
import { createWorkspaceId } from "./id.ts";
import { touch } from "./internal.ts";
import type { AuthConfig } from "@api-lab/auth-engine";
import type { Variable } from "@api-lab/environment-engine";

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
    variables: [],
    auth: { type: "none" },
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

export function updateCollectionVariables(
  workspace: Workspace,
  collectionId: string,
  variables: Variable[],
): Workspace {
  return {
    ...workspace,
    collections: workspace.collections.map((c) =>
      c.id === collectionId ? { ...c, variables, updatedAt: touch() } : c,
    ),
  };
}

export function updateCollectionAuth(
  workspace: Workspace,
  collectionId: string,
  auth: AuthConfig,
): Workspace {
  return {
    ...workspace,
    collections: workspace.collections.map((c) =>
      c.id === collectionId ? { ...c, auth, updatedAt: touch() } : c,
    ),
  };
}
