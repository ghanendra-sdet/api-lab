import { methodTextClass } from "../../lib/methodStyles";
import { useAppStore } from "../../store/useAppStore";
import type { SavedRequest, RequestLocation } from "@api-lab/workspace-engine";

interface RequestItemProps {
  request: SavedRequest;
  location: RequestLocation;
}

export function RequestItem({ request, location }: RequestItemProps) {
  const openSavedRequest = useAppStore((s) => s.openSavedRequest);
  const renameSavedRequest = useAppStore((s) => s.renameSavedRequest);
  const deleteSavedRequest = useAppStore((s) => s.deleteSavedRequest);
  const duplicateSavedRequest = useAppStore((s) => s.duplicateSavedRequest);
  const moveItemUp = useAppStore((s) => s.moveItemUp);
  const moveItemDown = useAppStore((s) => s.moveItemDown);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const isOpenInActiveTab = useAppStore(
    (s) => s.tabs.find((t) => t.id === activeTabId)?.savedRequestId === request.id,
  );

  function handleRename() {
    const name = window.prompt("Rename request", request.name);
    if (name && name.trim()) renameSavedRequest(location, request.id, name.trim());
  }

  function handleDelete() {
    if (window.confirm(`Delete request "${request.name}"? This cannot be undone.`)) {
      deleteSavedRequest(location, request.id);
    }
  }

  return (
    <li
      className={`group flex items-center gap-1 rounded ${
        isOpenInActiveTab ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
      }`}
    >
      <button
        type="button"
        onClick={() => openSavedRequest(location, request.id)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm text-neutral-700 dark:text-neutral-300"
      >
        <span className={`w-12 shrink-0 text-[11px] font-bold ${methodTextClass(request.request.method)}`}>
          {request.request.method}
        </span>
        <span className="truncate">{request.name}</span>
      </button>
      <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={() => moveItemUp(location, request.id)}
          aria-label={`Move ${request.name} up`}
          className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => moveItemDown(location, request.id)}
          aria-label={`Move ${request.name} down`}
          className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => duplicateSavedRequest(location, request.id)}
          aria-label={`Duplicate ${request.name}`}
          className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          ⧉
        </button>
        <button
          type="button"
          onClick={handleRename}
          aria-label={`Rename ${request.name}`}
          className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={handleDelete}
          aria-label={`Delete ${request.name}`}
          className="rounded px-1 text-xs text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
