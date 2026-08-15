import { useMemo, useState } from "react";
import { computeCoverage, detectDrift } from "@api-lab/contract-engine";
import {
  documentationFileName,
  type DocFormat,
  type DocGroupingMode,
  type DocSections,
  type DocSourceKind,
} from "@api-lab/documentation-engine";
import { useAppStore } from "../../store/useAppStore";
import {
  findSpecificationForCollection,
  getContractModel,
  useContractStore,
} from "../../store/useContractStore";
import { useDocumentationStore } from "../../store/useDocumentationStore";
import { collectionToDocSource } from "../../lib/documentationAdapt";
import { collectionToDriftEndpoints } from "../../lib/contractAdapt";
import { DocumentationPreview } from "./DocumentationPreview";
import { Dialog } from "../common/Dialog";

/**
 * The Documentation workspace (spec §32).
 *
 * Deliberately simple, as spec §32 asks: pick a source, pick a format, tick
 * the sections you want, generate, export. There is no editor, no theming, no
 * template system — those are spec §43 non-goals, and a documentation
 * generator earns trust by being predictable rather than configurable.
 *
 * The layout is a settings column beside a live preview, because the single
 * most common question while generating documentation is "what does that
 * checkbox actually do to the output", and answering it should not require a
 * round trip through a dialog.
 *
 * ## Try Request is deliberately absent (spec §31)
 *
 * Spec §31 recommends deferring it, and M13 does. The generated artifact is a
 * *document*: it must work from a `file://` URL on a machine that has never
 * heard of API Lab, and an execution button would either not work there or
 * would require shipping a second HTTP client into the export — which spec
 * §31 also forbids. The place to send a request is the request workspace,
 * which already has the real request engine, the real auth model, and the
 * real environment resolution behind it.
 */

const SOURCE_OPTIONS: { id: DocSourceKind; label: string }[] = [
  { id: "openapi", label: "OpenAPI specification" },
  { id: "collection", label: "Collection" },
  { id: "combined", label: "OpenAPI + Collection" },
];

const FORMAT_OPTIONS: { id: DocFormat; label: string }[] = [
  { id: "html", label: "HTML" },
  { id: "markdown", label: "Markdown" },
  { id: "json", label: "JSON" },
];

const GROUPING_OPTIONS: { id: DocGroupingMode; label: string }[] = [
  { id: "auto", label: "Automatic (tags, else folders)" },
  { id: "tag", label: "OpenAPI tags" },
  { id: "folder", label: "Collection folders" },
  { id: "none", label: "No grouping" },
];

const SECTION_OPTIONS: { id: keyof DocSections; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "endpoints", label: "Endpoints" },
  { id: "schemas", label: "Schemas" },
  { id: "examples", label: "Examples" },
  { id: "contractStatus", label: "Contract status" },
];

