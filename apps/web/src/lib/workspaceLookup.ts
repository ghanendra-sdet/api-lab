import { isFolder, isRequest, type Collection, type Folder, type RequestLocation, type Workspace } from "@api-lab/workspace-engine";

/**
 * Small, pure lookups over a `Workspace` needed for Step 5's hierarchical
 * resolution (variables + auth inheritance). Deliberately app-layer, not
 * `workspace-engine`: these are read-only conveniences for the execution
 * pipeline, not part of the persisted data model or its CRUD API.
 */

export function findCollection(workspace: Workspace, collectionId: string): Collection | undefined {
  return workspace.collections.find((c) => c.id === collectionId);
}

export function findFolder(collection: Collection, folderId: string): Folder | undefined {
  for (const item of collection.items) {
    if (isFolder(item) && item.id === folderId) return item;
  }
  return undefined;
}

/**
 * Locates the Collection (and Folder, if any — folders are one level deep,
 * per `workspace-engine`'s `Folder.items` doc comment) that directly contains
 * a saved request. Returns `undefined` if the request id is not found
 * anywhere in the workspace (e.g. an unsaved tab that was never persisted).
 */
export function findRequestLocation(workspace: Workspace, requestId: string): RequestLocation | undefined {
  for (const collection of workspace.collections) {
    for (const item of collection.items) {
      if (isFolder(item)) {
        for (const req of item.items) {
          if (req.id === requestId) return { collectionId: collection.id, folderId: item.id };
        }
      } else if (isRequest(item) && item.id === requestId) {
        return { collectionId: collection.id };
      }
    }
  }
  return undefined;
}

/** The containing Collection/Folder for a `RequestLocation`, if resolvable. */
export interface ResolvedContainers {
  collection?: Collection;
  folder?: Folder;
}

export function resolveContainers(workspace: Workspace, location: RequestLocation | undefined): ResolvedContainers {
  if (!location) return {};
  const collection = findCollection(workspace, location.collectionId);
  if (!collection) return {};
  const folder = location.folderId ? findFolder(collection, location.folderId) : undefined;
  return { collection, folder };
}
