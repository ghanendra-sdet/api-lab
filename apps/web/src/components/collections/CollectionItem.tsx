import { useState } from "react";
import type { Collection } from "../../types";
import { RequestItem } from "./RequestItem";

interface CollectionItemProps {
  collection: Collection;
}

export function CollectionItem({ collection }: CollectionItemProps) {
  const [expanded, setExpanded] = useState(true);
  const panelId = `collection-panel-${collection.id}`;

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-900"
      >
        <span
          className={`inline-block text-neutral-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          ▸
        </span>
        <span className="truncate">{collection.name}</span>
      </button>
      {expanded && (
        <ul id={panelId} className="ml-3 space-y-0.5 border-l border-neutral-200 pl-2 dark:border-neutral-800">
          {collection.requests.map((request) => (
            <RequestItem key={request.id} request={request} />
          ))}
        </ul>
      )}
    </li>
  );
}
