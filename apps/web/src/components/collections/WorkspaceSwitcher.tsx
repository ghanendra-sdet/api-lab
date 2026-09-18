import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

/**
 * Phase 1 of Workspace Management: a compact dropdown showing the active
 * workspace, letting the user switch, create, rename, or delete workspaces.
 * Lives at the top of the sidebar (see CollectionSidebar.tsx) — the sidebar
 * is entirely workspace-scoped content (collections, requests), so this is
 * the natural place to show/change which workspace it's showing.
 */
export function WorkspaceSwitcher() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useAppStore((s) => s.switchWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const deleteWorkspace = useAppStore((s) => s.deleteWorkspace);

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function handleRename(id: string, currentName: string) {
    const name = window.prompt("Rename workspace", currentName);
    if (name && name.trim()) renameWorkspace(id, name.trim());
  }

  function handleDelete(id: string, name: string) {
    if (workspaces.length <= 1) {
      window.alert("Can't delete the only workspace.");
      return;
    }
    if (window.confirm(`Delete workspace "${name}"? This discards all its collections and requests.`)) {
      deleteWorkspace(id);
    }
  }

  return (
    <div ref={containerRef} className="relative border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-900"
      >
        <span className="min-w-0 truncate">{active?.name ?? "Workspace"}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Workspaces"
          className="absolute left-2 right-2 top-full z-30 mt-1 rounded border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          <ul className="max-h-64 overflow-y-auto p-1">
            {workspaces.map((w) => (
              <li key={w.id} className="group flex items-center gap-1 rounded">
                <button
                  type="button"
                  role="option"
                  aria-selected={w.id === activeWorkspaceId}
                  onClick={() => {
                    switchWorkspace(w.id);
                    setOpen(false);
                  }}
                  className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm ${
                    w.id === activeWorkspaceId
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  }`}
                >
                  {w.name}
                </button>
                <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleRename(w.id, w.name)}
                    aria-label={`Rename ${w.name}`}
                    className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(w.id, w.name)}
                    aria-label={`Delete ${w.name}`}
                    className="rounded px-1 text-xs text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-neutral-200 p-1 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => {
                setCreateOpen(true);
                setOpen(false);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
            >
              <span aria-hidden="true">+</span> New Workspace
            </button>
          </div>
        </div>
      )}

      {createOpen && <CreateWorkspaceDialog onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
