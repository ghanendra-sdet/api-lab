import type { Collection, CollectionItem, Folder, SavedRequest, Workspace } from "./types";

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

export function findFolder(collection: Collection, folderId: string): Folder {
  const folder = collection.items.find((item) => isFolder(item) && item.id === folderId) as
    | Folder
    | undefined;
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

/** Reads the SavedRequest array at a location: a collection's own requests, or one of its folder's requests. */
export function getRequestsAtLocation(
  workspace: Workspace,
  collectionId: string,
  folderId: string | undefined,
): SavedRequest[] {
  const collection = findCollection(workspace, collectionId);
  if (folderId === undefined) {
    return collection.items.filter(isRequest);
  }
  return findFolder(collection, folderId).items;
}

/**
 * Applies fn directly to whichever items array a location refers to — a
 * collection's own top-level items (folders + requests, order preserved
 * exactly as-is) or a folder's items (requests only). Never separates and
 * re-concatenates by type, which would silently reorder siblings.
 */
export function withItemsAtLocation(
  workspace: Workspace,
  collectionId: string,
  folderId: string | undefined,
  fn: (items: CollectionItem[]) => CollectionItem[],
): Workspace {
  return replaceCollection(workspace, collectionId, (c) => {
    if (folderId === undefined) {
      return { ...c, items: fn(c.items), updatedAt: touch() };
    }
    return {
      ...c,
      items: c.items.map((item) =>
        isFolder(item) && item.id === folderId
          ? { ...item, items: fn(item.items) as SavedRequest[], updatedAt: touch() }
          : item,
      ),
      updatedAt: touch(),
    };
  });
}
