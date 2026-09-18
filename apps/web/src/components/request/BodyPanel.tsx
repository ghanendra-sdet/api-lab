import Editor from "@monaco-editor/react";
import { BODY_MODES, BODY_RAW_FORMATS, type BodyMode, type BodyRawFormat, type KeyValueRow } from "@api-lab/shared";
import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";
import { KeyValueEditor } from "../common/KeyValueEditor";
import { FormDataEditor } from "./FormDataEditor";

const BODY_MODE_LABELS: Record<BodyMode, string> = {
  none: "none",
  "form-data": "form-data",
  "x-www-form-urlencoded": "x-www-form-urlencoded",
  raw: "raw",
};

const MONACO_LANGUAGE: Record<BodyRawFormat, string> = {
  JSON: "json",
  Text: "plaintext",
  XML: "xml",
  HTML: "html",
};

function beautifyContent(content: string, format: BodyRawFormat): string {
  if (format === "JSON") {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }
  if (format === "XML" || format === "HTML") {
    let formatted = "";
    const reg = /(>)(<)(\/*)/g;
    const html = content.replace(reg, "$1\r\n$2$3");
    let pad = 0;
    html.split("\r\n").forEach((line) => {
      let indent = 0;
      if (line.match(/.+<\/\w[^>]*>$/)) {
        indent = 0;
      } else if (line.match(/^<\/\w/)) {
        if (pad !== 0) {
          pad -= 1;
        }
      } else if (line.match(/^<\w[^>]*[^/]>.*$/)) {
        indent = 1;
      } else {
        indent = 0;
      }
      formatted += "  ".repeat(pad) + line + "\r\n";
      pad += indent;
    });
    return formatted.trim();
  }
  return content;
}

export function BodyPanel({ tab }: { tab: RequestTabState }) {
  const setBodyMode = useAppStore((s) => s.setBodyMode);
  const setBodyRawFormat = useAppStore((s) => s.setBodyRawFormat);
  const setBodyRawContent = useAppStore((s) => s.setBodyRawContent);
  const theme = useAppStore((s) => s.theme);

  const addBodyFormDataRow = useAppStore((s) => s.addBodyFormDataRow);
  const updateBodyFormDataRow = useAppStore((s) => s.updateBodyFormDataRow);
  const removeBodyFormDataRow = useAppStore((s) => s.removeBodyFormDataRow);
  const addBodyUrlencodedRow = useAppStore((s) => s.addBodyUrlencodedRow);
  const updateBodyUrlencodedRow = useAppStore((s) => s.updateBodyUrlencodedRow);
  const removeBodyUrlencodedRow = useAppStore((s) => s.removeBodyUrlencodedRow);

  const handleBeautify = () => {
    const formatted = beautifyContent(tab.bodyRawContent, tab.bodyRawFormat);
    setBodyRawContent(tab.id, formatted);
  };

  return (
    <div className="flex h-full flex-col p-4">
      <fieldset className="mb-3 flex flex-wrap items-center gap-4">
        <legend className="sr-only">Body type</legend>
        {BODY_MODES.map((mode) => (
          <label key={mode} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="body-mode"
              value={mode}
              checked={tab.bodyMode === mode}
              onChange={() => setBodyMode(tab.id, mode)}
              className="h-3.5 w-3.5 text-blue-600"
            />
            {BODY_MODE_LABELS[mode]}
          </label>
        ))}

        {tab.bodyMode === "raw" && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleBeautify}
              className="rounded border border-neutral-200 bg-white px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Beautify
            </button>
            <select
              aria-label="Raw body format"
              value={tab.bodyRawFormat}
              onChange={(e) => setBodyRawFormat(tab.id, e.target.value as BodyRawFormat)}
              className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm hover:border-neutral-300 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
            >
              {BODY_RAW_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      {tab.bodyMode === "none" && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          This request does not have a body.
        </p>
      )}

      {tab.bodyMode === "form-data" && (
        <FormDataEditor
          label="Form-data parameters"
          rows={tab.bodyFormData || []}
          onAdd={() => addBodyFormDataRow(tab.id)}
          onUpdate={(rowId, patch) => updateBodyFormDataRow(tab.id, rowId, patch)}
          onRemove={(rowId) => removeBodyFormDataRow(tab.id, rowId)}
        />
      )}

      {tab.bodyMode === "x-www-form-urlencoded" && (
        <KeyValueEditor
          label="URL-encoded parameters"
          rows={tab.bodyUrlencoded as KeyValueRow[]}
          showDescription={false}
          onAdd={() => addBodyUrlencodedRow(tab.id)}
          onUpdate={(rowId, patch) => updateBodyUrlencodedRow(tab.id, rowId, patch)}
          onRemove={(rowId) => removeBodyUrlencodedRow(tab.id, rowId)}
        />
      )}

      {tab.bodyMode === "raw" && (
        <div className="min-h-[220px] flex-1 overflow-hidden rounded border border-neutral-200 dark:border-neutral-800">
          <Editor
            height="100%"
            language={MONACO_LANGUAGE[tab.bodyRawFormat]}
            value={tab.bodyRawContent}
            onChange={(value) => setBodyRawContent(tab.id, value ?? "")}
            theme={theme === "dark" ? "vs-dark" : "light"}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, monospace",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              automaticLayout: true,
            }}
          />
        </div>
      )}
    </div>
  );
}