const MIME_TYPES: Record<DocFormat, string> = {
  html: "text/html",
  markdown: "text/markdown",
  json: "application/json",
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

export function DocumentationManager({ onClose }: { onClose: () => void }) {
  const collections = useAppStore((s) => s.workspace.collections);
  const contracts = useContractStore((s) => s.contracts);
  const validatedOperations = useContractStore((s) => s.validatedOperations);

  const config = useDocumentationStore((s) => s.config);
  const documentation = useDocumentationStore((s) => s.documentation);
  const rendered = useDocumentationStore((s) => s.rendered);
  const generationError = useDocumentationStore((s) => s.generationError);
  const documentationLoadError = useDocumentationStore((s) => s.documentationLoadError);
  const setSourceKind = useDocumentationStore((s) => s.setSourceKind);
  const setSpecification = useDocumentationStore((s) => s.setSpecification);
  const setCollection = useDocumentationStore((s) => s.setCollection);
  const setFormat = useDocumentationStore((s) => s.setFormat);
  const setSection = useDocumentationStore((s) => s.setSection);
  const setGrouping = useDocumentationStore((s) => s.setGrouping);
  const setIncludeCollectionExamples = useDocumentationStore((s) => s.setIncludeCollectionExamples);
  const setIncludeTimestamp = useDocumentationStore((s) => s.setIncludeTimestamp);
  const generate = useDocumentationStore((s) => s.generate);

  const [exported, setExported] = useState<string | null>(null);

  const needsSpec = config.sourceKind !== "collection";
  const needsCollection = config.sourceKind !== "openapi";

  const specification = useMemo(
    () => contracts.specifications.find((spec) => spec.id === config.specificationId),
    [contracts.specifications, config.specificationId],
  );

  const collection = useMemo(
    () => collections.find((entry) => entry.id === config.collectionId),
    [collections, config.collectionId],
  );

  /**
   * Contract coverage and drift, computed only when the Contract status
   * section is actually enabled.
   *
   * Read from Milestone 11's own functions rather than reimplemented, and
   * never written back — spec §20 requires that documentation generation not
   * mutate contract state, so nothing here calls `recordValidatedOperation`
   * or touches the contract store at all.
   */
  const contractMetrics = useMemo(() => {
    if (!config.sections.contractStatus) return { coverage: undefined, drift: undefined };
    if (collection === undefined) return { coverage: undefined, drift: undefined };

    const boundSpec =
      specification ?? findSpecificationForCollection(contracts, collection.id);
    const model = getContractModel(boundSpec);
    if (model === null) return { coverage: undefined, drift: undefined };

    const drift = detectDrift(model, collectionToDriftEndpoints(collection));
    const validated = new Set(boundSpec === undefined ? [] : validatedOperations[boundSpec.id] ?? []);
    return { coverage: computeCoverage(model, drift, validated), drift };
  }, [config.sections.contractStatus, collection, specification, contracts, validatedOperations]);

  const canGenerate =
    (!needsSpec || specification !== undefined) && (!needsCollection || collection !== undefined);

  function handleGenerate(): void {
    setExported(null);
    generate({
      specificationSource: specification?.source,
      collection: collection === undefined ? undefined : collectionToDocSource(collection),
      coverage: contractMetrics.coverage,
      drift: contractMetrics.drift,
    });
  }

  function handleExport(): void {
    if (rendered === null) return;
    const filename = documentationFileName(rendered.format);
    download(filename, rendered.content, MIME_TYPES[rendered.format]);

    // A static HTML site ships its stylesheet as a companion file (spec §24).
    // The HTML also inlines it, so a user who only takes index.html still gets
    // a styled page — the asset exists for the directory-export case.
    for (const asset of rendered.assets) {
      download(asset.path.replace("/", "-"), asset.content, "text/css");
    }
    setExported(filename);
  }

  return (
    <Dialog
      onClose={onClose}
      ariaLabel="API Documentation"
      titleId="doc-manager-title"
      className="w-[64rem] max-w-[95vw]"
    >
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 id="doc-manager-title" className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            API Documentation
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close documentation manager"
            className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        {documentationLoadError !== null && (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Saved documentation settings could not be loaded: {documentationLoadError}
          </p>
        )}

        <div className="flex min-h-0 flex-1">
          {/* ---------------- Settings ---------------- */}
          <div className="w-72 shrink-0 space-y-4 overflow-y-auto border-r border-neutral-200 p-4 dark:border-neutral-800">
            <div>
              <label
                htmlFor="doc-source"
                className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
              >
                Source
              </label>
              <select
                id="doc-source"
                value={config.sourceKind}
                onChange={(e) => setSourceKind(e.target.value as DocSourceKind)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                {SOURCE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {needsSpec && (
              <div>
                <label
                  htmlFor="doc-specification"
                  className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
                >
                  Specification
                </label>
                <select
                  id="doc-specification"
                  value={config.specificationId ?? ""}
                  onChange={(e) => setSpecification(e.target.value === "" ? undefined : e.target.value)}
                  className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <option value="">Select…</option>
                  {contracts.specifications.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.name}
                    </option>
                  ))}
                </select>
                {contracts.specifications.length === 0 && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Import an OpenAPI specification from the Contract dialog first.
                  </p>
                )}
              </div>
            )}

            {needsCollection && (
              <div>
                <label
                  htmlFor="doc-collection"
                  className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
                >
                  Collection
                </label>
                <select
                  id="doc-collection"
                  value={config.collectionId ?? ""}
                  onChange={(e) => setCollection(e.target.value === "" ? undefined : e.target.value)}
                  className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <option value="">Select…</option>
                  {collections.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor="doc-format"
                className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
              >
                Format
              </label>
              <select
                id="doc-format"
                value={config.format}
                onChange={(e) => setFormat(e.target.value as DocFormat)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                {FORMAT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="doc-grouping"
                className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
              >
                Grouping
              </label>
              <select
                id="doc-grouping"
                value={config.grouping}
                onChange={(e) => setGrouping(e.target.value as DocGroupingMode)}
                className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                {GROUPING_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <fieldset>
              <legend className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                Sections
              </legend>
              <div className="space-y-1">
                {SECTION_OPTIONS.map((option) => (
                  <label key={option.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.sections[option.id]}
                      onChange={(e) => setSection(option.id, e.target.checked)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                Options
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.includeCollectionExamples}
                  onChange={(e) => setIncludeCollectionExamples(e.target.checked)}
                />
                Include collection examples
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.includeTimestamp}
                  onChange={(e) => setIncludeTimestamp(e.target.checked)}
                />
                Include generation timestamp
              </label>
              {config.includeTimestamp && (
                // Stated where the choice is made: a timestamp is the usual
                // reason a "nothing changed" documentation diff is noisy.
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  A timestamp makes each generation differ, even when the API has not.
                </p>
              )}
            </fieldset>

            <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
              Credential values are never included in generated documentation. Variables such as{" "}
              <code>{"{{token}}"}</code> are published as written.
            </p>
          </div>

          {/* ---------------- Preview ---------------- */}
          <div className="flex min-w-0 flex-1 flex-col p-4">
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                data-testid="generate-documentation"
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate Preview
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={rendered === null}
                data-testid="export-documentation"
                className="rounded border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
              >
                Export
              </button>

              {documentation !== null && (
                <span
                  data-testid="documentation-summary"
                  className="text-xs text-neutral-500 dark:text-neutral-400"
                >
                  {documentation.metadata.endpointCount} endpoints ·{" "}
                  {documentation.metadata.schemaCount} schemas
                </span>
              )}
              {exported !== null && (
                <span className="text-xs text-emerald-700 dark:text-emerald-400">
                  Exported {exported}
                </span>
              )}
            </div>

            {generationError !== null && (
              <p
                data-testid="documentation-error"
                className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {generationError}
              </p>
            )}

            {documentation !== null && documentation.metadata.warnings.length > 0 && (
              <details className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <summary className="cursor-pointer">
                  {documentation.metadata.warnings.length} generation note
                  {documentation.metadata.warnings.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-1 list-disc pl-4">
                  {documentation.metadata.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="min-h-0 flex-1">
              {rendered === null ? (
                <div className="flex h-full items-center justify-center rounded border border-dashed border-neutral-200 text-sm text-neutral-500 dark:border-neutral-800">
                  {canGenerate
                    ? "Select your options and choose Generate Preview."
                    : "Select a source to generate documentation from."}
                </div>
              ) : (
                <DocumentationPreview rendered={rendered} />
              )}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
