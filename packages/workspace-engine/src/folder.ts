import type { Folder, Workspace } from "./types.ts";
import { createWorkspaceId } from "./id.ts";
import { findCollection, isFolder, replaceCollection, touch } from "./internal.ts";
import type { AuthConfig } from "@api-lab/auth-engine";
import type { Variable } from "@api-lab/environment-engine";

export function createFolder(
  workspace: Workspace,
  collectionId: string,
  name: string,
): { workspace: Workspace; folderId: string } {
  findCollection(workspace, collectionId);
  const now = touch();
  const folder: Folder = {
    id: createWorkspaceId("folder"),
    type: "folder",
    name,
    items: [],
    createdAt: now,
    updatedAt: now,
    variables: [],
    auth: { type: "inherit" },
  };
  const next = replaceCollection(workspace, collectionId, (c) => ({
    ...c,
    items: [...c.items, folder],
    updatedAt: touch(),
  }));
  return { workspace: next, folderId: folder.id };
}

export function renameFolder(
  workspace: Workspace,
  collectionId: string,
  folderId: string,
  name: string,
): Workspace {
  return replaceCollection(workspace, collectionId, (c) => ({
    ...c,
    items: c.items.map((item) => (isFolder(item) && item.id === folderId ? { ...item, name, updatedAt: touch() } : item)),
    updatedAt: touch(),
  }));
}

export function deleteFolder(workspace: Workspace, collectionId: string, folderId: string): Workspace {
  return replaceCollection(workspace, collectionId, (c) => ({
    ...c,
    items: c.items.filter((item) => !(isFolder(item) && item.id === folderId)),
    updatedAt: touch(),
  }));
}

export function updateFolderVariables(
  workspace: Workspace,
  collectionId: string,
  folderId: string,
  variables: Variable[],
): Workspace {
  return replaceCollection(workspace, collectionId, (c) => ({
    ...c,
    items: c.items.map((item) =>
      isFolder(item) && item.id === folderId ? { ...item, variables, updatedAt: touch() } : item,
    ),
    updatedAt: touch(),
  }));
}

export function updateFolderAuth(
  workspace: Workspace,
  collectionId: string,
  folderId: string,
  auth: AuthConfig,
): Workspace {
  return replaceCollection(workspace, collectionId, (c) => ({
    ...c,
    items: c.items.map((item) =>
      isFolder(item) && item.id === folderId ? { ...item, auth, updatedAt: touch() } : item,
    ),
    updatedAt: touch(),
  }));
}
