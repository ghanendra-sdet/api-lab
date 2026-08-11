import { useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { VariableEditor } from "./VariableEditor";

interface EnvironmentManagerProps {
  onClose: () => void;
}

/** A focused environment-management dialog: a left list of environments
 * (create/rename/duplicate/delete) and a right-hand variable table for
 * whichever one is selected. Deliberately not a general settings screen —
 * per the milestone's own instruction to keep this simple. */
export function EnvironmentManager({ onClose }: EnvironmentManagerProps) {
  const environments = useAppStore((s) => s.environments.environments);
  const environmentsLoadError = useAppStore((s) => s.environmentsLoadError);
  const resetEnvironments = useAppStore((s) => s.resetEnvironments);
  const createEnvironment = useAppStore((s) => s.createEnvironment);
  const renameEnvironment = useAppStore((s) => s.renameEnvironment);
  const deleteEnvironment = useAppStore((s) => s.deleteEnvironment);
  const duplicateEnvironment = useAppStore((s) => s.duplicateEnvironment);
  const addVariable = useAppStore((s) => s.addVariable);
  const updateVariable = useAppStore((s) => s.updateVariable);
  const removeVariable = useAppStore((s) => s.removeVariable);

  const [selectedId, setSelectedId] = useState<string | null>(environments[0]?.id ?? null);

  useEffect(() => {
    if (selectedId && !environments.some((e) => e.id === selectedId)) {
      setSelectedId(environments[0]?.id ?? null);
    }
  }, [environments, selectedId]);

  const selected = environments.find((e) => e.id === selectedId) ?? null;

  function handleCreate() {
    const name = window.prompt("Environment name", "New Environment");
    if (name && name.trim()) {
      const id = createEnvironment(name.trim());
      setSelectedId(id);
    }
  }

  function handleRename(id: string, currentName: string) {
    const name = window.prompt("Rename environment", currentName);
    if (name && name.trim()) renameEnvironment(id, name.trim());
  }

  function handleDelete(id: string, name: string) {
    if (window.confirm(`Delete environment "${name}"? This cannot be undone.`)) {
      deleteEnvironment(id);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage environments"
        className="relative flex h-[32rem] w-[42rem] max-w-[92vw] flex-col rounded-md bg-white shadow-lg dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Environments</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close environment manager"
            className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        {environmentsLoadError && (
          <div
            role="alert"
            className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          >
            <p className="mb-1 font-medium">Saved environments couldn't be loaded.</p>
            <p className="mb-2 text-amber-700 dark:text-amber-400">{environmentsLoadError}</p>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Reset local environments? This discards the unreadable saved data and starts fresh.",
                  )
                ) {
                  resetEnvironments();
                }
              }}
              className="rounded border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
            >
              Reset Local Environments
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="w-48 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
            <div className="p-2">
              <button
                type="button"
                onClick={handleCreate}
                className="mb-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
              >
                <span aria-hidden="true">+</span> New Environment
              </button>
            </div>
            {environments.length === 0 ? (
              <p className="px-3 py-2 text-xs italic text-neutral-400 dark:text-neutral-600">No environments yet.</p>
            ) : (
              <ul className="space-y-0.5 px-2">
                {environments.map((env) => (
                  <li key={env.id} className="group flex items-center gap-1 rounded">
                    <button
                      type="button"
                      onClick={() => setSelectedId(env.id)}
                      className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm ${
                        env.id === selectedId
                          ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                      }`}
                    >
                      {env.name}
                    </button>
                    <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => duplicateEnvironment(env.id)}
                        aria-label={`Duplicate ${env.name}`}
                        className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRename(env.id, env.name)}
                        aria-label={`Rename ${env.name}`}
                        className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(env.id, env.name)}
                        aria-label={`Delete ${env.name}`}
                        className="rounded px-1 text-xs text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {selected ? (
              <VariableEditor
                environmentId={selected.id}
                variables={selected.variables}
                onAdd={() => addVariable(selected.id)}
                onUpdate={(variableId, patch) => updateVariable(selected.id, variableId, patch)}
                onRemove={(variableId) => removeVariable(selected.id, variableId)}
              />
            ) : (
              <p className="text-sm text-neutral-400 dark:text-neutral-600">
                Create an environment to start adding variables.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
