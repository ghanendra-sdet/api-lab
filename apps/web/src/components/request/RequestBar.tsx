import { useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";
import { MethodSelector } from "./MethodSelector";

interface RequestBarProps {
  tab: RequestTabState;
}

export function RequestBar({ tab }: RequestBarProps) {
  const setTabMethod = useAppStore((s) => s.setTabMethod);
  const setTabUrl = useAppStore((s) => s.setTabUrl);
  const [showNotice, setShowNotice] = useState(false);

  function handleSend() {
    setShowNotice(true);
    window.setTimeout(() => setShowNotice(false), 3000);
  }

  return (
    <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <div className="flex items-stretch">
        <MethodSelector value={tab.method} onChange={(method) => setTabMethod(tab.id, method)} />
        <label htmlFor="url-input" className="sr-only">
          Request URL
        </label>
        <input
          id="url-input"
          type="text"
          value={tab.url}
          onChange={(e) => setTabUrl(tab.id, e.target.value)}
          placeholder="https://example.com/users"
          spellCheck={false}
          className="h-9 flex-1 border-y border-neutral-200 bg-white px-3 font-mono text-sm text-neutral-800 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <button
          type="button"
          onClick={handleSend}
          aria-describedby={showNotice ? "send-notice" : undefined}
          className="h-9 shrink-0 rounded-r-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800"
        >
          Send
        </button>
      </div>
      {showNotice && (
        <p
          id="send-notice"
          role="status"
          className="mt-2 text-xs text-neutral-500 dark:text-neutral-400"
        >
          Request execution isn't available yet — this ships in Milestone 2.
        </p>
      )}
    </div>
  );
}
