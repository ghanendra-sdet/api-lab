import { isFolder, isRequest, type Collection, type CollectionItem, type Folder, type RequestLocation, type Workspace } from "@api-lab/workspace-engine";

/**
 * Small, pure lookups over a `Workspace` needed for Step 5's hierarchical
 * resolution (variables + auth inheritance). Deliberately app-layer, not
 * `workspace-engine`: these are read-only conveniences for the execution
 * pipeline, not part of the persisted data model or its CRUD API.
 *
 * Phase 2 of Workspace Management: folders now nest arbitrarily deep, so
 * every lookup here recurses and returns the *full* ancestor chain (not
 * just the immediate folder) — callers that need ancestor-chain inheritance
 * (see `executeRequest.ts`'s `mergeFolderChainVariables`/
 * `resolveFolderChainAuth`) have what they need; callers that only ever
 * cared about the immediate folder still have it via `folderChain`'s last
 * entry (`resolveContainers`'s `folder` convenience field).
 */

export function findCollection(workspace: Workspace, collectionId: string): Collection | undefined {
  return workspace.collections.find((c) => c.id === collectionId);
}

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

/** Finds a folder by id anywhere in a collection's tree, at any depth. */
export function findFolder(collection: Collection, folderId: string): Folder | undefined {
  return findFolderRec(collection.items, folderId);
}

function findRequestPath(items: CollectionItem[], requestId: string, ancestors: string[]): string[] | undefined {
  for (const item of items) {
    if (isFolder(item)) {
      const nested = findRequestPath(item.items, requestId, [...ancestors, item.id]);
      if (nested) return nested;
    } else if (isRequest(item) && item.id === requestId) {
      return ancestors;
    }
  }
  return undefined;
}

/**
 * Locates the Collection (and full folder ancestor chain, if any — folders
 * may now nest arbitrarily deep) that directly contains a saved request.
 * Returns `undefined` if the request id is not found anywhere in the
 * workspace (e.g. an unsaved tab that was never persisted).
 */
export function findRequestLocation(workspace: Workspace, requestId: string): RequestLocation | undefined {
  for (const collection of workspace.collections) {
    const folderPath = findRequestPath(collection.items, requestId, []);
    if (folderPath) return { collectionId: collection.id, folderPath };
  }
  return undefined;
}

/**
 * The containing Collection/Folder(s) for a `RequestLocation`, if
 * resolvable. `folderChain` is the ordered ancestor chain from outermost to
 * innermost (empty if the location is directly in the collection); `folder`
 * is a convenience alias for the innermost (immediate) folder, matching the
 * pre-Phase-2 single-folder shape for callers that only need that.
 */
export interface ResolvedContainers {
  collection?: Collection;
  folderChain: Folder[];
  folder?: Folder;
}

function resolveFolderChain(items: CollectionItem[], folderPath: string[]): Folder[] {
  const chain: Folder[] = [];
  let current = items;
  for (const id of folderPath) {
    const folder = current.find((item) => isFolder(item) && item.id === id) as Folder | undefined;
    if (!folder) break; // stale/missing id — return whatever ancestors resolved so far
    chain.push(folder);
    current = folder.items;
  }
  return chain;
}

export function resolveContainers(workspace: Workspace, location: RequestLocation | undefined): ResolvedContainers {
  if (!location) return { folderChain: [] };
  const collection = findCollection(workspace, location.collectionId);
  if (!collection) return { folderChain: [] };
  const folderChain = resolveFolderChain(collection.items, location.folderPath ?? []);
  return { collection, folderChain, folder: folderChain[folderChain.length - 1] };
}
