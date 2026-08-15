import Editor from "@monaco-editor/react";
import { BODY_MODES, BODY_RAW_FORMATS, type BodyMode, type BodyRawFormat } from "@api-lab/shared";
import { useAppStore } from "../../store/useAppStore";
import type { RequestTabState } from "../../types";

// KNOWN LIMITATION: @monaco-editor/react's default loader fetches Monaco's
// assets from a CDN (jsdelivr) at runtime instead of the bundled npm package.
// That's inconsistent with API Lab's zero-install/self-contained goal and adds
// an unreviewed third-party runtime dependency. Tracked as a fix-before-relying-
// on-it item: self-host the Monaco assets (vs/) and point the loader at them
// locally, rather than solving asset bundling inside this UI-shell milestone.

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

export function BodyPanel({ tab }: { tab: RequestTabState }) {
  const setBodyMode = useAppStore((s) => s.setBodyMode);
  const setBodyRawFormat = useAppStore((s) => s.setBodyRawFormat);
  const setBodyRawContent = useAppStore((s) => s.setBodyRawContent);
  const theme = useAppStore((s) => s.theme);

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
          <select
            aria-label="Raw body format"
            value={tab.bodyRawFormat}
            onChange={(e) => setBodyRawFormat(tab.id, e.target.value as BodyRawFormat)}
            className="ml-auto rounded border border-neutral-200 bg-white px-2 py-1 text-sm hover:border-neutral-300 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
          >
            {BODY_RAW_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      {tab.bodyMode === "none" && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          This request does not have a body.
        </p>
      )}

      {(tab.bodyMode === "form-data" || tab.bodyMode === "x-www-form-urlencoded") && (
        <p className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {BODY_MODE_LABELS[tab.bodyMode]} body editing is planned for a future release. As a
          workaround, switch to <strong>raw</strong> mode and set the{" "}
          <code className="font-mono">Content-Type</code> header manually.
        </p>
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
