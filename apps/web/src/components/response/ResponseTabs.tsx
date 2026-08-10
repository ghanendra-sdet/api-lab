export type ResponseSection = "body" | "headers" | "cookies";
export type ResponseViewMode = "pretty" | "raw" | "preview";

const SECTIONS: { id: ResponseSection; label: string; disabled?: boolean }[] = [
  { id: "body", label: "Body" },
  { id: "headers", label: "Headers" },
  { id: "cookies", label: "Cookies", disabled: true },
];

const VIEW_MODES: { id: ResponseViewMode; label: string }[] = [
  { id: "pretty", label: "Pretty" },
  { id: "raw", label: "Raw" },
  { id: "preview", label: "Preview" },
];

interface ResponseTabsProps {
  section: ResponseSection;
  onSectionChange: (section: ResponseSection) => void;
  viewMode: ResponseViewMode;
  onViewModeChange: (mode: ResponseViewMode) => void;
  hasResponse: boolean;
}

export function ResponseTabs({
  section,
  onSectionChange,
  viewMode,
  onViewModeChange,
  hasResponse,
}: ResponseTabsProps) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-1.5 dark:border-neutral-800">
      <div className="flex gap-3" role="tablist" aria-label="Response section">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            disabled={!hasResponse || s.disabled}
            onClick={() => onSectionChange(s.id)}
            className={`text-sm disabled:cursor-not-allowed disabled:text-neutral-300 dark:disabled:text-neutral-700 ${
              hasResponse && section === s.id
                ? "font-medium text-neutral-900 dark:text-neutral-50"
                : "text-neutral-400 hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-300"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section === "body" && (
        <div className="flex gap-1" role="group" aria-label="Response view mode">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              disabled={!hasResponse}
              onClick={() => onViewModeChange(mode.id)}
              aria-pressed={viewMode === mode.id}
              className={`rounded px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:text-neutral-300 dark:disabled:text-neutral-700 ${
                hasResponse && viewMode === mode.id
                  ? "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-300"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
