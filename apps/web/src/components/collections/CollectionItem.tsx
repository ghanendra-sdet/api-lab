import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { isFolder, isRequest, type Collection, type RequestLocation } from "@api-lab/workspace-engine";
import { exportPostmanCollection } from "@api-lab/collection-format";
import { useAppStore } from "../../store/useAppStore";
import { downloadJson, slugifyFilename } from "../../lib/importExport";
import { buildDndTree, containerKey, resolveDrop } from "../../lib/dndTree";
import { RequestItem } from "./RequestItem";
import { FolderItem } from "./FolderItem";
import { RunnerDialog } from "../runner/RunnerDialog";
import { CollectionSettingsDialog } from "./CollectionSettingsDialog";
import { DragPreview } from "./DragPreview";
import { EmptyContainerDropZone } from "./EmptyContainerDropZone";

interface CollectionItemProps {
  collection: Collection;
}

export function CollectionItem({ collection }: CollectionItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelId = `collection-panel-${collection.id}`;
  const renameCollection = useAppStore((s) => s.renameCollection);
  const deleteCollection = useAppStore((s) => s.deleteCollection);
  const createFolder = useAppStore((s) => s.createFolder);
  const saveNewRequest = useAppStore((s) => s.saveNewRequest);
  const moveCollectionUp = useAppStore((s) => s.moveCollectionUp);
  const moveCollectionDown = useAppStore((s) => s.moveCollectionDown);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const moveSavedRequest = useAppStore((s) => s.moveSavedRequest);
  const moveFolderAction = useAppStore((s) => s.moveFolder);
  const reorderItemsAction = useAppStore((s) => s.reorderItems);

  // Phase 3 of Workspace Management: `CollectionItem` is the DnD root for
  // its own subtree (per plan.md) — one `DndContext` here covers every
  // `FolderItem`/`RequestItem` nested inside it, at any depth. `dndTree` is
  // rebuilt fresh from `collection` on every render (see `dndTree.ts`), so
  // it always reflects the current, pre-drag tree — no separate mount-time
  // registration to keep in sync.
  const dndTree = useMemo(() => buildDndTree(collection), [collection]);
  const [activeDrag, setActiveDrag] = useState<{ id: string; name: string; type: "folder" | "request" } | null>(
    null,
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function findItemName(id: string): string {
    function walk(items: Collection["items"]): string | null {
      for (const item of items) {
        if (item.id === id) return item.name;
        if (isFolder(item)) {
          const found = walk(item.items);
          if (found) return found;
        }
      }
      return null;
    }
    return walk(collection.items) ?? "";
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const meta = dndTree.meta.get(id);
    if (!meta) return;
    setActiveDrag({ id, name: findItemName(id), type: meta.type });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const action = resolveDrop(dndTree, String(event.active.id), event.over ? String(event.over.id) : null);
    if (!action) return;
    try {
      if (action.kind === "reorder") {
        reorderItemsAction(action.location, action.itemId, action.newIndex);
      } else if (action.kind === "moveRequest") {
        moveSavedRequest(action.from, action.to, action.requestId);
        if (action.newIndex !== undefined) reorderItemsAction(action.to, action.requestId, action.newIndex);
      } else {
        moveFolderAction(action.from, action.to, action.folderId);
        if (action.newIndex !== undefined) reorderItemsAction(action.to, action.folderId, action.newIndex);
      }
    } catch (err) {
      // `moveFolder` throws if the drop would nest a folder inside its own
      // descendant — a real, expected rejection (see `folder.ts`), not a
      // bug. Swallow it here rather than let it propagate and crash the
      // sidebar; nothing else reachable from a drop throws.
      console.warn("Drag-and-drop move rejected:", err instanceof Error ? err.message : err);
    }
  }

  function handleRename() {
    const name = window.prompt("Rename collection", collection.name);
    if (name && name.trim()) renameCollection(collection.id, name.trim());
  }

  function handleDelete() {
    if (window.confirm(`Delete collection "${collection.name}" and everything in it? This cannot be undone.`)) {
      deleteCollection(collection.id);
    }
  }

  function handleNewFolder() {
    const name = window.prompt("Folder name", "New Folder");
    if (name && name.trim()) createFolder(collection.id, name.trim());
  }

  function handleNewRequest() {
    const name = window.prompt("Request name", "New Request");
    if (name && name.trim()) saveNewRequest(activeTabId, { collectionId: collection.id }, name.trim());
  }

  function handleExportPostman() {
    const data = exportPostmanCollection(collection);
    downloadJson(`${slugifyFilename(collection.name)}.postman_collection.json`, data);
  }

  const rootLocation: RequestLocation = { collectionId: collection.id, folderPath: [] };
  const rootItemIds = dndTree.containers.get(containerKey(rootLocation)) ?? [];

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <li>
      <div className="group flex items-center gap-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-900">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-sm font-medium text-neutral-700 dark:text-neutral-200"
        >
          <span
            className={`inline-block text-neutral-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          >
            ▸
          </span>
          <span className="truncate">{collection.name}</span>
        </button>
        <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => moveCollectionUp(collection.id)}
            aria-label={`Move ${collection.name} up`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => moveCollectionDown(collection.id)}
            aria-label={`Move ${collection.name} down`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={handleNewFolder}
            aria-label={`New folder in ${collection.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            📁+
          </button>
          <button
            type="button"
            onClick={handleNewRequest}
            aria-label={`New request in ${collection.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setRunnerOpen(true)}
            aria-label={`Run ${collection.name}`}
            title="Run Collection"
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={handleExportPostman}
            aria-label={`Export ${collection.name} as Postman`}
            title="Export as Postman Collection"
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ⇩
          </button>
          <button
            type="button"
            onClick={handleRename}
            aria-label={`Rename ${collection.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={`Settings for ${collection.name}`}
            title="Collection Settings"
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label={`Delete ${collection.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </div>
      {expanded && (
        <SortableContext items={rootItemIds} strategy={verticalListSortingStrategy}>
          <ul id={panelId} className="ml-3 space-y-0.5 border-l border-neutral-200 pl-2 dark:border-neutral-800">
            {collection.items.length === 0 ? (
              <EmptyContainerDropZone location={rootLocation} label="Empty collection — use + to add a request or folder" />
            ) : (
              collection.items.map((item) =>
                isFolder(item) ? (
                  <FolderItem key={item.id} collectionId={collection.id} folder={item} dndTree={dndTree} />
                ) : isRequest(item) ? (
                  <RequestItem key={item.id} request={item} location={{ collectionId: collection.id }} />
                ) : null,
              )
            )}
          </ul>
        </SortableContext>
      )}
      {runnerOpen && <RunnerDialog collection={collection} onClose={() => setRunnerOpen(false)} />}
      {settingsOpen && (
        <CollectionSettingsDialog collection={collection} onClose={() => setSettingsOpen(false)} />
      )}
    </li>
    <DragOverlay>{activeDrag && <DragPreview name={activeDrag.name} type={activeDrag.type} />}</DragOverlay>
    </DndContext>
  );
}
