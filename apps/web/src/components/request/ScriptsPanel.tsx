import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";
import type { ScriptResult } from "@api-lab/script-engine";

function ScriptResultDisplay({ title, result }: { title: string; result: ScriptResult }) {
  return (
    <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5 font-medium dark:border-neutral-800">
        <span>{title}</span>
        <span className={result.status === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
          {result.status.toUpperCase()} ({result.duration}ms)
        </span>
      </div>
      {result.error && (
        <div className="mt-2 font-mono text-xs text-red-600 dark:text-red-400">
          Error: {result.error}
        </div>
      )}
      {result.logs && result.logs.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Console Logs</p>
          <div className="max-h-32 overflow-y-auto rounded bg-neutral-950 p-2 font-mono text-xs text-neutral-200">
            {result.logs.map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className={`select-none font-bold uppercase ${log.type === 'error' ? 'text-red-500' : log.type === 'warn' ? 'text-yellow-500' : 'text-blue-400'}`}>
                  [{log.type}]
                </span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-neutral-400 italic">No console logs recorded</div>
      )}
    </div>
  );
}

export function ScriptsPanel({ tab }: { tab: RequestTabState }) {
  const setPreRequestScript = useAppStore((s) => s.setPreRequestScript);
  const setPostResponseScript = useAppStore((s) => s.setPostResponseScript);
  const preResult = useAppStore((s) => s.preRequestScriptResults[tab.id]);
  const postResult = useAppStore((s) => s.postResponseScriptResults[tab.id]);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <p className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        Scripts execute in a secure browser Web Worker sandbox with no direct access to window, document, local storage or cookies.
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
        {preResult && <ScriptResultDisplay title="Pre-request Script" result={preResult} />}
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
        {postResult && <ScriptResultDisplay title="Post-response Script" result={postResult} />}
      </div>
    </div>
  );
}
