import { useAppStore } from "../../store/useAppStore";
import { CollectionItem } from "./CollectionItem";

export function CollectionSidebar() {
  const collections = useAppStore((s) => s.workspace.collections);
  const workspaceLoadError = useAppStore((s) => s.workspaceLoadError);
  const createCollection = useAppStore((s) => s.createCollection);
  const resetWorkspace = useAppStore((s) => s.resetWorkspace);

  function handleNewCollection() {
    const name = window.prompt("Collection name", "New Collection");
    if (name && name.trim()) createCollection(name.trim());
  }

  return (
    <nav aria-label="Collections" className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Collections
        </h2>
      </div>

      {workspaceLoadError && (
        <div
          role="alert"
          className="mx-2 mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
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

      <div className="px-2">
        <button
          type="button"
          onClick={handleNewCollection}
          className="mb-2 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
        >
          <span aria-hidden="true">+</span> New Collection
        </button>
      </div>

      {collections.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-600">
          No collections yet. Create one to start saving requests.
        </div>
      ) : (
        <ul className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {collections.map((collection) => (
            <CollectionItem key={collection.id} collection={collection} />
          ))}
        </ul>
      )}
    </nav>
  );
}
