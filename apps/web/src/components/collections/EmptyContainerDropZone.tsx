import { useDroppable } from "@dnd-kit/core";
import type { RequestLocation } from "@api-lab/workspace-engine";
import { containerEndId } from "../../lib/dndTree";

interface EmptyContainerDropZoneProps {
  location: RequestLocation;
  label: string;
}

/**
 * Phase 3 of Workspace Management: an empty collection/folder has no
 * sortable item to drop onto, so it needs its own dedicated droppable —
 * otherwise there would be no way to drag anything INTO an empty container.
 * Highlighted while something is dragged over it, using the same
 * hover-highlight visual language as the rest of the sidebar
 * (`group-hover:opacity-100` in `FolderItem.tsx`) rather than inventing a
 * new one.
 */
export function EmptyContainerDropZone({ location, label }: EmptyContainerDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: containerEndId(location) });

  return (
    <li
      ref={setNodeRef}
      className={`rounded px-2 py-1 text-xs italic ${
        isOver
          ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300"
          : "text-neutral-400 dark:text-neutral-600"
      }`}
    >
      {label}
    </li>
  );
}
