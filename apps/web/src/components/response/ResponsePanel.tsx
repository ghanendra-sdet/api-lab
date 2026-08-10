import { useState } from "react";
import { useActiveTab, useAppStore } from "../../store/useAppStore";
import { formatDuration, formatSize, statusColorClass } from "../../lib/format";
import { ResponseEmptyState } from "./ResponseEmptyState";
import { ResponseErrorState } from "./ResponseErrorState";
import { ResponseTabs, type ResponseSection, type ResponseViewMode } from "./ResponseTabs";
import { ResponseBody } from "./ResponseBody";
import { ResponseHeaders } from "./ResponseHeaders";

export function ResponsePanel() {
  const tab = useActiveTab();
  const response = useAppStore((s) => s.responses[tab.id]);
  const [section, setSection] = useState<ResponseSection>("body");
  const [viewMode, setViewMode] = useState<ResponseViewMode>("pretty");

  const hasResponse = response !== undefined;
  const hasError = response?.error != null;

  return (
    <section
      aria-label="Response"
      className="flex min-h-[240px] flex-1 flex-col border-t border-neutral-200 dark:border-neutral-800"
    >
      <div className="flex items-center gap-4 px-4 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          Status:{" "}
          {response && response.status !== null ? (
            <span className={`font-semibold ${statusColorClass(response.status, response.ok)}`}>
              {response.status} {response.statusText}
            </span>
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </span>
        <span>Time: {response ? formatDuration(response.duration) : <span aria-hidden="true">—</span>}</span>
        <span>Size: {response ? formatSize(response.size) : <span aria-hidden="true">—</span>}</span>
      </div>

      <ResponseTabs
        section={section}
        onSectionChange={setSection}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        hasResponse={hasResponse && !hasError}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {!hasResponse && <ResponseEmptyState />}
        {hasResponse && hasError && <ResponseErrorState message={response.error!} />}
        {hasResponse && !hasError && section === "body" && (
          <ResponseBody response={response} viewMode={viewMode} />
        )}
        {hasResponse && !hasError && section === "headers" && (
          <ResponseHeaders headers={response.headers} />
        )}
      </div>
    </section>
  );
}
