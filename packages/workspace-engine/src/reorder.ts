import type { RequestLocation, Workspace } from "./types.ts";
import { withItemsAtLocation } from "./internal.ts";

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

/** Reorders a folder or request among its siblings — within a collection's top level or within a (possibly nested) folder. */
export function moveItemUp(workspace: Workspace, location: RequestLocation, itemId: string): Workspace {
  return withItemsAtLocation(workspace, location.collectionId, location.folderPath ?? [], (items) =>
    moveById(items, itemId, "up"),
  );
}

export function moveItemDown(workspace: Workspace, location: RequestLocation, itemId: string): Workspace {
  return withItemsAtLocation(workspace, location.collectionId, location.folderPath ?? [], (items) =>
    moveById(items, itemId, "down"),
  );
}

/**
 * Drag-to-reorder within a single container (a collection's top level, or
 * one folder's items) to an arbitrary target index — unlike `moveItemUp`/
 * `moveItemDown`, which only swap with an adjacent sibling. `newIndex` is
 * clamped to the container's bounds and interpreted as the item's *final*
 * resting index after removal+reinsertion (so index 0 means "first", and an
 * index equal to `items.length - 1` means "last"). A no-op (item not found,
 * or already at `newIndex`) returns the same array reference.
 */
export function reorderItems(
  workspace: Workspace,
  location: RequestLocation,
  itemId: string,
  newIndex: number,
): Workspace {
  return withItemsAtLocation(workspace, location.collectionId, location.folderPath ?? [], (items) => {
    const currentIndex = items.findIndex((item) => item.id === itemId);
    if (currentIndex === -1) return items;
    const clampedIndex = Math.max(0, Math.min(newIndex, items.length - 1));
    if (clampedIndex === currentIndex) return items;
    const next = [...items];
    const [moved] = next.splice(currentIndex, 1);
    next.splice(clampedIndex, 0, moved!);
    return next;
  });
}
