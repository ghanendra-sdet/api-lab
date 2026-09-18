interface DragPreviewProps {
  name: string;
  type: "folder" | "request";
}

/**
 * Phase 3 of Workspace Management: the floating preview shown under the
 * pointer while dragging a folder/request in the sidebar tree
 * (`@dnd-kit`'s `DragOverlay`). Deliberately minimal — just enough to
 * confirm what's being dragged — styled with the same rounded/border/shadow
 * language as the rest of the sidebar rather than introducing a new visual
 * idiom.
 */
export function DragPreview({ name, type }: DragPreviewProps) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-blue-300 bg-white px-2 py-1 text-sm text-neutral-700 shadow-lg dark:border-blue-700 dark:bg-neutral-900 dark:text-neutral-200">
      {type === "folder" && <span aria-hidden="true">📁</span>}
      <span className="truncate">{name}</span>
    </div>
  );
}
