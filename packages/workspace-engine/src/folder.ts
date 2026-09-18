import type { Folder, RequestLocation, Workspace } from "./types.ts";
import { createWorkspaceId } from "./id.ts";
import {
  findCollection,
  findFolder,
  insertIntoFolder,
  removeFolderById,
  replaceCollection,
  touch,
  updateFolderById,
  withItemsAtLocation,
} from "./internal.ts";
import type { AuthConfig } from "@api-lab/auth-engine";
import type { Variable } from "@api-lab/environment-engine";

/**
 * Creates a new folder either at a collection's top level (`parentFolderId`
 * omitted) or nested inside an existing folder at any depth (`parentFolderId`
 * given — throws if that folder doesn't exist anywhere in the collection).
 */
export function createFolder(
  workspace: Workspace,
  collectionId: string,
  name: string,
  parentFolderId?: string,
): { workspace: Workspace; folderId: string } {
  const collection = findCollection(workspace, collectionId);
  if (parentFolderId) findFolder(collection, parentFolderId); // throws if missing

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
    items: parentFolderId ? insertIntoFolder(c.items, parentFolderId, folder) : [...c.items, folder],
    updatedAt: touch(),
  }));
  return { workspace: next, folderId: folder.id };
}

/** Renames a folder found anywhere in the collection's tree (folder ids are globally unique — see id.ts). */
export function renameFolder(
  workspace: Workspace,
  collectionId: string,
  folderId: string,
  name: string,
): Workspace {
  return replaceCollection(workspace, collectionId, (c) => ({
    ...c,
    items: updateFolderById(c.items, folderId, (f) => ({ ...f, name, updatedAt: touch() })),
    updatedAt: touch(),
  }));
}

/** Deletes a folder found anywhere in the collection's tree, cascading to every subfolder/request nested inside it. */
export function deleteFolder(workspace: Workspace, collectionId: string, folderId: string): Workspace {
  return replaceCollection(workspace, collectionId, (c) => ({
    ...c,
    items: removeFolderById(c.items, folderId),
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
    items: updateFolderById(c.items, folderId, (f) => ({ ...f, variables, updatedAt: touch() })),
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
    items: updateFolderById(c.items, folderId, (f) => ({ ...f, auth, updatedAt: touch() })),
    updatedAt: touch(),
  }));
}

/**
 * Moves a folder (and its entire subtree — subfolders, requests, all of it)
 * from one location to another: between collections, into/out of another
 * folder at any depth, or to a collection's root. Mirrors `moveRequest`'s
 * shape (`request.ts`), but takes `from`/`to` folder-*path* pairs rather than
 * single ids, since Phase 2 made folders nest arbitrarily deep.
 *
 * Throws if `folderId` isn't found anywhere in the source collection, or if
 * `to` would place the folder inside its own subtree (which would silently
 * lose the moved folder — `removeFolderById` on `from` runs before the
 * insert, so a self-nested move would otherwise vanish the folder entirely).
 */
export function moveFolder(
  workspace: Workspace,
  from: RequestLocation,
  to: RequestLocation,
  folderId: string,
): Workspace {
  const sourceCollection = findCollection(workspace, from.collectionId);
  const folder = findFolder(sourceCollection, folderId); // throws if missing

  const toPath = to.folderPath ?? [];
  if (to.collectionId === from.collectionId && toPath.includes(folderId)) {
    throw new Error(`Cannot move folder "${folderId}" into its own descendant`);
  }

  const removed = withItemsAtLocation(workspace, from.collectionId, from.folderPath ?? [], (items) =>
    items.filter((item) => !(item.type === "folder" && item.id === folderId)),
  );

  return withItemsAtLocation(removed, to.collectionId, toPath, (items) => [...items, folder]);
}
