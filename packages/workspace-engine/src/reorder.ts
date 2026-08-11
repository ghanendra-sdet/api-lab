import type { RequestLocation, Workspace } from "./types";
import { withItemsAtLocation } from "./internal";

function swap<T>(array: T[], index: number, direction: "up" | "down"): T[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= array.length) return array;
  const next = [...array];
  const tmp = next[index]!;
  next[index] = next[target]!;
  next[target] = tmp;
  return next;
}

function moveById<T extends { id: string }>(array: T[], id: string, direction: "up" | "down"): T[] {
  const index = array.findIndex((item) => item.id === id);
  if (index === -1) return array;
  return swap(array, index, direction);
}

export function moveCollectionUp(workspace: Workspace, collectionId: string): Workspace {
  return { ...workspace, collections: moveById(workspace.collections, collectionId, "up") };
}

export function moveCollectionDown(workspace: Workspace, collectionId: string): Workspace {
  return { ...workspace, collections: moveById(workspace.collections, collectionId, "down") };
}

/** Reorders a folder or request among its siblings — within a collection's top level or within a folder. */
export function moveItemUp(workspace: Workspace, location: RequestLocation, itemId: string): Workspace {
  return withItemsAtLocation(workspace, location.collectionId, location.folderId, (items) =>
    moveById(items, itemId, "up"),
  );
}

export function moveItemDown(workspace: Workspace, location: RequestLocation, itemId: string): Workspace {
  return withItemsAtLocation(workspace, location.collectionId, location.folderId, (items) =>
    moveById(items, itemId, "down"),
  );
}
