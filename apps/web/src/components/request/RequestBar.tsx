import { useState } from "react";
import { buildDisplayVariableContext, resolveVariables } from "@api-lab/environment-engine";
import { useAppStore, useActiveEnvironment } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";
import { isTabDirty } from "../../lib/requestConfig";
import { MethodSelector } from "./MethodSelector";
import { SaveRequestDialog } from "../collections/SaveRequestDialog";

interface RequestBarProps {
  tab: RequestTabState;
}

export function RequestBar({ tab }: RequestBarProps) {
  const setTabMethod = useAppStore((s) => s.setTabMethod);
  const setTabUrl = useAppStore((s) => s.setTabUrl);
  const sendRequest = useAppStore((s) => s.sendRequest);
  const cancelRequest = useAppStore((s) => s.cancelRequest);
  const resetRequest = useAppStore((s) => s.resetRequest);
  const saveTab = useAppStore((s) => s.saveTab);
  const status = useAppStore((s) => s.requestStatus[tab.id] ?? "idle");
  const sendError = useAppStore((s) => s.sendErrors[tab.id]);
  const contractValidationEnabled = useAppStore((s) => s.contractValidationEnabled);
  const setContractValidationEnabled = useAppStore((s) => s.setContractValidationEnabled);
  const activeEnvironment = useActiveEnvironment();
  const isLoading = status === "loading";
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const isLinked = Boolean(tab.savedRequestId && tab.savedLocation);
  const dirty = isTabDirty(tab);

  const hasVariableReference = /\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/.test(tab.url);
  const preview = hasVariableReference
    ? resolveVariables(tab.url, buildDisplayVariableContext(activeEnvironment))
    : null;

  function handleSaveClick() {
    if (isLinked) {
      try {
        saveTab(tab.id);
      } catch (e) {
        const error = e as Error;
        window.alert(error.message);
      }
    } else {
      setShowSaveDialog(true);
    }
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
        <button
          type="button"
          onClick={handleSaveClick}
          aria-label="Save request"
          className={`ml-2 h-9 shrink-0 rounded-md border px-3 text-sm font-medium ${
            isLinked && dirty
              ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
              : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
          }`}
        >
          {isLinked ? (dirty ? "Save*" : "Save") : "Save"}
        </button>
        {/* Contract validation toggle (spec §28), deliberately inline in the
            existing row rather than on a line of its own: an extra row here
            shortens the response viewport for every user, whether or not they
            use contract testing. Off by default — an ordinary request must
            never be slowed or blocked by validation nobody asked for. */}
        <label
          title="Validate the response against the attached OpenAPI contract"
          className="ml-2 flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-neutral-200 px-3 text-sm font-medium text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
        >
          <input
            type="checkbox"
            aria-label="Validate against contract"
            checked={contractValidationEnabled}
            onChange={(e) => setContractValidationEnabled(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-blue-600 dark:border-neutral-700"
          />
          Contract
        </label>
      </div>
      {showSaveDialog && <SaveRequestDialog tabId={tab.id} onClose={() => setShowSaveDialog(false)} />}
      {preview && (
        <p className="mt-2 truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
          <span className="text-neutral-400 dark:text-neutral-600">Resolved: </span>
          {preview.value}
          {preview.unresolvedVariables.length > 0 && (
            <span className="ml-1 text-amber-600 dark:text-amber-400">
              (undefined: {preview.unresolvedVariables.join(", ")})
            </span>
          )}
        </p>
      )}
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
