import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";
import { MethodSelector } from "./MethodSelector";

interface RequestBarProps {
  tab: RequestTabState;
}

export function RequestBar({ tab }: RequestBarProps) {
  const setTabMethod = useAppStore((s) => s.setTabMethod);
  const setTabUrl = useAppStore((s) => s.setTabUrl);
  const sendRequest = useAppStore((s) => s.sendRequest);
  const cancelRequest = useAppStore((s) => s.cancelRequest);
  const resetRequest = useAppStore((s) => s.resetRequest);
  const status = useAppStore((s) => s.requestStatus[tab.id] ?? "idle");
  const sendError = useAppStore((s) => s.sendErrors[tab.id]);
  const isLoading = status === "loading";

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
          aria-invalid={sendError?.field === "url"}
          aria-describedby={sendError?.field === "url" ? "url-error" : undefined}
          className="h-9 flex-1 border-y border-neutral-200 bg-white px-3 font-mono text-sm text-neutral-800 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        />
        {isLoading ? (
          <button
            type="button"
            onClick={() => cancelRequest(tab.id)}
            className="h-9 shrink-0 rounded-r-md bg-neutral-700 px-5 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => sendRequest(tab.id)}
            className="h-9 shrink-0 rounded-r-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800"
          >
            Send
          </button>
        )}
        <button
          type="button"
          onClick={() => resetRequest(tab.id)}
          className="ml-2 h-9 shrink-0 rounded-md border border-neutral-200 px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          Clear
        </button>
      </div>
      {isLoading && (
        <p role="status" className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Sending...
        </p>
      )}
      {sendError && (
        <p id="url-error" role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {sendError.message}
        </p>
      )}
    </div>
  );
}
