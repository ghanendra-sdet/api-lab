import { useState } from "react";
import type { Variable } from "@api-lab/environment-engine";

interface VariableEditorProps {
  environmentId: string;
  variables: Variable[];
  onAdd: () => void;
  onUpdate: (variableId: string, patch: Partial<Pick<Variable, "key" | "value" | "enabled" | "secret">>) => void;
  onRemove: (variableId: string) => void;
}

/** A key/value/secret/enabled table for one environment's variables. Secret
 * values are masked by default; each row has its own show/hide toggle so
 * revealing one secret doesn't reveal every secret in the environment. */
export function VariableEditor({ variables, onAdd, onUpdate, onRemove }: VariableEditorProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  function toggleReveal(variableId: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(variableId)) next.delete(variableId);
      else next.add(variableId);
      return next;
    });
  }

  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Variables</caption>
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <th scope="col" className="w-8 py-1.5 pr-2 font-medium"></th>
            <th scope="col" className="py-1.5 pr-2 font-medium">
              Key
            </th>
            <th scope="col" className="py-1.5 pr-2 font-medium">
              Value
            </th>
            <th scope="col" className="w-16 py-1.5 pr-2 font-medium">
              Secret
            </th>
            <th scope="col" className="w-8 py-1.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {variables.map((variable) => {
            const isRevealed = revealed.has(variable.id);
            const showAsPassword = variable.secret && !isRevealed;
            return (
              <tr key={variable.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1 pr-2">
                  <input
                    type="checkbox"
                    checked={variable.enabled}
                    onChange={(e) => onUpdate(variable.id, { enabled: e.target.checked })}
                    aria-label={`Enable variable ${variable.key || "(empty key)"}`}
                    className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-neutral-700"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    value={variable.key}
                    onChange={(e) => onUpdate(variable.id, { key: e.target.value })}
                    placeholder="key"
                    aria-label="Key"
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                  />
                </td>
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-1">
                    <input
                      type={showAsPassword ? "password" : "text"}
                      value={variable.value}
                      onChange={(e) => onUpdate(variable.id, { value: e.target.value })}
                      placeholder="value"
                      aria-label="Value"
                      autoComplete="off"
                      className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                    />
                    {variable.secret && (
                      <button
                        type="button"
                        onClick={() => toggleReveal(variable.id)}
                        aria-label={isRevealed ? `Hide value for ${variable.key}` : `Show value for ${variable.key}`}
                        className="shrink-0 rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                      >
                        {isRevealed ? "Hide" : "Show"}
                      </button>
                    )}
                  </div>
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="checkbox"
                    checked={variable.secret}
                    onChange={(e) => onUpdate(variable.id, { secret: e.target.checked })}
                    aria-label={`Mark ${variable.key || "(empty key)"} as secret`}
                    className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-neutral-700"
                  />
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(variable.id)}
                    aria-label={`Delete variable ${variable.key || "(empty key)"}`}
                    className="rounded px-1.5 py-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 rounded px-2 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
      >
        + Add variable
      </button>
    </div>
  );
}
