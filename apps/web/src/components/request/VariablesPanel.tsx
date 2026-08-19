import { useAppStore } from "../../store/useAppStore";
import { VariableEditor } from "../environments/VariableEditor";
import type { RequestTabState } from "../../types";
import { createId } from "../../lib/id";
import type { Variable } from "@api-lab/environment-engine";

export function VariablesPanel({ tab }: { tab: RequestTabState }) {
  const setTabVariables = useAppStore((s) => s.setTabVariables);
  const variables = tab.variables;

  function handleAdd() {
    const newVar: Variable = {
      id: createId("var"),
      key: "",
      value: "",
      enabled: true,
      secret: false,
    };
    setTabVariables(tab.id, [...variables, newVar]);
  }

  function handleUpdate(
    variableId: string,
    patch: Partial<Pick<Variable, "key" | "value" | "enabled" | "secret">>,
  ) {
    const updated = variables.map((v) =>
      v.id === variableId ? { ...v, ...patch } : v,
    );
    setTabVariables(tab.id, updated);
  }

  function handleRemove(variableId: string) {
    const filtered = variables.filter((v) => v.id !== variableId);
    setTabVariables(tab.id, filtered);
  }

  return (
    <div className="p-4" data-testid="variables-panel">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Local Variables
      </h3>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        These variables are local to this request. They override Environment, Collection, Folder, and Global variables with the same name.
      </p>
      <VariableEditor
        environmentId=""
        variables={variables}
        onAdd={handleAdd}
        onUpdate={handleUpdate}
        onRemove={handleRemove}
      />
    </div>
  );
}
