import { useAppStore } from "../../store/useAppStore";
import { methodTextClass } from "../../lib/methodStyles";
import { isTabDirty } from "../../lib/requestConfig";

export function RequestTabs() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const openNewTab = useAppStore((s) => s.openNewTab);

  function handleClose(tabId: string, tab: (typeof tabs)[number]) {
    if (isTabDirty(tab)) {
      const proceed = window.confirm(
        `"${tab.name}" has unsaved changes. Close this tab and discard them?`,
      );
      if (!proceed) return;
    }
    closeTab(tabId);
  }

  return (
    <div
      role="tablist"
      aria-label="Open requests"
      className="scrollbar-thin flex items-stretch overflow-x-auto border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const dirty = isTabDirty(tab);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            className={`group flex shrink-0 items-center gap-2 border-r border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 ${
              isActive
                ? "bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5"
            >
              <span className={`text-[11px] font-bold ${methodTextClass(tab.method)}`}>
                {tab.method}
              </span>
              <span className="max-w-[10rem] truncate">{tab.name}</span>
              {dirty && <span className="text-neutral-400 dark:text-neutral-500">*</span>}
            </button>
            <button
              type="button"
              onClick={() => handleClose(tab.id, tab)}
              aria-label={`Close ${tab.name} tab`}
              className="rounded px-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={openNewTab}
        aria-label="Open new request tab"
        className="shrink-0 px-3 py-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
      >
        +
      </button>
    </div>
  );
}
