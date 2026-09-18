import type { Collection, CollectionItem, Folder, SavedRequest, Workspace } from "./types.ts";

export function isFolder(item: CollectionItem): item is Folder {
  return item.type === "folder";
}

export function isRequest(item: CollectionItem): item is SavedRequest {
  return item.type === "request";
}

export function findCollection(workspace: Workspace, collectionId: string): Collection {
  const collection = workspace.collections.find((c) => c.id === collectionId);
  if (!collection) throw new Error(`Collection not found: ${collectionId}`);
  return collection;
}

/** Recursively searches a collection's item tree for a folder by id, at any depth. */
function findFolderRec(items: CollectionItem[], folderId: string): Folder | undefined {
  for (const item of items) {
    if (isFolder(item)) {
      if (item.id === folderId) return item;
      const nested = findFolderRec(item.items, folderId);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function findFolder(collection: Collection, folderId: string): Folder {
  const folder = findFolderRec(collection.items, folderId);
  if (!folder) throw new Error(`Folder not found: ${folderId}`);
  return folder;
}

export function replaceCollection(
  workspace: Workspace,
  collectionId: string,
  updater: (collection: Collection) => Collection,
): Workspace {
  return {
    ...workspace,
    collections: workspace.collections.map((c) => (c.id === collectionId ? updater(c) : c)),
  };
}

export function touch(): string {
  return new Date().toISOString();
}

/**
 * Drills into an item tree along an ordered chain of folder ids
 * (`folderPath`, outermost first) and returns the `CollectionItem[]` array
 * living at that path. An empty path returns `items` itself (the
 * collection's own top-level items). Throws if any id along the path isn't
 * found, so a stale/typo'd folder id fails loudly instead of silently
 * resolving to the wrong scope.
 */
function getItemsAtPath(items: CollectionItem[], folderPath: string[]): CollectionItem[] {
  if (folderPath.length === 0) return items;
  const [id, ...rest] = folderPath as [string, ...string[]];
  const folder = items.find((item) => isFolder(item) && item.id === id) as Folder | undefined;
  if (!folder) throw new Error(`Folder not found: ${id}`);
  return getItemsAtPath(folder.items, rest);
}

/** Reads the SavedRequest array at a location: a collection's own requests, or a (possibly nested) folder's requests. */
export function getRequestsAtLocation(
  workspace: Workspace,
  collectionId: string,
  folderPath: string[] = [],
): SavedRequest[] {
  const collection = findCollection(workspace, collectionId);
  return getItemsAtPath(collection.items, folderPath).filter(isRequest);
}

/**
 * Rebuilds an item tree, applying `fn` directly to whichever items array
 * `folderPath` refers to (the collection's own top-level items when the
 * path is empty, or a nested folder's items otherwise). Every folder along
 * the path is touched (its `updatedAt` refreshed) since its contents
 * changed; folders not on the path are returned unchanged. Never separates
 * and re-concatenates by type, which would silently reorder siblings.
 */
function updateItemsAtPath(
  items: CollectionItem[],
  folderPath: string[],
  fn: (items: CollectionItem[]) => CollectionItem[],
): CollectionItem[] {
  if (folderPath.length === 0) return fn(items);
  const [id, ...rest] = folderPath as [string, ...string[]];
  return items.map((item) =>
    isFolder(item) && item.id === id
      ? { ...item, items: updateItemsAtPath(item.items, rest, fn), updatedAt: touch() }
      : item,
  );
}

export function withItemsAtLocation(
  workspace: Workspace,
  collectionId: string,
  folderPath: string[] = [],
  fn: (items: CollectionItem[]) => CollectionItem[],
): Workspace {
  return replaceCollection(workspace, collectionId, (c) => ({
    ...c,
    items: updateItemsAtPath(c.items, folderPath, fn),
    updatedAt: touch(),
  }));
}

/**
 * Recursively finds a folder by id anywhere in the item tree and replaces
 * it via `updater`. Folder ids are globally unique (see `id.ts`), so a
 * single id is enough to locate the target at any depth — no path needed.
 * Items not on the path to the target are returned unchanged (same object
 * reference), so callers doing shallow-equality checks on siblings are safe.
 */
export function updateFolderById(
  items: CollectionItem[],
  folderId: string,
  updater: (folder: Folder) => Folder,
): CollectionItem[] {
  return items.map((item) => {
    if (!isFolder(item)) return item;
    if (item.id === folderId) return updater(item);
    const updatedItems = updateFolderById(item.items, folderId, updater);
    return updatedItems === item.items ? item : { ...item, items: updatedItems };
  });
}

/**
 * Recursively removes a folder (and everything nested inside it) by id,
 * anywhere in the item tree — this is how deleting a folder cascades to its
 * subfolders and their requests: the whole matching subtree is dropped in
 * one step, never separately recursed into and emptied.
 */
export function removeFolderById(items: CollectionItem[], folderId: string): CollectionItem[] {
  return items
    .filter((item) => !(isFolder(item) && item.id === folderId))
    .map((item) => {
      if (!isFolder(item)) return item;
      const updatedItems = removeFolderById(item.items, folderId);
      return updatedItems === item.items ? item : { ...item, items: updatedItems };
    });
}

/**
 * Recursively finds a folder by id anywhere in the item tree and appends
 * `newItem` to its `items`, touching that folder's `updatedAt`. Used by
 * `createFolder` to create a subfolder under an existing folder at any
 * depth (rather than only ever at the collection's top level).
 */
export function insertIntoFolder(
  items: CollectionItem[],
  folderId: string,
  newItem: CollectionItem,
): CollectionItem[] {
  return updateFolderById(items, folderId, (folder) => ({
    ...folder,
    items: [...folder.items, newItem],
    updatedAt: touch(),
  }));
}
