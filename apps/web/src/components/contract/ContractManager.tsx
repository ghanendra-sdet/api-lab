import { useMemo, useRef, useState } from "react";
import {
  buildContractReport,
  computeCoverage,
  contractReportToCsv,
  contractReportToJson,
  detectDrift,
  filterDrift,
  formatContractReportSummary,
  MAX_SPEC_FILE_SIZE_BYTES,
  type DriftFilter,
} from "@api-lab/contract-engine";
import { useAppStore } from "../../store/useAppStore";
import { getContractModel, useContractStore } from "../../store/useContractStore";
import { collectionToDriftEndpoints } from "../../lib/contractAdapt";
import { Dialog } from "../common/Dialog";

type ManagerTab = "specifications" | "drift" | "coverage" | "report";

const TABS: { id: ManagerTab; label: string }[] = [
  { id: "specifications", label: "Specifications" },
  { id: "drift", label: "Drift" },
  { id: "coverage", label: "Coverage" },
  { id: "report", label: "Report" },
];

const DRIFT_FILTER_LABELS: Record<DriftFilter, string> = {
  all: "All",
  "missing-from-spec": "Missing from spec",
  "missing-from-collection": "Missing from collection",
  changed: "Changed",
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
 * The Contract workspace dialog: attach specifications, bind them to
 * collections, and read the drift, coverage, and contract-test reports
 * (spec §25, §26, §35, §37, §38, §39).
 */
export function ContractManager({ onClose }: { onClose: () => void }) {
  const contracts = useContractStore((s) => s.contracts);
  const contractsLoadError = useContractStore((s) => s.contractsLoadError);
  const importSpecification = useContractStore((s) => s.importSpecification);
  const removeSpecification = useContractStore((s) => s.removeSpecification);
  const bindCollection = useContractStore((s) => s.bindCollection);
  const unbindCollection = useContractStore((s) => s.unbindCollection);
  const validatedOperations = useContractStore((s) => s.validatedOperations);
  const collections = useAppStore((s) => s.workspace.collections);
  const runnerState = useAppStore((s) => s.runnerState);

  const [tab, setTab] = useState<ManagerTab>("specifications");
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(
    contracts.specifications[0]?.id ?? null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [driftFilter, setDriftFilter] = useState<DriftFilter>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const specification =
    contracts.specifications.find((spec) => spec.id === selectedSpecId) ?? contracts.specifications[0];
  const contract = useMemo(() => getContractModel(specification), [specification]);

  // Drift and coverage are computed against the collection bound to this
  // specification — comparing against an unrelated collection would produce
  // a report that is technically correct and completely useless.
  const boundCollection = collections.find((collection) =>
    specification?.collectionIds.includes(collection.id),
  );

  const drift = useMemo(() => {
    if (!contract) return null;
    return detectDrift(contract, boundCollection ? collectionToDriftEndpoints(boundCollection) : []);
  }, [contract, boundCollection]);

  const coverage = useMemo(() => {
    if (!contract || !drift || !specification) return null;
    return computeCoverage(contract, drift, new Set(validatedOperations[specification.id] ?? []));
  }, [contract, drift, specification, validatedOperations]);

  const report = useMemo(() => {
    if (!contract || !specification) return null;
    const entries = runnerState.iterations.flatMap((iteration) =>
      iteration.items
        .filter((item) => item.contractResult !== undefined)
        .map((item) => {
          const result = item.contractResult!;
          return {
            requestName: item.name,
            method: result.operation?.method ?? ("GET" as const),
            path: result.operation?.path ?? "(unresolved)",
            valid: result.valid,
            violations: [...result.requestViolations, ...result.responseViolations],
            warnings: result.warnings,
          };
        }),
    );
    return buildContractReport(specification.name, specification.openapiVersionString, entries, coverage);
  }, [contract, specification, runnerState, coverage]);

  async function handleFile(file: File) {
    setImportError(null);
    if (file.size > MAX_SPEC_FILE_SIZE_BYTES) {
      setImportError(`File is larger than the ${(MAX_SPEC_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)}MB limit.`);
      return;
    }
    const text = await file.text();
    const result = importSpecification(file.name.replace(/\.(json|ya?ml)$/i, ""), text);
    if (!result.ok) {
      setImportError(result.detail);
      return;
    }
    setSelectedSpecId(result.id);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Dialog
      onClose={onClose}
      ariaLabel="Manage contract"
      titleId="contract-manager-title"
      className="w-[46rem] max-w-[94vw]"
    >
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 id="contract-manager-title" className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">API Contract Testing</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contract manager"
            className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        <div role="tablist" aria-label="Contract sections" className="flex gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800">
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
          {contractsLoadError && (
            <p role="alert" className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Saved contract data could not be loaded: {contractsLoadError}
            </p>
          )}

          {tab === "specifications" && (
            <div>
              <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                Import an OpenAPI 3.0 or 3.1 document (JSON or YAML) to validate requests and responses against.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.yaml,.yml,application/json,text/yaml"
                aria-label="Import OpenAPI specification"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="mb-3 block w-full text-sm text-neutral-600 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 dark:text-neutral-300 dark:file:bg-blue-950 dark:file:text-blue-300"
              />
              {importError && (
                <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  {importError}
                </p>
              )}

              {contracts.specifications.length === 0 ? (
                <p className="text-neutral-500 dark:text-neutral-400">No specifications attached yet.</p>
              ) : (
                <ul className="space-y-2">
                  {contracts.specifications.map((spec) => {
                    const model = getContractModel(spec);
                    return (
                      <li
                        key={spec.id}
                        className={`rounded border p-2 ${
                          spec.id === specification?.id
                            ? "border-blue-400 dark:border-blue-600"
                            : "border-neutral-200 dark:border-neutral-800"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => setSelectedSpecId(spec.id)}
                            className="text-left font-medium text-neutral-800 dark:text-neutral-100"
                          >
                            {spec.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSpecification(spec.id)}
                            aria-label={`Remove ${spec.name}`}
                            className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            Remove
                          </button>
                        </div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          OpenAPI {spec.openapiVersionString} · {spec.sourceFormat.toUpperCase()} ·{" "}
                          {model ? `${model.operations.length} operations` : "could not be parsed"}
                        </p>
                        {model && model.warnings.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-amber-700 dark:text-amber-400">
                              {model.warnings.length} specification warning{model.warnings.length === 1 ? "" : "s"}
                            </summary>
                            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                              {model.warnings.map((warning, index) => (
                                <li key={index}>{warning}</li>
                              ))}
                            </ul>
                          </details>
                        )}

                        <div className="mt-2">
                          <label
                            htmlFor={`bind-${spec.id}`}
                            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                          >
                            Bound collection
                          </label>
                          <select
                            id={`bind-${spec.id}`}
                            value={collections.find((c) => spec.collectionIds.includes(c.id))?.id ?? ""}
                            onChange={(event) => {
                              const previous = collections.find((c) => spec.collectionIds.includes(c.id));
                              if (previous) unbindCollection(spec.id, previous.id);
                              if (event.target.value !== "") bindCollection(spec.id, event.target.value);
                            }}
                            className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                          >
                            <option value="">Not bound</option>
                            {collections.map((collection) => (
                              <option key={collection.id} value={collection.id}>
                                {collection.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {tab === "drift" && (
            <div>
              {!contract || !drift ? (
                <p className="text-neutral-500 dark:text-neutral-400">Attach a specification to compare against.</p>
              ) : !boundCollection ? (
                <p className="text-neutral-500 dark:text-neutral-400">
                  Bind this specification to a collection on the Specifications tab to detect drift.
                </p>
              ) : (
                <>
                  <p data-testid="drift-summary" className="mb-2 text-neutral-700 dark:text-neutral-300">
                    Matched: {drift.matched} · Missing from spec: {drift.missingFromSpec} · Missing from collection:{" "}
                    {drift.missingFromCollection} · Changed: {drift.mismatched}
                  </p>
                  <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Drift filter">
                    {(Object.keys(DRIFT_FILTER_LABELS) as DriftFilter[]).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        aria-pressed={driftFilter === filter}
                        onClick={() => setDriftFilter(filter)}
                        className={`rounded px-2 py-0.5 text-xs ${
                          driftFilter === filter
                            ? "bg-neutral-100 font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                            : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                        }`}
                      >
                        {DRIFT_FILTER_LABELS[filter]}
                      </button>
                    ))}
                  </div>
                  <ul className="space-y-1">
                    {filterDrift(drift, driftFilter).map((entry, index) => (
                      <li
                        key={`${entry.kind}-${entry.method}-${entry.path}-${index}`}
                        data-testid="drift-entry"
                        className="rounded border border-neutral-100 p-2 text-xs dark:border-neutral-900"
                      >
                        <span
                          className={
                            entry.kind === "matched"
                              ? "text-green-700 dark:text-green-400"
                              : entry.severity === "error"
                                ? "text-red-700 dark:text-red-400"
                                : "text-amber-700 dark:text-amber-400"
                          }
                        >
                          <span aria-hidden="true">{entry.kind === "matched" ? "✓" : "⚠"}</span>{" "}
                          <span className="font-mono">
                            {entry.method} {entry.path}
                          </span>
                        </span>
                        <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">{entry.reason}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {tab === "coverage" && (
            <div>
              {!coverage ? (
                <p className="text-neutral-500 dark:text-neutral-400">Attach a specification to measure coverage.</p>
              ) : (
                <div data-testid="coverage-report">
                  <p className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">
                    Coverage is measured over documented OpenAPI operations. It is not code coverage.
                  </p>
                  <dl className="mb-3 grid grid-cols-2 gap-y-1 text-neutral-700 dark:text-neutral-300">
                    <dt>OpenAPI Operations</dt>
                    <dd>{coverage.totalOperations}</dd>
                    <dt>Covered by Collection</dt>
                    <dd>{coverage.coveredOperations}</dd>
                    <dt>Operation Coverage</dt>
                    <dd data-testid="operation-coverage">{coverage.operationCoveragePercent}%</dd>
                    <dt>Validated Operations</dt>
                    <dd>{coverage.validatedOperations}</dd>
                    <dt>Contract Test Coverage</dt>
                    <dd data-testid="validation-coverage">{coverage.validationCoveragePercent}%</dd>
                  </dl>
                  {coverage.uncovered.length > 0 && (
                    <>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                        Uncovered operations
                      </p>
                      <ul className="space-y-0.5 font-mono text-xs text-neutral-600 dark:text-neutral-400">
                        {coverage.uncovered.map((entry) => (
                          <li key={`${entry.method} ${entry.path}`}>
                            {entry.method} {entry.path}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "report" && (
            <div>
              {!report ? (
                <p className="text-neutral-500 dark:text-neutral-400">Attach a specification to build a report.</p>
              ) : (
                <div data-testid="contract-report">
                  <pre className="mb-3 whitespace-pre-wrap rounded border border-neutral-200 p-2 font-mono text-xs text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
                    {formatContractReportSummary(report)}
                  </pre>

                  {report.entries.length === 0 ? (
                    <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
                      No contract-validated requests yet. Run the collection with{" "}
                      <strong>Validate contract after response</strong> enabled to populate this report.
                    </p>
                  ) : (
                    <ul className="mb-3 space-y-1">
                      {report.entries.map((entry, index) => (
                        <li key={index} className="rounded border border-neutral-100 p-2 text-xs dark:border-neutral-900">
                          <span className={entry.valid ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                            <span aria-hidden="true">{entry.valid ? "✓" : "✗"}</span> {entry.requestName} —{" "}
                            <span className="font-mono">
                              {entry.method} {entry.path}
                            </span>
                          </span>
                          {entry.violations.map((violation, violationIndex) => (
                            <p key={violationIndex} className="mt-0.5 text-neutral-600 dark:text-neutral-400">
                              {violation.path}: {violation.message}
                            </p>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => download("contract-report.json", contractReportToJson(report), "application/json")}
                      className="rounded bg-neutral-100 px-3 py-1.5 text-xs font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                    >
                      Export JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => download("contract-report.csv", contractReportToCsv(report), "text/csv")}
                      className="rounded bg-neutral-100 px-3 py-1.5 text-xs font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
