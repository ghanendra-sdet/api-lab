import { useMemo, useRef, useState } from "react";
import type { Collection } from "@api-lab/workspace-engine";
import { parseDataset } from "@api-lab/runner-engine";
import { useAppStore } from "../../store/useAppStore";
import {
  flattenCollectionRequests,
  summarizeRunner,
  summarizeRunnerContract,
  summarizeRunnerCategories,
  type RunnerItemStatus,
} from "../../lib/runner";
import { ContractViolationList } from "../contract/ContractViolationList";
import { findSpecificationForCollection, useContractStore } from "../../store/useContractStore";

interface RunnerDialogProps {
  collection: Collection;
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

export function RunnerDialog({ collection, onClose }: RunnerDialogProps) {
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
  const contracts = useContractStore((s) => s.contracts);
  const startRunner = useAppStore((s) => s.startRunner);
  const cancelRunner = useAppStore((s) => s.cancelRunner);
  const resetRunner = useAppStore((s) => s.resetRunner);

  const requests = useMemo(() => flattenCollectionRequests(collection), [collection]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(requests.map((r) => r.id)));
  const [environmentId, setEnvironmentId] = useState<string>("");
  const [stopOnFailure, setStopOnFailure] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isRunning = runnerState.status === "running";
  const hasResults = runnerState.status === "completed" || runnerState.status === "cancelled";
  const summary = summarizeRunner(runnerState);
  const contractSummary = summarizeRunnerContract(runnerState);
  const categorySummary = summarizeRunnerCategories(runnerState, runnerSecurityResults);
  const boundSpecification = findSpecificationForCollection(contracts, collection.id);

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
    void startRunner(collection.id, [...selected], environmentId || null, stopOnFailure);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button type="button" aria-label="Close dialog" onClick={handleClose} className="absolute inset-0 bg-black/30" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Collection Runner"
        className="relative flex h-[36rem] w-[36rem] max-w-[92vw] flex-col rounded-md bg-white shadow-lg dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            Run Collection — {collection.name}
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
          {runnerState.status === "idle" && (
            <>
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

          {runnerState.status !== "idle" && (
            <div>
              <div className="mb-3 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
                <p className="font-medium text-neutral-800 dark:text-neutral-100">
                  {runnerState.status === "running" ? "Running…" : runnerState.status === "cancelled" ? "Cancelled" : "Run complete"}
                </p>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Passed: {summary.passed} · Failed: {summary.failed} · Errors: {summary.errors} · Skipped: {summary.skipped} · Total:{" "}
                  {summary.total}
                  {runnerState.durationMs !== undefined && ` · Duration: ${(runnerState.durationMs / 1000).toFixed(1)}s`}
                </p>
                {runnerState.validateContract && (
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

              {runnerState.iterations.map((iteration) => {
                const showIterationHeader = runnerState.iterations.length > 1;
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
          {runnerState.status === "idle" && (
            <button
              type="button"
              onClick={handleStart}
              disabled={selected.size === 0}
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
        </div>
      </div>
    </div>
  );
}
