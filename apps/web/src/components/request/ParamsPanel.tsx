import { useAppStore } from "../../store/useAppStore";
import { KeyValueEditor } from "../common/KeyValueEditor";
import type { RequestTabState } from "../../types";

export function ParamsPanel({ tab }: { tab: RequestTabState }) {
  const addParamRow = useAppStore((s) => s.addParamRow);
  const updateParamRow = useAppStore((s) => s.updateParamRow);
  const removeParamRow = useAppStore((s) => s.removeParamRow);

  return (
    <div className="p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Query Params
      </h3>
      {tab.params.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No query parameters yet.
        </p>
      ) : null}
      <KeyValueEditor
        label="Query parameters"
        rows={tab.params}
        showDescription
        onAdd={() => addParamRow(tab.id)}
        onUpdate={(rowId, patch) => updateParamRow(tab.id, rowId, patch)}
        onRemove={(rowId) => removeParamRow(tab.id, rowId)}
      />
    </div>
  );
}
