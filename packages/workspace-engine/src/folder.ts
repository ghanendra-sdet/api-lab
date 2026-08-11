import type { Folder, Workspace } from "./types";
import { createWorkspaceId } from "./id";
import { findCollection, isFolder, replaceCollection, touch } from "./internal";

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
