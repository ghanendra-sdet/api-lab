import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface RunnerOrderRowProps {
  id: string;
  name: string;
  checked: boolean;
  onToggle: () => void;
}

/**
 * Phase 3 of Workspace Management: one row in the Collection Runner's
 * user-reorderable `executionOrder` list — this closes Collection Runner
 * gap item #1/#2 (an independent, drag-and-drop-reorderable execution
 * order, see plan.md), reusing the exact same `@dnd-kit` sortable pattern
 * built for the sidebar tree (`RequestItem.tsx`/`FolderItem.tsx`).
 *
 * The checkbox controls whether this request is *included* in the run;
 * dragging controls *where* it falls in the run's sequence — the two are
 * independent, so a request can be reordered while unchecked (it'll run in
 * that position if re-checked later, without having to redo the drag).
 */
export function RunnerOrderRow({ id, name, checked, onToggle }: RunnerOrderRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 rounded ${isDragging ? "opacity-40" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${name}`}
        role="button"
        tabIndex={0}
        className="shrink-0 cursor-grab px-1 text-neutral-300 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing dark:text-neutral-600"
      >
        ⠿
      </span>
      <label className="flex flex-1 items-center gap-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 rounded border-neutral-300 text-blue-600 dark:border-neutral-700"
        />
        {name}
      </label>
    </li>
  );
}
