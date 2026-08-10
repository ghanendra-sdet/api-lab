import Editor from "@monaco-editor/react";
import type { ApiResponseResult } from "@api-lab/request-engine";
import { useAppStore } from "../../store/useAppStore";
import type { ResponseViewMode } from "./ResponseTabs";

interface ResponseBodyProps {
  response: ApiResponseResult;
  viewMode: ResponseViewMode;
}

export function ResponseBody({ response, viewMode }: ResponseBodyProps) {
  const theme = useAppStore((s) => s.theme);

  if (response.bodyKind === "empty") {
    return (
      <p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">No response body.</p>
    );
  }

  // HTML responses are never rendered as HTML anywhere in the app — treated
  // as untrusted content, always shown as inert text. See docs/SECURITY.md.
  if (response.bodyKind === "html" && viewMode === "preview") {
    return (
      <div className="p-4">
        <p className="mb-3 rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          HTML preview rendering is disabled for security — response content is untrusted and is
          always shown as text, never executed as markup.
        </p>
        <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-sm text-neutral-800 dark:text-neutral-100">
          {response.rawBody}
        </pre>
      </div>
    );
  }

  if (viewMode === "raw" || response.bodyKind !== "json") {
    return (
      <pre className="overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-sm text-neutral-800 dark:text-neutral-100">
        {response.rawBody}
      </pre>
    );
  }

  const pretty = JSON.stringify(response.body, null, 2);

  return (
    <div className="h-full min-h-[220px]">
      <Editor
        height="100%"
        language="json"
        value={pretty}
        theme={theme === "dark" ? "vs-dark" : "light"}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, monospace",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
        }}
      />
    </div>
  );
}
