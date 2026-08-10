import { useAppStore } from "../../store/useAppStore";
import { CollectionItem } from "./CollectionItem";

export function CollectionSidebar() {
  const collections = useAppStore((s) => s.collections);

  return (
    <nav aria-label="Collections" className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Collections
        </h2>
      </div>
      <div className="px-2">
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
        >
          <span aria-hidden="true">+</span> New Collection
        </button>
      </div>
      <ul className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {collections.map((collection) => (
          <CollectionItem key={collection.id} collection={collection} />
        ))}
      </ul>
    </nav>
  );
}
