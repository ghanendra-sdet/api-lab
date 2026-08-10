const VIEW_MODES = ["Pretty", "Raw", "Preview"];
const SECTIONS = ["Body", "Headers", "Cookies"];

/**
 * Structural placeholder for the response viewer's future tab strips.
 * Disabled — there is no response to switch views on until Milestone 2.
 */
export function ResponseTabs() {
  return (
    <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-1.5 dark:border-neutral-800">
      <div className="flex gap-3" role="tablist" aria-label="Response section">
        {SECTIONS.map((section, i) => (
          <span
            key={section}
            className={`text-sm ${
              i === 0
                ? "font-medium text-neutral-400 dark:text-neutral-600"
                : "text-neutral-300 dark:text-neutral-700"
            }`}
            aria-disabled="true"
          >
            {section}
          </span>
        ))}
      </div>
      <div className="flex gap-1" role="group" aria-label="Response view mode">
        {VIEW_MODES.map((mode, i) => (
          <span
            key={mode}
            className={`rounded px-2 py-0.5 text-xs ${
              i === 0
                ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600"
                : "text-neutral-300 dark:text-neutral-700"
            }`}
            aria-disabled="true"
          >
            {mode}
          </span>
        ))}
      </div>
    </div>
  );
}
