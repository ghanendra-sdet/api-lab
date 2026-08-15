import { useAppStore } from "../../store/useAppStore";
import { methodTextClass } from "../../lib/methodStyles";
import { statusColorClass } from "../../lib/format";
import type { HistoryItem } from "../../types";

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

export function HistorySidebar() {
  const history = useAppStore((s) => s.history);
  const clearHistory = useAppStore((s) => s.clearHistory);
  const openHistoryItem = useAppStore((s) => s.openHistoryItem);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Request History
        </h3>
        {history.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Clear All
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-neutral-400 dark:text-neutral-600">
          No requests executed yet.
        </div>
      ) : (
        <ul className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {history.map((item: HistoryItem) => {
            let path = item.url;
            try {
              if (item.url.startsWith("http://") || item.url.startsWith("https://")) {
                path = new URL(item.url).pathname + new URL(item.url).search;
              }
            } catch {
              // fallback
            }

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openHistoryItem(item)}
                  aria-label={`Re-open ${item.method} request to ${path}`}
                  className="w-full flex flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <div className="flex items-center gap-1.5 justify-between min-w-0">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-[10px] font-bold shrink-0 w-10 ${methodTextClass(item.method)}`}>
                        {item.method}
                      </span>
                      <span className="text-xs truncate font-mono text-neutral-700 dark:text-neutral-300">
                        {path || "/"}
                      </span>
                    </span>
                    {item.status !== undefined && (
                      <span className={`text-[10px] font-mono font-semibold shrink-0 ${statusColorClass(item.status, item.status >= 200 && item.status < 300)}`}>
                        {item.status}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-neutral-400 dark:text-neutral-500 pl-11">
                    {formatTime(item.timestamp)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
