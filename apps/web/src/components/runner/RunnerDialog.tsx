import { useMemo, useRef, useState } from "react";
import { isFolder, type Collection } from "@api-lab/workspace-engine";
import { parseDataset } from "@api-lab/runner-engine";
import { useAppStore } from "../../store/useAppStore";
import type { RunnerRunHistoryItem } from "../../types";
import { flattenCollectionRequests, summarizeRunner, summarizeRunnerContract, summarizeRunnerCategories, type RunnerItemStatus, type RunnerState } from "../../lib/runner";
import { ContractViolationList } from "../contract/ContractViolationList";
import { findSpecificationForCollection, useContractStore } from "../../store/useContractStore";
import { Dialog } from "../common/Dialog";

interface RunnerDialogProps {
  collection: Collection;
  folderId?: string;
  onClose: () => void;
}

const STATUS_LABEL: Record<RunnerItemStatus, string> = {
  pending: "Pending",
  running: "Running…",
  passed: "Passed",
  failed: "Failed",
  error: "Error",
  "contract-failed": "Contract Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<RunnerItemStatus, string> = {
  pending: "text-neutral-400 dark:text-neutral-600",
  running: "text-blue-600 dark:text-blue-400",
  passed: "text-green-700 dark:text-green-400",
  failed: "text-red-700 dark:text-red-400",
  error: "text-red-700 dark:text-red-400",
  "contract-failed": "text-red-700 dark:text-red-400",
  skipped: "text-neutral-400 dark:text-neutral-600",
  cancelled: "text-amber-700 dark:text-amber-400",
};

function statusIcon(status: RunnerItemStatus): string {
  if (status === "passed") return "✓";
  if (status === "failed" || status === "error" || status === "contract-failed") return "✗";
  if (status === "running") return "…";
  return "○";
}

