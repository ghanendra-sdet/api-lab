import { useMemo, useState } from "react";
import {
  KNOWN_SECURITY_HEADERS,
  MAX_GENERATED_TESTS,
  buildSecurityReport,
  classifyTarget,
  collectTargetHosts,
  exportSecurityReportCsv,
  exportSecurityReportJson,
  summarizeSecurityRun,
  type GeneratorCategories,
  type SecurityRequestInput,
  type SecurityTestResult,
} from "@api-lab/security-engine";
import { useAppStore } from "../../store/useAppStore";
import { findSpecificationForCollection, getContractModel, useContractStore } from "../../store/useContractStore";
import { useSecurityStore } from "../../store/useSecurityStore";
import { flattenCollectionRequests } from "../../lib/runner";
import { matchOperation, resolveSecurityRequest } from "../../lib/securityAdapt";
import { browserSecurityExecutor } from "../../lib/securityRun";

type ManagerTab = "generate" | "preview" | "results" | "report";

const TABS: { id: ManagerTab; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "preview", label: "Preview" },
  { id: "results", label: "Results" },
  { id: "report", label: "Report" },
];

/**
 * Category checkboxes (spec §27). Ordered from the safest and most
 * universally useful to the most situational, because the first three are
 * what a tester should reach for on a first run.
 */
const CATEGORY_LABELS: { id: keyof GeneratorCategories; label: string }[] = [
  { id: "missingRequiredFields", label: "Missing required fields" },
  { id: "invalidTypes", label: "Invalid types" },
  { id: "nullValues", label: "Null values" },
  { id: "emptyValues", label: "Empty values" },
  { id: "boundaryValues", label: "Boundary values" },
  { id: "invalidEnums", label: "Invalid enums" },
  { id: "malformedJson", label: "Malformed JSON" },
  { id: "invalidContentType", label: "Unexpected content type" },
  { id: "missingAuthentication", label: "Missing authentication" },
  { id: "invalidAuthentication", label: "Invalid authentication" },
];

