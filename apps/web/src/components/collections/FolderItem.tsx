import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { isFolder, isRequest, type Folder } from "@api-lab/workspace-engine";
import { useAppStore } from "../../store/useAppStore";
import { containerKey, folderDropId, type DndTree } from "../../lib/dndTree";
import { RequestItem } from "./RequestItem";
import { RunnerDialog } from "../runner/RunnerDialog";
import { FolderSettingsDialog } from "./FolderSettingsDialog";
import { EmptyContainerDropZone } from "./EmptyContainerDropZone";

interface FolderItemProps {
  collectionId: string;
  folder: Folder;
  /** Ordered ancestor chain of folder ids ABOVE this folder (outermost
   * first) — does not include this folder's own id. Empty for a top-level
   * folder. Used to build the full `folderPath` for this folder's own
   * children (`[...ancestorFolderPath, folder.id]`), so nested requests and
   * subfolders resolve/save against their true location at any depth. */
  ancestorFolderPath?: string[];
  /** Phase 3 of Workspace Management: the whole-subtree DnD lookup built once
   * by `CollectionItem` (the DnD root) and threaded down unchanged — gives
   * every nested `FolderItem` its own children's container id list for its
   * `SortableContext`, without each level re-deriving it. */
  dndTree: DndTree;
}

export function FolderItem({ collectionId, folder, ancestorFolderPath = [], dndTree }: FolderItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelId = `folder-panel-${folder.id}`;
  const collection = useAppStore((s) => s.workspace.collections.find((c) => c.id === collectionId));
  const renameFolder = useAppStore((s) => s.renameFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const createFolder = useAppStore((s) => s.createFolder);
  const saveNewRequest = useAppStore((s) => s.saveNewRequest);
  const activeTabId = useAppStore((s) => s.activeTabId);

  const folderPath = [...ancestorFolderPath, folder.id];
  const childLocation = { collectionId, folderPath };
  const childItemIds = dndTree.containers.get(containerKey(childLocation)) ?? [];

  // Sortable: this folder as a drag source, and as a drop target for
  // "reorder relative to this folder" within its OWN parent container.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: folder.id });
  const sortableStyle = { transform: CSS.Transform.toString(transform), transition };
  // Separate droppable for "drop INTO this folder" — a distinct target from
  // the sortable reorder-among-siblings behavior above, addressed by
  // `folderDropId` so `resolveDrop` (dndTree.ts) can tell the two apart.
  const { setNodeRef: setDropIntoRef, isOver: isDropTarget } = useDroppable({ id: folderDropId(folder.id) });

  function handleRename() {
    const name = window.prompt("Rename folder", folder.name);
    if (name && name.trim()) renameFolder(collectionId, folder.id, name.trim());
  }

  function handleDelete() {
    if (window.confirm(`Delete folder "${folder.name}" and everything in it? This cannot be undone.`)) {
      deleteFolder(collectionId, folder.id);
    }
  }

  function handleNewRequest() {
    const name = window.prompt("Request name", "New Request");
    if (name && name.trim()) saveNewRequest(activeTabId, { collectionId, folderPath }, name.trim());
  }

  function handleNewSubfolder() {
    const name = window.prompt("Folder name", "New Folder");
    if (name && name.trim()) createFolder(collectionId, name.trim(), folder.id);
  }

  return (
    <li ref={setNodeRef} style={sortableStyle} className={isDragging ? "opacity-40" : undefined}>
      <div
        ref={setDropIntoRef}
        className={`group flex items-center gap-1 rounded ${
          isDropTarget ? "bg-blue-50 ring-1 ring-inset ring-blue-300 dark:bg-blue-950 dark:ring-blue-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
        }`}
      >
        <span
          {...attributes}
          {...listeners}
          aria-label={`Drag to move ${folder.name}`}
          role="button"
          tabIndex={0}
          className="shrink-0 cursor-grab px-1 text-neutral-300 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing dark:text-neutral-600"
        >
          ⠿
        </span>
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
          <span aria-hidden="true">📁</span>
          <span className="truncate">{folder.name}</span>
        </button>
        <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={handleNewSubfolder}
            aria-label={`New folder in ${folder.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            📁+
          </button>
          <button
            type="button"
            onClick={handleNewRequest}
            aria-label={`New request in ${folder.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setRunnerOpen(true)}
            aria-label={`Run ${folder.name}`}
            title="Run Folder"
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={handleRename}
            aria-label={`Rename ${folder.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={`Settings for ${folder.name}`}
            title="Folder Settings"
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label={`Delete ${folder.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </div>
      {expanded && (
        <SortableContext items={childItemIds} strategy={verticalListSortingStrategy}>
          <ul id={panelId} className="ml-3 space-y-0.5 border-l border-neutral-200 pl-2 dark:border-neutral-800">
            {folder.items.length === 0 ? (
              <EmptyContainerDropZone location={childLocation} label="Empty folder" />
            ) : (
              folder.items.map((item) =>
                isFolder(item) ? (
                  <FolderItem
                    key={item.id}
                    collectionId={collectionId}
                    folder={item}
                    ancestorFolderPath={folderPath}
                    dndTree={dndTree}
                  />
                ) : isRequest(item) ? (
                  <RequestItem key={item.id} request={item} location={{ collectionId, folderPath }} />
                ) : null,
              )
            )}
          </ul>
        </SortableContext>
      )}
      {runnerOpen && collection && (
        <RunnerDialog
          collection={collection}
          folderId={folder.id}
          onClose={() => setRunnerOpen(false)}
        />
      )}
      {settingsOpen && (
        <FolderSettingsDialog
          collectionId={collectionId}
          folder={folder}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </li>
  );
}
