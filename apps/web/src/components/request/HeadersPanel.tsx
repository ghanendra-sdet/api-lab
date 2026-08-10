import { useAppStore } from "../../store/useAppStore";
import { KeyValueEditor } from "../common/KeyValueEditor";
import type { RequestTabState } from "../../types";

export function HeadersPanel({ tab }: { tab: RequestTabState }) {
  const addHeaderRow = useAppStore((s) => s.addHeaderRow);
  const updateHeaderRow = useAppStore((s) => s.updateHeaderRow);
  const removeHeaderRow = useAppStore((s) => s.removeHeaderRow);

  return (
    <div className="p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Headers
      </h3>
      <KeyValueEditor
        label="Headers"
        rows={tab.headers}
        onAdd={() => addHeaderRow(tab.id)}
        onUpdate={(rowId, patch) => updateHeaderRow(tab.id, rowId, patch)}
        onRemove={(rowId) => removeHeaderRow(tab.id, rowId)}
      />
    </div>
  );
}
