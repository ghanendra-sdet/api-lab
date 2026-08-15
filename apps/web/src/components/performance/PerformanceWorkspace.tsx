import { useEffect, useMemo, useState } from "react";
import {
  COMPARATOR_LABELS,
  ERROR_KIND_LABELS,
  MAX_DURATION_SECONDS,
  MAX_VIRTUAL_USERS,
  METRIC_LABELS,
  METRIC_UNITS,
  PERF_ERROR_KINDS,
  formatReportSummary,
  reportToCsv,
  reportToJson,
  requiresProductionWarning,
  validatePerformanceConfig,
  validateRequestCount,
  validateTotalRequestBudget,
  type PerfRequestSpec,
} from "@api-lab/performance-engine";
import { useAppStore } from "../../store/useAppStore";
import { usePerfStore } from "../../store/usePerfStore";
import { buildPerfSpecs, targetUrls } from "../../lib/perfSpecs";
import { flattenCollectionRequests, type RunnableRequest } from "../../lib/runner";
import { PerfCharts } from "./PerfCharts";
import { Dialog } from "../common/Dialog";

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function downloadFile(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const FIELD_CLASS =
  "w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";
const LABEL_CLASS = "mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400";

export function PerformanceWorkspace() {
  const collections = useAppStore((s) => s.workspace.collections);
  const environments = useAppStore((s) => s.environments.environments);

  const config = usePerfStore((s) => s.config);
  const setConfig = usePerfStore((s) => s.setConfig);
  const runStatus = usePerfStore((s) => s.runStatus);
  const live = usePerfStore((s) => s.live);
  const snapshot = usePerfStore((s) => s.snapshot);
  const report = usePerfStore((s) => s.report);
  const runError = usePerfStore((s) => s.runError);
  const workerStatus = usePerfStore((s) => s.workerStatus);
  const workerError = usePerfStore((s) => s.workerError);
  const history = usePerfStore((s) => s.history);
  const refreshWorker = usePerfStore((s) => s.refreshWorker);
  const start = usePerfStore((s) => s.start);
  const stop = usePerfStore((s) => s.stop);
  const reset = usePerfStore((s) => s.reset);

  const [formError, setFormError] = useState<string | null>(null);
  const [pendingWarning, setPendingWarning] = useState<{ specs: PerfRequestSpec[]; targetName: string; hosts: string[] } | null>(
    null,
  );

  useEffect(() => {
    void refreshWorker();
  }, [refreshWorker]);

  /** Flat list of every saved request, so a single endpoint can be
   * benchmarked on its own (spec §11) without building a collection. */
  const allRequests = useMemo(() => {
    const result: Array<RunnableRequest & { collectionName: string }> = [];
    for (const collection of collections) {
      for (const runnable of flattenCollectionRequests(collection)) {
        result.push({ ...runnable, collectionName: collection.name });
      }
    }
    return result;
  }, [collections]);

  const environment = environments.find((env) => env.id === config.environmentId);

  const selectedRequests = useMemo<RunnableRequest[]>(() => {
    if (config.targetKind === "collection") {
      const collection = collections.find((c) => c.id === config.targetId);
      return collection ? flattenCollectionRequests(collection) : [];
    }
    const request = allRequests.find((r) => r.id === config.targetId);
    return request ? [request] : [];
  }, [config.targetKind, config.targetId, collections, allRequests]);

  const targetName =
    config.targetKind === "collection"
      ? (collections.find((c) => c.id === config.targetId)?.name ?? "Collection")
      : (allRequests.find((r) => r.id === config.targetId)?.name ?? "Request");

  const isRunning = runStatus === "running" || runStatus === "starting";

  function prepare(): { specs: PerfRequestSpec[]; targetName: string } | null {
    setFormError(null);

    const configErrors = validatePerformanceConfig(config);
    if (configErrors.length > 0) {
      setFormError(configErrors[0]!.message);
      return null;
    }

    const countError = validateRequestCount(selectedRequests.length);
    if (countError) {
      setFormError(countError.message);
      return null;
    }

    const budgetError = validateTotalRequestBudget(config, selectedRequests.length);
    if (budgetError) {
      setFormError(budgetError.message);
      return null;
    }

    const built = buildPerfSpecs(selectedRequests, environment);
    if (!built.ok) {
      setFormError(built.error);
      return null;
    }

    return { specs: built.specs, targetName };
  }

  function handleStart() {
    const prepared = prepare();
    if (!prepared) return;

    const urls = targetUrls(prepared.specs);
    if (requiresProductionWarning(urls)) {
      // Explicit acknowledgement for anything that leaves this machine
      // (spec §39). Local mock-server runs are never interrupted.
      const hosts = [...new Set(urls.map((url) => safeHost(url)))];
      setPendingWarning({ ...prepared, hosts });
      return;
    }
    void launch(prepared.specs, prepared.targetName);
  }

  async function launch(specs: PerfRequestSpec[], name: string) {
    setPendingWarning(null);
    reset();
    await start(specs, { targetName: name, environmentName: environment?.name ?? null });
  }

  const summaryRows: Array<[string, string]> = snapshot
    ? [
        ["Elapsed", `${(live.elapsedMs / 1000).toFixed(1)}s`],
        ["Users", String(live.activeUsers)],
        ["Requests", formatNumber(live.completed)],
        ["RPS", formatNumber(snapshot.rps, 1)],
        ["P95", `${Math.round(snapshot.latency.p95)} ms`],
        ["Errors", `${(snapshot.errorRate * 100).toFixed(2)}%`],
      ]
    : [
        ["Elapsed", `${(live.elapsedMs / 1000).toFixed(1)}s`],
        ["Users", String(live.activeUsers)],
        ["Requests", formatNumber(live.completed)],
        ["RPS", "—"],
        ["P95", "—"],
        ["Errors", formatNumber(live.failed)],
      ];

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-5" aria-label="Performance workspace">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4">
          <h1 className="text-base font-semibold text-neutral-800 dark:text-neutral-100">Performance</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            Load is generated by the local <code className="font-mono">performance-worker</code> process, not by this
            browser tab. These runs are for development, QA, and controlled staging checks — they are{" "}
            <strong className="font-semibold">not</strong> a substitute for distributed production load testing.
          </p>
        </header>

        {workerError && (
          <p
            role="alert"
            data-testid="perf-worker-error"
            className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            {workerError}
          </p>
        )}

        {workerStatus && (
          <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400" data-testid="perf-worker-status">
            Worker: Running · limits {workerStatus.limits.maxVirtualUsers} users, {workerStatus.limits.maxDurationSeconds}s
            duration, {workerStatus.limits.maxTotalRequests.toLocaleString()} requests
          </p>
        )}

        {/* ---- Configuration ---- */}
        <section className="mb-5 rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 text-sm font-semibold">Configuration</h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="perf-target-kind">
                Target type
              </label>
              <select
                id="perf-target-kind"
                className={FIELD_CLASS}
                value={config.targetKind}
                disabled={isRunning}
                onChange={(e) => setConfig({ targetKind: e.target.value as "request" | "collection", targetId: null })}
              >
                <option value="request">Single request</option>
                <option value="collection">Collection</option>
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="perf-target">
                Target
              </label>
              <select
                id="perf-target"
                className={FIELD_CLASS}
                value={config.targetId ?? ""}
                disabled={isRunning}
                onChange={(e) => setConfig({ targetId: e.target.value || null })}
              >
                <option value="">Select…</option>
                {config.targetKind === "collection"
                  ? collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                      </option>
                    ))
                  : allRequests.map((request) => (
                      <option key={request.id} value={request.id}>
                        {request.collectionName} / {request.name}
                      </option>
                    ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="perf-environment">
                Environment
              </label>
              <select
                id="perf-environment"
                className={FIELD_CLASS}
                value={config.environmentId ?? ""}
                disabled={isRunning}
                onChange={(e) => setConfig({ environmentId: e.target.value || null })}
              >
                <option value="">No Environment</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="perf-load-model">
                Load model
              </label>
              <select
                id="perf-load-model"
                className={FIELD_CLASS}
                value={config.loadModel}
                disabled={isRunning}
                onChange={(e) => setConfig({ loadModel: e.target.value as "concurrency" | "rate" })}
              >
                <option value="concurrency">Fixed concurrency (users drive the rate)</option>
                <option value="rate">Fixed request rate (paced)</option>
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="perf-users">
                Virtual users (max {MAX_VIRTUAL_USERS})
              </label>
              <input
                id="perf-users"
                type="number"
                min={1}
                max={MAX_VIRTUAL_USERS}
                className={FIELD_CLASS}
                value={config.virtualUsers}
                disabled={isRunning}
                onChange={(e) => setConfig({ virtualUsers: Number(e.target.value) })}
              />
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="perf-duration">
                Duration, seconds (max {MAX_DURATION_SECONDS})
              </label>
              <input
                id="perf-duration"
                type="number"
                min={1}
                max={MAX_DURATION_SECONDS}
                className={FIELD_CLASS}
                value={config.durationSeconds}
                disabled={isRunning}
                onChange={(e) => setConfig({ durationSeconds: Number(e.target.value) })}
              />
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="perf-rampup">
                Ramp-up, seconds
              </label>
              <input
                id="perf-rampup"
                type="number"
                min={0}
                className={FIELD_CLASS}
                value={config.rampUpSeconds}
                disabled={isRunning}
                onChange={(e) => setConfig({ rampUpSeconds: Number(e.target.value) })}
              />
            </div>

            {config.loadModel === "rate" ? (
              <div>
                <label className={LABEL_CLASS} htmlFor="perf-rate">
                  Target requests/sec
                </label>
                <input
                  id="perf-rate"
                  type="number"
                  min={1}
                  className={FIELD_CLASS}
                  value={config.targetRps}
                  disabled={isRunning}
                  onChange={(e) => setConfig({ targetRps: Number(e.target.value) })}
                />
              </div>
            ) : (
              <div>
                <label className={LABEL_CLASS} htmlFor="perf-timeout">
                  Request timeout, ms
                </label>
                <input
                  id="perf-timeout"
                  type="number"
                  min={1}
                  className={FIELD_CLASS}
                  value={config.requestTimeoutMs}
                  disabled={isRunning}
                  onChange={(e) => setConfig({ requestTimeoutMs: Number(e.target.value) })}
                />
              </div>
            )}
          </div>

          {/* ---- Thresholds ---- */}
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Thresholds
          </h3>
          <div className="space-y-2">
            {config.thresholds.map((threshold, index) => (
              <div key={threshold.id} className="flex items-center gap-2 text-sm">
                <span className="w-32 text-xs text-neutral-600 dark:text-neutral-300">
                  {METRIC_LABELS[threshold.metric]}
                </span>
                <span className="w-6 text-center text-xs">{COMPARATOR_LABELS[threshold.comparator]}</span>
                <input
                  type="number"
                  min={0}
                  aria-label={`${METRIC_LABELS[threshold.metric]} threshold`}
                  data-testid={`perf-threshold-${threshold.metric}`}
                  className="w-28 rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  value={threshold.value}
                  disabled={isRunning}
                  onChange={(e) => {
                    const thresholds = [...config.thresholds];
                    thresholds[index] = { ...threshold, value: Number(e.target.value) };
                    setConfig({ thresholds });
                  }}
                />
                <span className="text-xs text-neutral-500">{METRIC_UNITS[threshold.metric]}</span>
                <label className="ml-2 flex items-center gap-1 text-xs text-neutral-500">
                  <input
                    type="checkbox"
                    checked={threshold.enabled}
                    disabled={isRunning}
                    onChange={(e) => {
                      const thresholds = [...config.thresholds];
                      thresholds[index] = { ...threshold, enabled: e.target.checked };
                      setConfig({ thresholds });
                    }}
                  />
                  Enabled
                </label>
              </div>
            ))}
          </div>

          {formError && (
            <p role="alert" data-testid="perf-form-error" className="mt-3 text-xs text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            {!isRunning ? (
              <button
                type="button"
                onClick={handleStart}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Start Test
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void stop()}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Stop Test
              </button>
            )}
            {runStatus === "finished" && (
              <button
                type="button"
                onClick={reset}
                className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700"
              >
                Clear result
              </button>
            )}
          </div>
        </section>

        {/* ---- Production warning ---- */}
        {pendingWarning && (
          <Dialog
            onClose={() => setPendingWarning(null)}
            titleId="perf-confirm-title"
            className="w-[28rem] max-w-[92vw] p-4"
            role="alertdialog"
          >
            <div data-testid="perf-production-warning">
              <h2 id="perf-confirm-title" className="mb-2 text-sm font-semibold">This test targets a non-local system</h2>
              <p className="mb-3 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                Performance tests can generate significant traffic against{" "}
                <strong className="font-mono">{pendingWarning.hosts.join(", ")}</strong>. Only test systems you are
                authorized to test.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingWarning(null)}
                  className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void launch(pendingWarning.specs, pendingWarning.targetName)}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                >
                  I understand — Start Test
                </button>
              </div>
            </div>
          </Dialog>
        )}

        {/* ---- Live metrics ---- */}
        {(isRunning || runStatus === "finished") && (
          <section className="mb-5 rounded border border-neutral-200 p-4 dark:border-neutral-800" data-testid="perf-live">
            <h2 className="mb-3 text-sm font-semibold">
              {isRunning ? "Running…" : `Result: ${report?.status.toUpperCase() ?? "—"}`}
            </h2>
            <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {summaryRows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</dt>
                  <dd
                    className="font-mono text-sm tabular-nums text-neutral-800 dark:text-neutral-100"
                    data-testid={`perf-live-${label.toLowerCase()}`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {runError && (
          <p
            role="alert"
            data-testid="perf-run-error"
            className="mb-5 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {runError}
          </p>
        )}

        {/* ---- Report ---- */}
        {report && (
          <section className="mb-5 rounded border border-neutral-200 p-4 dark:border-neutral-800" data-testid="perf-report">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Performance Test Result</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="perf-export-json"
                  onClick={() => downloadFile(`${report.runId}.json`, reportToJson(report), "application/json")}
                  className="rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700"
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  data-testid="perf-export-csv"
                  onClick={() => downloadFile(`${report.runId}.csv`, reportToCsv(report), "text/csv")}
                  className="rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700"
                >
                  Export CSV
                </button>
              </div>
            </div>

            <p
              data-testid="perf-report-status"
              className={`mb-3 text-sm font-semibold ${
                report.status === "passed"
                  ? "text-green-700 dark:text-green-400"
                  : report.status === "cancelled"
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-red-700 dark:text-red-400"
              }`}
            >
              Status: {report.status.toUpperCase()}
            </p>

            <pre
              data-testid="perf-report-summary"
              className="mb-4 overflow-x-auto rounded bg-neutral-50 p-3 font-mono text-xs leading-relaxed dark:bg-neutral-950"
            >
              {formatReportSummary(report)}
            </pre>

            {report.snapshot.latencySampled && (
              <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
                This run exceeded the retained-sample limit, so percentiles are statistical estimates rather than exact
                values.
              </p>
            )}

            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Thresholds</h3>
            {report.thresholdResults.length === 0 ? (
              <p className="mb-4 text-xs text-neutral-400">No thresholds were configured.</p>
            ) : (
              <ul className="mb-4 space-y-1 text-xs">
                {report.thresholdResults.map((result) => (
                  <li key={result.threshold.id} data-testid={`perf-threshold-result-${result.threshold.metric}`}>
                    <span className={result.passed ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                      {result.passed ? "PASS" : "FAIL"}
                    </span>{" "}
                    {METRIC_LABELS[result.threshold.metric]} {COMPARATOR_LABELS[result.threshold.comparator]}{" "}
                    {result.threshold.value}
                    {METRIC_UNITS[result.threshold.metric]} — actual {result.actual.toFixed(2)}
                    {METRIC_UNITS[result.threshold.metric]}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Errors</h3>
            <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs" data-testid="perf-error-breakdown">
              {PERF_ERROR_KINDS.map((kind) => (
                <li key={kind} data-testid={`perf-error-${kind}`}>
                  <span className="text-neutral-500">{ERROR_KIND_LABELS[kind]}:</span>{" "}
                  <span className="font-mono tabular-nums">{report.snapshot.errors[kind]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {snapshot && (
          <section className="mb-5 rounded border border-neutral-200 p-4 dark:border-neutral-800" data-testid="perf-charts">
            <h2 className="mb-3 text-sm font-semibold">Charts</h2>
            <PerfCharts snapshot={snapshot} />
          </section>
        )}

        {history.length > 0 && (
          <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800" data-testid="perf-history">
            <h2 className="mb-1 text-sm font-semibold">Recent runs</h2>
            <p className="mb-2 text-xs text-neutral-500">
              Kept in memory for this session only — performance history is never written to browser storage.
            </p>
            <ul className="space-y-1 text-xs">
              {history.map((entry) => (
                <li key={entry.runId} className="font-mono tabular-nums">
                  {entry.status.toUpperCase()} · {entry.targetName} · {formatNumber(entry.snapshot.completed)} req ·{" "}
                  {formatNumber(entry.snapshot.rps, 1)} rps · P95 {Math.round(entry.snapshot.latency.p95)}ms
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
