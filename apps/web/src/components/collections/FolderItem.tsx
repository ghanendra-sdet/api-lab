import { useState } from "react";
import type { Folder } from "@api-lab/workspace-engine";
import { useAppStore } from "../../store/useAppStore";
import { RequestItem } from "./RequestItem";

interface FolderItemProps {
  collectionId: string;
  folder: Folder;
}

export function FolderItem({ collectionId, folder }: FolderItemProps) {
  const [expanded, setExpanded] = useState(true);
  const panelId = `folder-panel-${folder.id}`;
  const renameFolder = useAppStore((s) => s.renameFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const saveNewRequest = useAppStore((s) => s.saveNewRequest);
  const activeTabId = useAppStore((s) => s.activeTabId);

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
    if (name && name.trim()) saveNewRequest(activeTabId, { collectionId, folderId: folder.id }, name.trim());
  }

  return (
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
          <span aria-hidden="true">📁</span>
          <span className="truncate">{folder.name}</span>
        </button>
        <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
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
            onClick={handleRename}
            aria-label={`Rename ${folder.name}`}
            className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✎
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
        <ul id={panelId} className="ml-3 space-y-0.5 border-l border-neutral-200 pl-2 dark:border-neutral-800">
          {folder.items.length === 0 ? (
            <li className="px-2 py-1 text-xs italic text-neutral-400 dark:text-neutral-600">Empty folder</li>
          ) : (
            folder.items.map((request) => (
              <RequestItem key={request.id} request={request} location={{ collectionId, folderId: folder.id }} />
            ))
          )}
        </ul>
      )}
    </li>
  );
}
