import { useState } from "react";
import { exportNativeWorkspace } from "@api-lab/collection-format";
import { useAppStore } from "../../store/useAppStore";
import { downloadJson } from "../../lib/importExport";
import { CollectionItem } from "./CollectionItem";
import { ImportDialog } from "../importExport/ImportDialog";
import { HistorySidebar } from "./HistorySidebar";

export function CollectionSidebar() {
  const collections = useAppStore((s) => s.workspace.collections);
  const workspace = useAppStore((s) => s.workspace);
  const environments = useAppStore((s) => s.environments);
  const workspaceLoadError = useAppStore((s) => s.workspaceLoadError);
  const createCollection = useAppStore((s) => s.createCollection);
  const resetWorkspace = useAppStore((s) => s.resetWorkspace);
  const [importOpen, setImportOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"collections" | "history">("collections");

  function handleNewCollection() {
    const name = window.prompt("Collection name", "New Collection");
    if (name && name.trim()) createCollection(name.trim());
  }

  function handleExportWorkspace() {
    const data = exportNativeWorkspace(workspace, environments);
    downloadJson("api-lab-workspace.json", data);
  }

  return (
    <nav aria-label="Collections" className="flex h-full flex-col">
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <button
          type="button"
          onClick={() => setSidebarTab("collections")}
          className={`flex-1 py-3 text-center text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors focus-visible:outline-none focus-visible:bg-neutral-100 dark:focus-visible:bg-neutral-900 ${
            sidebarTab === "collections"
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
          }`}
        >
          Collections
        </button>
        <button
          type="button"
          onClick={() => setSidebarTab("history")}
          className={`flex-1 py-3 text-center text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors focus-visible:outline-none focus-visible:bg-neutral-100 dark:focus-visible:bg-neutral-900 ${
            sidebarTab === "history"
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 font-bold"
              : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
          }`}
        >
          History
        </button>
      </div>

      {sidebarTab === "history" ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <HistorySidebar />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 pb-2 pt-3 shrink-0">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Collections
            </h2>
          </div>

          {workspaceLoadError && (
            <div
              role="alert"
              className="mx-2 mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 shrink-0"
            >
              <p className="mb-1 font-medium">Saved collections couldn't be loaded.</p>
              <p className="mb-2 text-amber-700 dark:text-amber-400">{workspaceLoadError}</p>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Reset local workspace? This discards the unreadable saved data and starts fresh.")) {
                    resetWorkspace();
                  }
                }}
                className="rounded border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
              >
                Reset Local Workspace
              </button>
            </div>
          )}

          <div className="flex items-center gap-1 px-2 shrink-0">
            <button
              type="button"
              onClick={handleNewCollection}
              className="mb-2 flex flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
            >
              <span aria-hidden="true">+</span> New Collection
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="mb-2 rounded px-2 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              Import
            </button>
            <button
              type="button"
              onClick={handleExportWorkspace}
              aria-label="Export workspace"
              title="Export entire workspace (API Lab native format)"
              className="mb-2 rounded px-2 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              Export
            </button>
          </div>
          {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}

          {collections.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-600 flex-1">
              No collections yet. Create one to start saving requests.
            </div>
          ) : (
            <ul className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 pb-3">
              {collections.map((collection) => (
                <CollectionItem key={collection.id} collection={collection} />
              ))}
            </ul>
          )}
        </>
      )}
    </nav>
  );
}
