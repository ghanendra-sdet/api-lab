import { useAppStore } from "../../store/useAppStore";
import { VariableEditor } from "../environments/VariableEditor";
import { Dialog } from "../common/Dialog";

interface GlobalVariablesManagerProps {
  onClose: () => void;
}

/** A single-pane global-variables dialog, mirroring EnvironmentManager's
 * dialog shell / error-banner conventions but without the left-hand list —
 * there is only one global variable set, not multiple named ones. */
export function GlobalVariablesManager({ onClose }: GlobalVariablesManagerProps) {
  const globals = useAppStore((s) => s.globals);
  const globalsLoadError = useAppStore((s) => s.globalsLoadError);
  const resetGlobals = useAppStore((s) => s.resetGlobals);
  const addGlobalVariable = useAppStore((s) => s.addGlobalVariable);
  const updateGlobalVariable = useAppStore((s) => s.updateGlobalVariable);
  const removeGlobalVariable = useAppStore((s) => s.removeGlobalVariable);

  return (
    <Dialog
      onClose={onClose}
      ariaLabel="Manage global variables"
      titleId="globals-manager-title"
      className="w-[42rem] max-w-[92vw]"
    >
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 id="globals-manager-title" className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            Global Variables
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close global variables manager"
            className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        {globalsLoadError && (
          <div
            role="alert"
            className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          >
            <p className="mb-1 font-medium">Saved global variables couldn't be loaded.</p>
            <p className="mb-2 text-amber-700 dark:text-amber-400">{globalsLoadError}</p>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Reset local global variables? This discards the unreadable saved data and starts fresh.",
                  )
                ) {
                  resetGlobals();
                }
              }}
              className="rounded border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
            >
              Reset Local Global Variables
            </button>
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <VariableEditor
            environmentId="global"
            variables={globals}
            onAdd={addGlobalVariable}
            onUpdate={updateGlobalVariable}
            onRemove={removeGlobalVariable}
          />
        </div>
      </div>
    </Dialog>
  );
}