const STATUS_STYLES: Record<SecurityTestResult["status"], string> = {
  passed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  error: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  skipped: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

const SEVERITY_STYLES: Record<string, string> = {
  high: "text-red-700 dark:text-red-400",
  medium: "text-amber-700 dark:text-amber-400",
  low: "text-blue-700 dark:text-blue-400",
  info: "text-neutral-500 dark:text-neutral-400",
};

function download(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The Security / Negative Testing workspace (spec §27, §28, §30).
 *
 * Deliberately linear: Generate → Preview → Run → Results. Spec §28 requires
 * the user to explicitly start execution after reviewing what was generated,
 * so the preview is a real step with its own tab rather than a summary line
 * next to a Run button. Nothing on the Generate tab sends a request.
 */
export function SecurityManager({ onClose }: { onClose: () => void }) {
  const collections = useAppStore((s) => s.workspace.collections);
  const environments = useAppStore((s) => s.environments.environments);
  const activeEnvironmentId = useAppStore((s) => s.environments.activeEnvironmentId);
  const contracts = useContractStore((s) => s.contracts);
  const patternVetting = useContractStore((s) => s.patternVetting);

  const tests = useSecurityStore((s) => s.security.tests);
  const securityLoadError = useSecurityStore((s) => s.securityLoadError);
  const categories = useSecurityStore((s) => s.categories);
  const expectations = useSecurityStore((s) => s.expectations);
  const generationWarnings = useSecurityStore((s) => s.generationWarnings);
  const truncated = useSecurityStore((s) => s.truncated);
  const hasGenerated = useSecurityStore((s) => s.hasGenerated);
  const runStatus = useSecurityStore((s) => s.runStatus);
  const results = useSecurityStore((s) => s.results);
  const progress = useSecurityStore((s) => s.progress);
  const refusedReason = useSecurityStore((s) => s.refusedReason);
  const setCategories = useSecurityStore((s) => s.setCategories);
  const setExpectations = useSecurityStore((s) => s.setExpectations);
  const generate = useSecurityStore((s) => s.generate);
  const setTestEnabled = useSecurityStore((s) => s.setTestEnabled);
  const clearTests = useSecurityStore((s) => s.clearTests);
  const confirmHost = useSecurityStore((s) => s.confirmHost);
  const run = useSecurityStore((s) => s.run);
  const cancelRun = useSecurityStore((s) => s.cancelRun);

  const [tab, setTab] = useState<ManagerTab>("generate");
  const [pendingConfirmation, setPendingConfirmation] = useState<string[] | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  /** Every saved request across every collection, with its collection id so
   * the right specification binding can be found. */
  const allRequests = useMemo(
    () =>
      collections.flatMap((collection) =>
        flattenCollectionRequests(collection).map((entry) => ({
          ...entry,
          collectionId: collection.id,
          collectionName: collection.name,
        })),
      ),
    [collections],
  );

  const [selectedRequestId, setSelectedRequestId] = useState<string>(allRequests[0]?.id ?? "");
  const selected = allRequests.find((entry) => entry.id === selectedRequestId) ?? allRequests[0];

  const environment = environments.find((entry) => entry.id === activeEnvironmentId);
  const scopes = useMemo(() => ({ environment }), [environment]);

  const contract = useMemo(() => {
    if (!selected) return null;
    return getContractModel(findSpecificationForCollection(contracts, selected.collectionId));
  }, [contracts, selected]);

  /**
   * Resolves the selected request. Called for generation *and* passed as the
   * per-test resolver during a run, so credentials are materialised at
   * execution time and never stored (spec §33).
   */
  function resolveTarget(requestId: string): SecurityRequestInput | null {
    const entry = allRequests.find((candidate) => candidate.id === requestId);
    if (!entry) return null;
    const spec = findSpecificationForCollection(contracts, entry.collectionId);
    const model = getContractModel(spec);
    const resolved = resolveSecurityRequest(entry.id, entry.name, entry.request, scopes, model);
    return resolved.ok && resolved.request ? resolved.request : null;
  }

  const resolvedTarget = useMemo(() => {
    if (!selected) return null;
    return resolveSecurityRequest(selected.id, selected.name, selected.request, scopes, contract);
  }, [selected, scopes, contract]);

  const enabledTests = tests.filter((test) => test.enabled);
  const summary = useMemo(() => summarizeSecurityRun(results), [results]);

  function handleGenerate(): void {
    setGenerationError(null);
    if (!selected) {
      setGenerationError("Save a request to a collection first — security tests are generated from a saved request.");
      return;
    }
    if (!resolvedTarget?.ok || !resolvedTarget.request) {
      setGenerationError(resolvedTarget?.detail ?? "The selected request could not be resolved.");
      return;
    }

    const operation = matchOperation(contract, resolvedTarget.request.method, resolvedTarget.request.url);

    generate([
      {
        requestId: selected.id,
        requestName: selected.name,
        request: resolvedTarget.request,
        operation,
        components: contract?.components,
      },
    ]);
    setTab("preview");
  }

  function handleRunClicked(): void {
    const urls = enabledTests
      .map((test) => resolveTarget(test.targetRequestId)?.url)
      .filter((url): url is string => url !== undefined);

    const hosts = collectTargetHosts(urls).filter((host) => classifyTarget(`http://${host}`).scope !== "local");
    // Loopback targets stay frictionless (spec §30); anything else names the
    // host and waits for an explicit approval.
    const remote = hosts.filter((host) => {
      const sample = urls.find((url) => url.includes(host));
      return sample !== undefined && classifyTarget(sample).requiresConfirmation;
    });

    if (remote.length > 0) {
      setPendingConfirmation(remote);
      return;
    }

    setTab("results");
    void run({ resolveRequest: resolveTarget, executor: browserSecurityExecutor });
  }

  function handleConfirmed(): void {
    for (const host of pendingConfirmation ?? []) confirmHost(host);
    setPendingConfirmation(null);
    setTab("results");
    void run({ resolveRequest: resolveTarget, executor: browserSecurityExecutor });
  }

  const report = useMemo(
    () =>
      buildSecurityReport({
        results,
        targetUrl: resolvedTarget?.request?.url ?? "",
        specificationTitle: contract?.title,
      }),
    [results, resolvedTarget, contract],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Security"
        className="relative flex h-[38rem] w-[50rem] max-w-[95vw] flex-col rounded-md bg-white shadow-lg dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Security / Negative Testing</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close security manager"
            className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        <div role="tablist" aria-label="Security sections" className="flex gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                tab === entry.id
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {securityLoadError && (
            <p role="alert" className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Saved security tests could not be loaded: {securityLoadError}
            </p>
          )}

          {/* ---------------- Generate ---------------- */}
          {tab === "generate" && (
            <div className="space-y-4">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Generates bounded negative and security tests from a saved request. When the request&apos;s collection has an
                OpenAPI specification attached, required fields, types, bounds and enums come from the contract. Nothing is
                sent until you review the preview and start the run.
              </p>

              <div>
                <label htmlFor="security-target" className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  Target request
                </label>
                <select
                  id="security-target"
                  aria-label="Target request"
                  value={selected?.id ?? ""}
                  onChange={(event) => setSelectedRequestId(event.target.value)}
                  className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  {allRequests.length === 0 && <option value="">No saved requests</option>}
                  {allRequests.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.collectionName} / {entry.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {contract ? `Contract attached: ${contract.title}` : "No contract attached — generation will be heuristic only."}
                </p>
              </div>

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">Test categories</legend>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {CATEGORY_LABELS.map((entry) => (
                    <label key={entry.id} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                      <input
                        type="checkbox"
                        checked={categories[entry.id]}
                        onChange={(event) => setCategories({ [entry.id]: event.target.checked })}
                      />
                      {entry.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">Expected behaviour</legend>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-neutral-600 dark:text-neutral-300">
                    Invalid input status codes
                    <input
                      type="text"
                      aria-label="Invalid input status codes"
                      value={expectations.invalidInputStatusCodes.join(", ")}
                      onChange={(event) =>
                        setExpectations({
                          invalidInputStatusCodes: event.target.value
                            .split(",")
                            .map((part) => Number(part.trim()))
                            .filter((value) => Number.isInteger(value) && value >= 100 && value <= 599),
                        })
                      }
                      className="mt-1 w-full rounded border border-neutral-200 px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                    />
                  </label>
                  <label className="text-xs text-neutral-600 dark:text-neutral-300">
                    Authentication failure status codes
                    <input
                      type="text"
                      aria-label="Authentication failure status codes"
                      value={expectations.authFailureStatusCodes.join(", ")}
                      onChange={(event) =>
                        setExpectations({
                          authFailureStatusCodes: event.target.value
                            .split(",")
                            .map((part) => Number(part.trim()))
                            .filter((value) => Number.isInteger(value) && value >= 100 && value <= 599),
                        })
                      }
                      className="mt-1 w-full rounded border border-neutral-200 px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                    />
                  </label>
                </div>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  APIs disagree about these — 401, 403 and even 404 are all defensible for an unauthenticated request. Set what
                  your API actually promises.
                </p>
              </fieldset>

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">Response checks</legend>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                    <input
                      type="checkbox"
                      checked={expectations.forbidSensitiveData}
                      onChange={(event) => setExpectations({ forbidSensitiveData: event.target.checked })}
                    />
                    Fail on sensitive fields in the response
                  </label>
                  <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                    <input
                      type="checkbox"
                      checked={expectations.checkCors}
                      onChange={(event) => setExpectations({ checkCors: event.target.checked })}
                    />
                    Check CORS configuration
                  </label>
                  <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                    <input
                      type="checkbox"
                      checked={expectations.checkTransport}
                      onChange={(event) => setExpectations({ checkTransport: event.target.checked })}
                    />
                    Check transport (HTTP vs HTTPS)
                  </label>
                </div>

                <p className="mt-2 mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">Required security headers</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {KNOWN_SECURITY_HEADERS.map((header) => (
                    <label key={header} className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-200">
                      <input
                        type="checkbox"
                        checked={expectations.requiredSecurityHeaders.includes(header)}
                        onChange={(event) =>
                          setExpectations({
                            requiredSecurityHeaders: event.target.checked
                              ? [...expectations.requiredSecurityHeaders, header]
                              : expectations.requiredSecurityHeaders.filter((entry) => entry !== header),
                          })
                        }
                      />
                      {header}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  None are required by default. A missing header is not a universal vulnerability — set what your policy mandates.
                </p>
              </fieldset>

              {generationError && (
                <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  {generationError}
                </p>
              )}

              <button
                type="button"
                onClick={handleGenerate}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Generate
              </button>
            </div>
          )}

          {/* ---------------- Preview ---------------- */}
          {tab === "preview" && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">Generated tests: {tests.length}</p>

              {hasGenerated && tests.length === 0 && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  No tests were generated for the selected categories. See the notes below.
                </p>
              )}

              {truncated && (
                <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  Generation stopped at the {MAX_GENERATED_TESTS}-test limit.
                </p>
              )}

              {generationWarnings.length > 0 && (
                <ul className="space-y-1 rounded border border-neutral-200 p-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                  {generationWarnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              )}

              <ul className="space-y-1">
                {tests.map((test) => (
                  <li key={test.id} className="flex items-start gap-2 rounded border border-neutral-200 p-2 dark:border-neutral-800">
                    <input
                      type="checkbox"
                      aria-label={`Include ${test.name}`}
                      checked={test.enabled}
                      onChange={(event) => setTestEnabled(test.id, event.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="flex-1">
                      <span className="block text-sm text-neutral-800 dark:text-neutral-100">{test.name}</span>
                      <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                        {test.category} · {test.metadata.source} · expects{" "}
                        {test.expected.statusCodes.length > 0
                          ? test.expected.statusCodes.join(", ")
                          : test.expected.statusClasses.join(", ") || "any status"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              {tests.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleRunClicked}
                    disabled={runStatus === "running" || enabledTests.length === 0}
                    className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Run security tests
                  </button>
                  <button
                    type="button"
                    onClick={clearTests}
                    className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ---------------- Results ---------------- */}
          {tab === "results" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <p className="text-sm text-neutral-700 dark:text-neutral-200">
                  {runStatus === "running"
                    ? `Running ${progress.completed} / ${progress.total}…`
                    : `Run ${runStatus} — ${summary.passed} passed, ${summary.failed} failed, ${summary.warnings} warnings, ${summary.errors} errors, ${summary.skipped} skipped`}
                </p>
                {runStatus === "running" && (
                  <button type="button" onClick={cancelRun} className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
                    Cancel
                  </button>
                )}
              </div>

              {refusedReason && (
                <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  {refusedReason}
                </p>
              )}

              <ul className="space-y-2">
                {results.map((result, index) => (
                  <li key={`${result.testId}-${index}`} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium uppercase ${STATUS_STYLES[result.status]}`}>
                        {result.status}
                      </span>
                      <span className="flex-1 text-sm text-neutral-800 dark:text-neutral-100">{result.testName}</span>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        {result.actualStatus ?? "—"} / expected {result.expectedStatus}
                      </span>
                    </div>
                    {result.detail && <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{result.detail}</p>}
                    {result.findings.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {result.findings.map((finding, findingIndex) => (
                          <li key={`${finding.rule}-${findingIndex}`} className="text-xs">
                            <span className={`font-medium uppercase ${SEVERITY_STYLES[finding.severity] ?? ""}`}>{finding.severity}</span>{" "}
                            <span className="text-neutral-700 dark:text-neutral-300">{finding.message}</span>
                            <span className="block text-neutral-500 dark:text-neutral-400">Remediation: {finding.remediation}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {result.warnings.map((warning) => (
                      <p key={warning} className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        {warning}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---------------- Report ---------------- */}
          {tab === "report" && (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-neutral-500 dark:text-neutral-400">Target</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">{report.targetHost}</dd>
                <dt className="text-neutral-500 dark:text-neutral-400">Requests tested</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">{summary.total}</dd>
                <dt className="text-neutral-500 dark:text-neutral-400">Passed / Failed / Warnings</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">
                  {summary.passed} / {summary.failed} / {summary.warnings}
                </dd>
                <dt className="text-neutral-500 dark:text-neutral-400">Findings by severity</dt>
                <dd className="text-neutral-800 dark:text-neutral-100">
                  high {summary.findingsBySeverity.high} · medium {summary.findingsBySeverity.medium} · low{" "}
                  {summary.findingsBySeverity.low} · info {summary.findingsBySeverity.info}
                </dd>
              </dl>

              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Reports never contain credentials: sensitive fields are reported by name only, and URLs are stripped of
                userinfo and credential-shaped query parameters.
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => download("security-report.json", exportSecurityReportJson(report), "application/json")}
                  className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => download("security-report.csv", exportSecurityReportCsv(report), "text/csv")}
                  className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
                >
                  Export CSV
                </button>
              </div>

              <div className="rounded border border-neutral-200 p-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                <p className="font-medium text-neutral-700 dark:text-neutral-300">ReDoS pattern vetting</p>
                <p>
                  {patternVetting.degraded
                    ? "Worker isolation unavailable — static pattern screening only."
                    : `${patternVetting.vetted} pattern(s) vetted in an isolated worker; ${patternVetting.timedOut} timed out and ${patternVetting.unsafe} rejected.`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Target confirmation (spec §30) ---------------- */}
      {pendingConfirmation !== null && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm target"
            className="w-[28rem] max-w-[90vw] rounded-md bg-white p-4 shadow-lg dark:bg-neutral-900"
          >
            <h3 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">Confirm non-local target</h3>
            <p className="mb-2 text-sm text-neutral-700 dark:text-neutral-300">
              This run will send {enabledTests.length} generated request(s) to:
            </p>
            <ul className="mb-3 list-inside list-disc text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {pendingConfirmation.map((host) => (
                <li key={host}>{host}</li>
              ))}
            </ul>
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              Some requests will deliberately omit credentials or send malformed data. Only continue if you are authorised to
              test this host.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingConfirmation(null)}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmed}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Confirm and run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
