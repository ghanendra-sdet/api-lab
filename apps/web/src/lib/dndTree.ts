import type { Collection, CollectionItem, RequestLocation } from "@api-lab/workspace-engine";
import { isFolder } from "@api-lab/workspace-engine";

/**
 * Phase 3 of Workspace Management: drag-and-drop reorganization of the
 * sidebar tree. `@dnd-kit` needs (a) every drag source/drop target to have a
 * stable, globally-unique string id, and (b) a way to translate a drop back
 * into "which container, which index" once the drag ends.
 *
 * Rather than have every `FolderItem`/`RequestItem` register itself into
 * some ref-based registry at mount time, `CollectionItem.tsx` (the DnD root
 * for its subtree, per plan.md) walks the collection's item tree fresh on
 * every render and builds this lookup directly from the same `Collection`
 * data the tree already renders from — always in sync, no separate
 * registration lifecycle to keep correct.
 */

export interface DndItemMeta {
  type: "folder" | "request";
  /** The location (collection + ancestor folder path) this item currently lives IN — i.e. its container, not its own path if it's a folder. */
  location: RequestLocation;
  index: number;
}

export interface DndTree {
  /** itemId -> where it currently lives and at what index in that container. */
  meta: Map<string, DndItemMeta>;
  /** containerKey -> ordered item ids in that container, for `SortableContext`. */
  containers: Map<string, string[]>;
}

export function containerKey(location: RequestLocation): string {
  return `${location.collectionId}::${(location.folderPath ?? []).join("/")}`;
}

/** Sentinel droppable id for "drop into this folder" (dropping directly on a folder's own header row, not one of its children). */
export function folderDropId(folderId: string): string {
  return `folder-drop:${folderId}`;
}

export function parseFolderDropId(id: string): string | null {
  return id.startsWith("folder-drop:") ? id.slice("folder-drop:".length) : null;
}

/** Sentinel droppable id for an empty container (a folder/collection with zero items has no sortable item to drop onto). */
export function containerEndId(location: RequestLocation): string {
  return `container-end:${containerKey(location)}`;
}

export function parseContainerEndId(id: string): string | null {
  return id.startsWith("container-end:") ? id.slice("container-end:".length) : null;
}

export function buildDndTree(collection: Collection): DndTree {
  const meta = new Map<string, DndItemMeta>();
  const containers = new Map<string, string[]>();

  function walk(items: CollectionItem[], location: RequestLocation) {
    containers.set(containerKey(location), items.map((item) => item.id));
    items.forEach((item, index) => {
      meta.set(item.id, { type: item.type, location, index });
      if (isFolder(item)) {
        walk(item.items, { collectionId: location.collectionId, folderPath: [...(location.folderPath ?? []), item.id] });
      }
    });
  }

  walk(collection.items, { collectionId: collection.id, folderPath: [] });
  return { meta, containers };
}

/** The location a folder's OWN children live in — `[...ancestorPath, folder.id]`. Derived from where the folder itself lives (`meta.location`) plus its own id. */
export function folderChildLocation(tree: DndTree, folderId: string): RequestLocation | null {
  const meta = tree.meta.get(folderId);
  if (!meta) return null;
  return { collectionId: meta.location.collectionId, folderPath: [...(meta.location.folderPath ?? []), folderId] };
}

function parseContainerKey(key: string): RequestLocation {
  const [collectionId, pathStr] = key.split("::");
  return { collectionId: collectionId ?? "", folderPath: pathStr ? pathStr.split("/") : [] };
}

export type DropAction =
  | { kind: "reorder"; location: RequestLocation; itemId: string; newIndex: number }
  | { kind: "moveRequest"; from: RequestLocation; to: RequestLocation; requestId: string; newIndex?: number }
  | { kind: "moveFolder"; from: RequestLocation; to: RequestLocation; folderId: string; newIndex?: number };

/**
 * Pure resolution of "what should happen" for one drag-end event, given the
 * pre-drag tree snapshot and the raw `active`/`over` ids `@dnd-kit` reports.
 * Kept free of React/DOM so it can be unit-tested directly (see
 * `dndTree.test.ts`) — `CollectionItem.tsx`'s `onDragEnd` just calls this and
 * dispatches whichever store action the result names.
 *
 * Three kinds of drop target, resolved in this order:
 *   1. Another real item (its id is in `tree.meta`) — reorder within the same
 *      container, or move into the target item's container at its index.
 *   2. A folder's own header row (`folder-drop:{folderId}`) — move INTO that
 *      folder, appended at the end (no target index).
 *   3. An empty container's placeholder (`container-end:{key}`) — move into
 *      that (empty) container, appended at the end.
 * Returns `null` for a no-op drag (dropped on itself, on an unrecognized
 * target, or already in the target container with no target index to react
 * to).
 */
export function resolveDrop(tree: DndTree, activeId: string, overId: string | null): DropAction | null {
  if (!overId || activeId === overId) return null;
  const source = tree.meta.get(activeId);
  if (!source) return null;

  const overMeta = tree.meta.get(overId);
  if (overMeta) {
    const sameContainer = containerKey(source.location) === containerKey(overMeta.location);
    if (sameContainer) {
      return { kind: "reorder", location: source.location, itemId: activeId, newIndex: overMeta.index };
    }
    return source.type === "request"
      ? { kind: "moveRequest", from: source.location, to: overMeta.location, requestId: activeId, newIndex: overMeta.index }
      : { kind: "moveFolder", from: source.location, to: overMeta.location, folderId: activeId, newIndex: overMeta.index };
  }

  const folderId = parseFolderDropId(overId);
  if (folderId) {
    if (folderId === activeId) return null; // a folder can't be dropped onto its own header
    const childLoc = folderChildLocation(tree, folderId);
    if (!childLoc) return null;
    return source.type === "request"
      ? { kind: "moveRequest", from: source.location, to: childLoc, requestId: activeId }
      : { kind: "moveFolder", from: source.location, to: childLoc, folderId: activeId };
  }

  const endKey = parseContainerEndId(overId);
  if (endKey) {
    const location = parseContainerKey(endKey);
    if (containerKey(location) === containerKey(source.location)) return null; // already there
    return source.type === "request"
      ? { kind: "moveRequest", from: source.location, to: location, requestId: activeId }
      : { kind: "moveFolder", from: source.location, to: location, folderId: activeId };
  }

  return null;
}
