import { useRef, useState } from "react";
import { parseImportFile, type NormalizedImport, type ParseResult } from "@api-lab/collection-format";
import { MAX_IMPORT_FILE_SIZE_BYTES } from "@api-lab/collection-format";
import { useAppStore } from "../../store/useAppStore";
import { Dialog } from "../common/Dialog";

interface ImportDialogProps {
  onClose: () => void;
}

type DialogState =
  | { step: "pick" }
  | { step: "error"; detail: string }
  | { step: "preview"; data: NormalizedImport };

function countRequests(items: { type: "folder" | "request"; items?: unknown[] }[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type === "request") count += 1;
    else count += (item.items as unknown[]).length;
  }
  return count;
}

function countFolders(items: { type: "folder" | "request" }[]): number {
  return items.filter((i) => i.type === "folder").length;
}

/** File → parse → preview → confirm. The workspace is never touched until
 * the user explicitly clicks Import — see docs/ARCHITECTURE.md's
 * Milestone 6 section on the import preview requirement. */
export function ImportDialog({ onClose }: ImportDialogProps) {
  const importCollection = useAppStore((s) => s.importCollection);
  const importEnvironment = useAppStore((s) => s.importEnvironment);
  const importNativeWorkspace = useAppStore((s) => s.importNativeWorkspace);
  const [state, setState] = useState<DialogState>({ step: "pick" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      setState({ step: "error", detail: `File is larger than the ${(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)}MB import limit.` });
      return;
    }
    const text = await file.text();
    const result: ParseResult = parseImportFile(text);
    if (!result.ok) {
      setState({ step: "error", detail: result.detail });
      return;
    }
    setState({ step: "preview", data: result.data });
  }

  function handleConfirm() {
    if (state.step !== "preview") return;
    if (state.data.kind === "collection") importCollection(state.data);
    else if (state.data.kind === "environment") importEnvironment(state.data);
    else importNativeWorkspace(state.data);
    onClose();
  }

  return (
    <Dialog
      onClose={onClose}
      titleId="import-dialog-title"
      className="w-[30rem] max-w-[92vw] p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="import-dialog-title" className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Import</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import dialog"
            className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        {state.step === "pick" && (
          <div>
            <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
              Select a Postman Collection, Postman Environment, OpenAPI 3.x document, or an API Lab workspace export
              (<code className="font-mono">.json</code>).
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              aria-label="Choose file to import"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
              className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 dark:text-neutral-300 dark:file:bg-blue-950 dark:file:text-blue-300"
            />
          </div>
        )}

        {state.step === "error" && (
          <div>
            <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {state.detail}
            </p>
            <button
              type="button"
              onClick={() => setState({ step: "pick" })}
              className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Choose a different file
            </button>
          </div>
        )}

        {state.step === "preview" && (
          <div>
            <ImportPreview data={state.data} />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Import
              </button>
            </div>
          </div>
        )}
    </Dialog>
  );
}

function ImportPreview({ data }: { data: NormalizedImport }) {
  if (data.kind === "collection") {
    const folders = countFolders(data.items);
    const requests = countRequests(data.items);
    return (
      <div className="text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Collection
        </p>
        <p className="mb-3 font-medium text-neutral-800 dark:text-neutral-100">{data.name}</p>
        <dl className="mb-3 grid grid-cols-2 gap-1 text-neutral-600 dark:text-neutral-300">
          <dt>Folders</dt>
          <dd>{folders}</dd>
          <dt>Requests</dt>
          <dd>{requests}</dd>
        </dl>
        <Warnings warnings={data.warnings} />
      </div>
    );
  }

  if (data.kind === "environment") {
    return (
      <div className="text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Environment
        </p>
        <p className="mb-3 font-medium text-neutral-800 dark:text-neutral-100">{data.name}</p>
        <p className="mb-3 text-neutral-600 dark:text-neutral-300">{data.variables.length} variables</p>
        <Warnings warnings={data.warnings} />
      </div>
    );
  }

  return (
    <div className="text-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        API Lab Workspace
      </p>
      <dl className="mb-3 grid grid-cols-2 gap-1 text-neutral-600 dark:text-neutral-300">
        <dt>Collections</dt>
        <dd>{data.collections.length}</dd>
        <dt>Environments</dt>
        <dd>{data.environments.length}</dd>
      </dl>
      <Warnings warnings={[...data.warnings, ...data.collections.flatMap((c) => c.warnings)]} />
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <p className="mb-1 font-medium">
        {warnings.length} warning{warnings.length > 1 ? "s" : ""}
      </p>
      <ul className="list-inside list-disc space-y-0.5">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
