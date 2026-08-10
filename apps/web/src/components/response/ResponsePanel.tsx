import { ResponseEmptyState } from "./ResponseEmptyState";
import { ResponseTabs } from "./ResponseTabs";

export function ResponsePanel() {
  return (
    <section
      aria-label="Response"
      className="flex min-h-[240px] flex-1 flex-col border-t border-neutral-200 dark:border-neutral-800"
    >
      <div className="flex items-center gap-4 px-4 py-1.5 text-xs text-neutral-400 dark:text-neutral-600">
        <span>
          Status: <span aria-hidden="true">—</span>
        </span>
        <span>
          Time: <span aria-hidden="true">—</span>
        </span>
        <span>
          Size: <span aria-hidden="true">—</span>
        </span>
      </div>
      <ResponseTabs />
      <ResponseEmptyState />
    </section>
  );
}
