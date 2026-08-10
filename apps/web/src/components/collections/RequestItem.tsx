import { methodTextClass } from "../../lib/methodStyles";
import type { SavedRequest } from "../../types";

interface RequestItemProps {
  request: SavedRequest;
}

export function RequestItem({ request }: RequestItemProps) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        <span className={`w-12 shrink-0 text-[11px] font-bold ${methodTextClass(request.method)}`}>
          {request.method}
        </span>
        <span className="truncate">{request.name}</span>
      </button>
    </li>
  );
}