export function RunnerDialog({ collection, folderId, onClose }: RunnerDialogProps) {
  const environments = useAppStore((s) => s.environments.environments);
  const runnerState = useAppStore((s) => s.runnerState);
  const runnerDataset = useAppStore((s) => s.runnerDataset);
  const runnerDatasetName = useAppStore((s) => s.runnerDatasetName);
  const setRunnerDataset = useAppStore((s) => s.setRunnerDataset);
  const runnerValidateContract = useAppStore((s) => s.runnerValidateContract);
  const runnerIncludeSecurity = useAppStore((s) => s.runnerIncludeSecurity);
  const setRunnerIncludeSecurity = useAppStore((s) => s.setRunnerIncludeSecurity);
  const runnerSecurityResults = useAppStore((s) => s.runnerSecurityResults);
  const setRunnerValidateContract = useAppStore((s) => s.setRunnerValidateContract);
  const runnerDelayMs = useAppStore((s) => s.runnerDelayMs);
  const setRunnerDelayMs = useAppStore((s) => s.setRunnerDelayMs);
  const runnerIterations = useAppStore((s) => s.runnerIterations);
  const setRunnerIterations = useAppStore((s) => s.setRunnerIterations);
  const contracts = useContractStore((s) => s.contracts);
  const startRunner = useAppStore((s) => s.startRunner);
  const cancelRunner = useAppStore((s) => s.cancelRunner);
  const resetRunner = useAppStore((s) => s.resetRunner);
  const runnerHistory = useAppStore((s) => s.runnerHistory);
  const removeRunnerHistoryEntry = useAppStore((s) => s.removeRunnerHistoryEntry);
  const clearRunnerHistory = useAppStore((s) => s.clearRunnerHistory);

  const folder = useMemo(() => {
    if (!folderId) return null;
    return collection.items.find((item) => isFolder(item) && item.id === folderId);
  }, [collection, folderId]);

  const requests = useMemo(() => {
    const all = flattenCollectionRequests(collection);
    if (folderId) {
      return all.filter((r) => r.location.folderId === folderId);
    }
    return all;
  }, [collection, folderId]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(requests.map((r) => r.id)));
  const [environmentId, setEnvironmentId] = useState<string>("");
  const [stopOnFailure, setStopOnFailure] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [iterationsInput, setIterationsInput] = useState(() => runnerIterations.toString());

  const iterationsVal = parseInt(iterationsInput, 10);
  const isIterationsValid = !!runnerDataset || (/^\d+$/.test(iterationsInput) && iterationsVal > 0);

  const [activeTab, setActiveTab] = useState<"settings" | "history">("settings");
  const [viewingHistoryItem, setViewingHistoryItem] = useState<RunnerRunHistoryItem | null>(null);

  const activeRunnerState: RunnerState = useMemo(() => {
    if (viewingHistoryItem) {
      return {
        status: viewingHistoryItem.overallStatus === "cancelled" ? "cancelled" as const : "completed" as const,
        collectionId: viewingHistoryItem.collectionId,
        folderId: viewingHistoryItem.folderId,
        environmentId: viewingHistoryItem.environmentId,
        stopOnFailure: viewingHistoryItem.stopOnFailure,
        datasetName: viewingHistoryItem.datasetName,
        validateContract: viewingHistoryItem.iterations.some((i) => i.items.some((it) => !!it.contractResult)),
        iterations: viewingHistoryItem.iterations as unknown as RunnerState["iterations"],
        durationMs: viewingHistoryItem.durationMs,
        startedAt: viewingHistoryItem.startedAt,
      } as unknown as RunnerState;
    }
    return runnerState;
  }, [runnerState, viewingHistoryItem]);

  const isRunning = activeRunnerState.status === "running";
  const hasResults = activeRunnerState.status === "completed" || activeRunnerState.status === "cancelled";
  const summary = summarizeRunner(activeRunnerState);
  const contractSummary = summarizeRunnerContract(activeRunnerState);
  const categorySummary = summarizeRunnerCategories(activeRunnerState, runnerSecurityResults);
  const boundSpecification = findSpecificationForCollection(contracts, collection.id);

  const filteredHistory = useMemo(() => {
    return runnerHistory.filter(
      (run) =>
        run.collectionId === collection.id &&
        (folderId ? run.folderId === folderId : run.folderId === null)
    );
  }, [runnerHistory, collection.id, folderId]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleStart() {
    resetRunner();
    if (!runnerDataset && isIterationsValid) {
      setRunnerIterations(iterationsVal);
    }
    void startRunner(collection.id, [...selected], environmentId || null, stopOnFailure, folderId);
  }

  function handleClose() {
    if (isRunning) cancelRunner();
    onClose();
  }

  async function handleDatasetFile(file: File) {
    setDatasetError(null);
    const text = await file.text();
    const result = parseDataset(file.name, text);
    if (!result.ok) {
      setDatasetError(result.detail);
      return;
    }
    setRunnerDataset(result.data, file.name);
  }

  function handleClearDataset() {
    setRunnerDataset(null, null);
    setDatasetError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Dialog
      onClose={handleClose}
      ariaLabel="Collection Runner"
      titleId="runner-dialog-title"
      className="w-[36rem] max-w-[92vw] p-4"
    >
      <div className="relative flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 id="runner-dialog-title" className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            {folder ? `Run Folder — ${folder.name}` : `Run Collection — ${collection.name}`}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close runner"
            className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {viewingHistoryItem && (
            <div className="mb-3 flex items-center justify-between border-b border-neutral-100 pb-2 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setViewingHistoryItem(null)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 dark:text-blue-400 dark:hover:text-blue-300"
              >
                ← Back to History
              </button>
              <span className="text-xs text-neutral-500">
                Viewing Historical Run
              </span>
            </div>
          )}

          {runnerState.status === "idle" && !viewingHistoryItem && (
            <div className="mb-4 flex gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab("settings")}
                className={`text-xs font-semibold px-3 py-1.5 rounded transition ${
                  activeTab === "settings"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                    : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                Configure Run
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("history")}
                className={`text-xs font-semibold px-3 py-1.5 rounded transition ${
                  activeTab === "history"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                    : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                Run History
              </button>
            </div>
          )}

          {runnerState.status === "idle" && !viewingHistoryItem && activeTab === "settings" && (
            <>
              <div className="mb-3 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                Scope: {folder ? `Folder — ${folder.name}` : "Collection"}
              </div>
              <label
                htmlFor="runner-environment"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                Environment
              </label>
              <select
                id="runner-environment"
                value={environmentId}
                onChange={(e) => setEnvironmentId(e.target.value)}
                className="mb-3 w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="">No Environment</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>

              <label
                htmlFor="runner-delay"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                Delay (ms)
              </label>
              <input
                id="runner-delay"
                type="number"
                min="0"
                step="1"
                value={runnerDelayMs}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setRunnerDelayMs(isNaN(val) ? 0 : Math.max(0, val));
                }}
                className="mb-3 w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />

              <label
                htmlFor="runner-iterations"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                Iterations
              </label>
              <input
                id="runner-iterations"
                type="number"
                min="1"
                step="1"
                disabled={!!runnerDataset}
                value={runnerDataset ? runnerDataset.rows.length : iterationsInput}
                onChange={(e) => setIterationsInput(e.target.value)}
                className="mb-1 w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm disabled:bg-neutral-100 disabled:text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:disabled:bg-neutral-800"
              />
              {!isIterationsValid && (
                <p id="runner-iterations-error" className="mb-3 text-[11px] text-red-600 dark:text-red-400">
                  Iterations must be a positive integer.
                </p>
              )}
              {isIterationsValid && runnerDataset && (
                <p className="mb-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Dataset active: iterations determined by dataset row count ({runnerDataset.rows.length}).
                </p>
              )}
              {isIterationsValid && !runnerDataset && (
                <p className="mb-3 text-[11px] text-neutral-400 dark:text-neutral-500">
                  Configure the number of execution iterations.
                </p>
              )}

              <label className="mb-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={stopOnFailure}
                  onChange={(e) => setStopOnFailure(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300 text-blue-600 dark:border-neutral-700"
                />
                Stop on failure
              </label>

              {/* Contract validation for the run (spec §29). Only offered
                  when this collection actually has a specification bound to
                  it — an unbound collection has nothing to validate against. */}
              <label className="mb-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={runnerValidateContract}
                  disabled={!boundSpecification}
                  onChange={(e) => setRunnerValidateContract(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300 text-blue-600 disabled:opacity-50 dark:border-neutral-700"
                />
                Validate contract after response
                {boundSpecification ? (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">({boundSpecification.name})</span>
                ) : (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    (bind a specification to this collection first)
                  </span>
                )}
              </label>

              {/* Security pass (Milestone 12, spec §32). Off by default: it
                  sends additional, deliberately malformed requests, which must
                  never be something enabled by accident. Runs after the
                  functional pass, with its results counted separately. */}
              <label className="mb-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={runnerIncludeSecurity}
                  onChange={(e) => setRunnerIncludeSecurity(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300 text-blue-600 dark:border-neutral-700"
                />
                Run generated security tests after the collection
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  (generate them in the Security dialog first)
                </span>
              </label>

              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Dataset (optional)
              </p>
              {runnerDataset ? (
                <div className="mb-3 flex items-center justify-between rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700">
                  <span className="text-neutral-700 dark:text-neutral-300">
                    {runnerDatasetName} — {runnerDataset.rows.length} row{runnerDataset.rows.length === 1 ? "" : "s"},{" "}
                    {runnerDataset.columns.length} column{runnerDataset.columns.length === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    onClick={handleClearDataset}
                    className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <div className="mb-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.csv,application/json,text/csv"
                    aria-label="Import dataset"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleDatasetFile(file);
                    }}
                    className="block w-full text-sm text-neutral-600 dark:text-neutral-300"
                  />
                  {datasetError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{datasetError}</p>}
                </div>
              )}

              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Requests ({selected.size}/{requests.length})
              </p>
              {requests.length === 0 ? (
                <p className="text-sm text-neutral-400 dark:text-neutral-600">This collection has no requests to run.</p>
              ) : (
                <ul className="space-y-1">
                  {requests.map((r) => (
                    <li key={r.id}>
                      <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelected(r.id)}
                          className="h-4 w-4 rounded border-neutral-300 text-blue-600 dark:border-neutral-700"
                        />
                        {r.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {runnerState.status === "idle" && !viewingHistoryItem && activeTab === "history" && (
            <div className="space-y-2">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-neutral-500">
                  Previous Runs ({filteredHistory.length})
                </span>
                {filteredHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Are you sure you want to clear all history for this scope?")) {
                        clearRunnerHistory(collection.id, folderId);
                      }
                    }}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold"
                  >
                    Clear History
                  </button>
                )}
              </div>
              {filteredHistory.length === 0 ? (
                <p className="text-sm text-neutral-500 italic p-4 text-center">
                  No previous runs found for this scope.
                </p>
              ) : (
                <ul className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {filteredHistory.map((run) => (
                    <li
                      key={run.id}
                      className="flex items-center justify-between p-2 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <button
                        type="button"
                        onClick={() => setViewingHistoryItem(run)}
                        className="flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            run.overallStatus === "passed"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : run.overallStatus === "failed"
                                ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                          }`}>
                            {run.overallStatus.toUpperCase()}
                          </span>
                          <span className="text-[11px] text-neutral-500">
                            {new Date(run.startedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-600 dark:text-neutral-400 mt-1">
                          {run.folderId ? `Folder: ${run.folderName}` : "Collection Run"} ·{" "}
                          {run.iterationCount} Iteration{run.iterationCount === 1 ? "" : "s"} ·{" "}
                          {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
                        </div>
                        <div className="text-[10px] text-neutral-500 dark:text-neutral-500">
                          Passed: {run.passedCount} · Failed: {run.failedCount} · Skipped: {run.skippedCount}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm("Delete this history entry?")) {
                            removeRunnerHistoryEntry(run.id);
                          }
                        }}
                        aria-label={`Delete run from ${new Date(run.startedAt).toLocaleString()}`}
                        className="p-1 rounded text-neutral-400 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800"
                      >
                        🗑
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {(activeRunnerState.status !== "idle") && (
            <div>
              <div
                role="status"
                aria-live="polite"
                className="mb-3 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800"
              >
                <p className="font-medium text-neutral-800 dark:text-neutral-100">
                  {activeRunnerState.status === "running" ? "Running…" : activeRunnerState.status === "cancelled" ? "Cancelled" : "Run complete"}
                </p>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Passed: {summary.passed} · Failed: {summary.failed} · Errors: {summary.errors} · Skipped: {summary.skipped} · Total:{" "}
                  {summary.total}
                  {activeRunnerState.durationMs !== undefined && ` · Duration: ${(activeRunnerState.durationMs / 1000).toFixed(1)}s`}
                </p>
                {activeRunnerState.validateContract && (
                  <p
                    data-testid="runner-contract-summary"
                    className="mt-1 border-t border-neutral-100 pt-1 text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
                  >
                    Contract — Passed: {contractSummary.passed} · Failed: {contractSummary.failed} · Warnings:{" "}
                    {contractSummary.warnings}
                  </p>
                )}
                {/* Per-category counts (spec §22, §32). Never summed into a
                    headline number — the sum would be the least informative
                    figure available. */}
                <p
                  data-testid="runner-category-summary"
                  className="mt-1 border-t border-neutral-100 pt-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
                >
                  Functional: {categorySummary.functional.passed}/{categorySummary.functional.total} ·{" "}
                  Contract: {categorySummary.contract.passed}/{categorySummary.contract.total} ·{" "}
                  Security: {categorySummary.security.passed}/{categorySummary.security.total} ·{" "}
                  Negative: {categorySummary.negative.passed}/{categorySummary.negative.total}
                </p>
              </div>

              {activeRunnerState.iterations.map((iteration) => {
                const showIterationHeader = activeRunnerState.iterations.length > 1;
                return (
                  <div key={iteration.index} className={showIterationHeader ? "mb-3" : undefined}>
                    {showIterationHeader && (
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                        Iteration {iteration.index + 1}
                        {Object.keys(iteration.data).length > 0 &&
                          ` — ${Object.entries(iteration.data)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(", ")}`}
                      </p>
                    )}
                    <ul className="space-y-1">
                      {iteration.items.map((item) => {
                        const key = `${iteration.index}:${item.requestId}`;
                        return (
                          <li key={key} className="rounded border border-neutral-100 dark:border-neutral-900">
                            <button
                              type="button"
                              onClick={() => setExpandedKey((k) => (k === key ? null : key))}
                              className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm"
                            >
                              <span className={STATUS_CLASS[item.status]}>
                                <span aria-hidden="true">{statusIcon(item.status)}</span> {item.name}
                              </span>
                              <span className={`text-xs ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                            </button>
                            {expandedKey === key && (
                              <div className="border-t border-neutral-100 px-2 py-2 text-xs dark:border-neutral-900">
                                {item.validationError && (
                                  <p className="text-red-600 dark:text-red-400">{item.validationError.message}</p>
                                )}
                                {item.response && (
                                  <p className="text-neutral-600 dark:text-neutral-300">
                                    Status: {item.response.status ?? "—"} · {item.response.duration}ms
                                  </p>
                                )}
                                {item.testResult && item.testResult.assertions.length > 0 && (
                                  <ul className="mt-1 space-y-0.5">
                                    {item.testResult.assertions.map((a, i) => (
                                      <li
                                        key={i}
                                        className={a.passed ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}
                                      >
                                        <span aria-hidden="true">{a.passed ? "✓" : "✗"}</span> {a.message}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {item.contractResult && (
                                  <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-900">
                                    <p
                                      className={`font-semibold ${
                                        item.contractResult.valid
                                          ? "text-green-700 dark:text-green-400"
                                          : "text-red-700 dark:text-red-400"
                                      }`}
                                    >
                                      <span aria-hidden="true">{item.contractResult.valid ? "✓" : "✗"}</span> Contract:{" "}
                                      {item.contractResult.valid ? "PASS" : "FAIL"}
                                      {item.contractResult.operation && (
                                        <span className="ml-1 font-mono font-normal text-neutral-500 dark:text-neutral-400">
                                          {item.contractResult.operation.method} {item.contractResult.operation.path}
                                        </span>
                                      )}
                                    </p>
                                    <ContractViolationList
                                      violations={item.contractResult.requestViolations}
                                      label="Request contract"
                                    />
                                    <ContractViolationList
                                      violations={item.contractResult.responseViolations}
                                      label="Response contract"
                                    />
                                    <ContractViolationList violations={item.contractResult.warnings} label="Warnings" />
                                  </div>
                                )}
                                {item.extractionResults && item.extractionResults.length > 0 && (
                                  <ul className="mt-1 space-y-0.5">
                                    {item.extractionResults.map((r) => (
                                      <li
                                        key={r.extraction.id}
                                        className={r.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}
                                      >
                                        <span aria-hidden="true">{r.ok ? "✓" : "✗"}</span> {r.extraction.variable}
                                        {r.ok ? ` = ${r.value}` : ` — ${r.error}`}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
          {viewingHistoryItem ? (
            <button
              type="button"
              onClick={() => setViewingHistoryItem(null)}
              className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Back to History
            </button>
          ) : (
            <>
              {runnerState.status === "idle" && activeTab === "settings" && (
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={selected.size === 0 || !isIterationsValid}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Start Run
                </button>
              )}
              {isRunning && (
                <button
                  type="button"
                  onClick={cancelRunner}
                  className="rounded bg-neutral-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"
                >
                  Cancel Run
                </button>
              )}
              {hasResults && (
                <button
                  type="button"
                  onClick={resetRunner}
                  className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                >
                  Run Again
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
