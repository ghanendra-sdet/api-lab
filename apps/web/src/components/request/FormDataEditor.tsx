import type { FormDataField } from "@api-lab/shared";

interface FormDataEditorProps {
  label: string;
  rows: FormDataField[];
  onAdd: () => void;
  onUpdate: (rowId: string, patch: Partial<FormDataField>) => void;
  onRemove: (rowId: string) => void;
}

export function FormDataEditor({
  label,
  rows,
  onAdd,
  onUpdate,
  onRemove,
}: FormDataEditorProps) {
  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <th scope="col" className="w-8 py-1.5 pr-2 font-medium"></th>
            <th scope="col" className="w-1/4 py-1.5 pr-2 font-medium">
              Key
            </th>
            <th scope="col" className="w-24 py-1.5 pr-2 font-medium">
              Type
            </th>
            <th scope="col" className="py-1.5 pr-2 font-medium">
              Value / Metadata
            </th>
            <th scope="col" className="py-1.5 pr-2 font-medium">
              Description
            </th>
            <th scope="col" className="w-8 py-1.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-1 pr-2">
                <input
                  type="checkbox"
                  checked={row.enabled !== false}
                  onChange={(e) => onUpdate(row.id!, { enabled: e.target.checked })}
                  aria-label={`Enable row ${row.key || "(empty key)"}`}
                  className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-neutral-700"
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => onUpdate(row.id!, { key: e.target.value })}
                  placeholder="key"
                  aria-label="Key"
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                />
              </td>
              <td className="py-1 pr-2">
                <select
                  value={row.type}
                  onChange={(e) => {
                    const nextType = e.target.value as "text" | "file";
                    if (nextType === "text") {
                      onUpdate(row.id!, { type: "text", value: "" });
                    } else {
                      onUpdate(row.id!, {
                        type: "file",
                        file: { name: "", reference: "" },
                      });
                    }
                  }}
                  aria-label="Field Type"
                  className="w-full rounded border border-neutral-200 bg-white px-1 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              </td>
              <td className="py-1 pr-2">
                {row.type === "text" ? (
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => onUpdate(row.id!, { value: e.target.value })}
                    placeholder="value"
                    aria-label="Value"
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                  />
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={row.file.name}
                      onChange={(e) =>
                        onUpdate(row.id!, {
                          type: "file",
                          file: { ...row.file, name: e.target.value },
                        })
                      }
                      placeholder="file name"
                      aria-label="File Name"
                      className="w-1/2 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                    />
                    <input
                      type="text"
                      value={row.file.reference || ""}
                      onChange={(e) =>
                        onUpdate(row.id!, {
                          type: "file",
                          file: { ...row.file, reference: e.target.value },
                        })
                      }
                      placeholder="reference ID"
                      aria-label="File Reference"
                      className="w-1/2 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-neutral-200 focus-visible:border-transparent dark:hover:border-neutral-800"
                    />
                  </div>
                )}
              </td>
              <td className="py-1 pr-2">
                <input
                  type="text"
                  value={row.description ?? ""}
                  onChange={(e) => onUpdate(row.id!, { description: e.target.value })}
                  placeholder="description"
                  aria-label="Description"
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-neutral-500 hover:border-neutral-200 focus-visible:border-transparent dark:text-neutral-400 dark:hover:border-neutral-800"
                />
              </td>
              <td className="py-1 text-right">
                <button
                  type="button"
                  onClick={() => onRemove(row.id!)}
                  aria-label={`Delete row ${row.key || "(empty key)"}`}
                  className="rounded px-1.5 py-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 rounded px-2 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
      >
        + Add row
      </button>
    </div>
  );
}
