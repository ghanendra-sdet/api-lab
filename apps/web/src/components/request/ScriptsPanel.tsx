import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";

export function ScriptsPanel({ tab }: { tab: RequestTabState }) {
  const setPreRequestScript = useAppStore((s) => s.setPreRequestScript);
  const setPostResponseScript = useAppStore((s) => s.setPostResponseScript);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <p className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        Scripts don't run yet — execution ships in Milestone 7, behind the sandbox described in
        docs/SECURITY.md. This is just the editing surface.
      </p>
      <div className="flex-1">
        <label
          htmlFor="pre-request-script"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          Pre-request Script
        </label>
        <textarea
          id="pre-request-script"
          value={tab.preRequestScript}
          onChange={(e) => setPreRequestScript(tab.id, e.target.value)}
          spellCheck={false}
          placeholder="// runs before the request is sent"
          className="h-32 w-full resize-y rounded border border-neutral-200 bg-white p-2 font-mono text-sm text-neutral-800 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </div>
      <div className="flex-1">
        <label
          htmlFor="post-response-script"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          Post-response Script
        </label>
        <textarea
          id="post-response-script"
          value={tab.postResponseScript}
          onChange={(e) => setPostResponseScript(tab.id, e.target.value)}
          spellCheck={false}
          placeholder="// runs after the response arrives"
          className="h-32 w-full resize-y rounded border border-neutral-200 bg-white p-2 font-mono text-sm text-neutral-800 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </div>
    </div>
  );
}
