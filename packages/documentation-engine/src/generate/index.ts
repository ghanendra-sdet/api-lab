import { buildContractModel, parseSpecSource, type CoverageReport, type DriftReport } from "@api-lab/contract-engine";
import { extractOpenApiDocMetadata } from "../source/openapiDoc.ts";
import type { DocCollectionSource } from "../source/collectionSource.ts";
import type { DocGroupingMode, Documentation } from "../types.ts";
import { generateFromOpenApi } from "./fromOpenApi.ts";
import { generateFromCollection } from "./fromCollection.ts";
import { combineDocumentation, toDocCoverage, toDocDrift } from "./combine.ts";

export * from "./fromOpenApi.ts";
export * from "./fromCollection.ts";
export * from "./combine.ts";

/**
 * The single entry point for documentation generation.
 *
 * ## One parse, three consumers
 *
 * The specification source text is turned into a JavaScript value exactly
 * once, by contract-engine's `parseSpecSource` — the same safe YAML
 * configuration, the same alias budget, the same size limit that the contract
 * validator and the security generator go through. That one value then feeds
 * two projections:
 *
 * - `buildContractModel` → structure and normalized schemas (Milestone 11).
 * - `extractOpenApiDocMetadata` → prose, tags, examples (Milestone 13).
 *
 * Parsing twice would have been simpler to write and is what the obvious
 * implementation does. It was rejected on spec §36's grounds — "normalize
 * once, reuse schema models, avoid repeated parsing" — and because two parses
 * of the same text are two opportunities for the two views to disagree about
 * what the document said.
 *
 * ## Never throws
 *
 * Returns a typed failure, matching `parseContract`'s contract in
 * contract-engine and `parseImportFile`'s in collection-format. A
 * documentation generator that throws on a malformed document is a
 * documentation generator that crashes the tab it was invoked from.
 */

export type GenerationResult =
  | { ok: true; documentation: Documentation }
  | { ok: false; reason: "invalid-source" | "no-source"; detail: string };

export interface GenerateDocumentationInput {
  /** Raw specification text (JSON or YAML), when an OpenAPI source is used. */
  specificationSource: string | undefined;
  /** Collection source, when a collection contributes. */
  collection: DocCollectionSource | undefined;
  grouping: DocGroupingMode;
  includeCollectionExamples: boolean;
  /** M11 coverage, when available. Never recomputed here (spec §20). */
  coverage: CoverageReport | undefined;
  /** M11 drift, when available. Never recomputed here (spec §20). */
  drift: DriftReport | undefined;
  /** Opt-in only — see DocMetadata.generatedAt and spec §33. */
  generatedAt: string | undefined;
}

/**
 * Resolves the `auto` grouping mode against what the sources actually offer
 * (spec §28).
 *
 * Precedence: OpenAPI tags when an OpenAPI source contributed, otherwise
 * collection folders. Stated here in one place rather than being implied by
 * the order of a few `if`s in two generators.
 */
function resolveGrouping(
  grouping: DocGroupingMode,
  hasOpenApi: boolean,
): { byTag: boolean; byFolder: boolean } {
  if (grouping === "none") return { byTag: false, byFolder: false };
  if (grouping === "tag") return { byTag: true, byFolder: false };
  if (grouping === "folder") return { byTag: false, byFolder: true };
  return { byTag: hasOpenApi, byFolder: !hasOpenApi };
}

export function generateDocumentation(input: GenerateDocumentationInput): GenerationResult {
  const hasSpec = input.specificationSource !== undefined && input.specificationSource.trim() !== "";
  const hasCollection = input.collection !== undefined && input.collection.requests.length > 0;

  if (!hasSpec && !hasCollection) {
    return {
      ok: false,
      reason: "no-source",
      detail: "Select an OpenAPI specification, a collection, or both.",
    };
  }

  const grouping = resolveGrouping(input.grouping, hasSpec);

  // --- Collection-only --------------------------------------------------
  if (!hasSpec) {
    return {
      ok: true,
      documentation: withMetrics(
        generateFromCollection(input.collection as DocCollectionSource, {
          groupByFolder: grouping.byFolder,
          includeExamples: input.includeCollectionExamples,
          // No specification, so nothing declares a server base path.
          serverBasePaths: [],
          generatedAt: input.generatedAt,
        }),
        input.coverage,
        input.drift,
      ),
    };
  }

  // --- OpenAPI (possibly combined) --------------------------------------
  const source = parseSpecSource(input.specificationSource as string);
  if (!source.ok) {
    return { ok: false, reason: "invalid-source", detail: source.detail };
  }

  let contract;
  try {
    const built = buildContractModel(source.raw);
    if (!built.ok) return { ok: false, reason: "invalid-source", detail: built.detail };
    contract = built.contract;
  } catch {
    // Same defence parseContract applies: a deeply nested document can
    // exhaust the stack during normalization, and a RangeError is not
    // something a Zod boundary catches.
    return {
      ok: false,
      reason: "invalid-source",
      detail: "The specification could not be processed — it may be too deeply nested.",
    };
  }

  const docMetadata = extractOpenApiDocMetadata(source.raw);

  const openApiDocumentation = generateFromOpenApi(contract, docMetadata, {
    groupByTags: grouping.byTag,
    generatedAt: input.generatedAt,
  });

  if (!hasCollection) {
    return { ok: true, documentation: withMetrics(openApiDocumentation, input.coverage, input.drift) };
  }

  const collectionDocumentation = generateFromCollection(input.collection as DocCollectionSource, {
    groupByFolder: false,
    includeExamples: input.includeCollectionExamples,
    // The specification's servers, so a saved request against
    // `https://host/v1/orders` reduces to `/orders` and pairs with the
    // operation the specification documents.
    serverBasePaths: contract.servers,
    generatedAt: input.generatedAt,
  });

  return {
    ok: true,
    documentation: combineDocumentation(openApiDocumentation, collectionDocumentation, {
      coverage: input.coverage,
      drift: input.drift,
      includeUndocumentedEndpoints: true,
    }),
  };
}

/**
 * Attaches coverage and drift to a single-source model.
 *
 * These are *read* from Milestone 11's reports and never recomputed here —
 * spec §20 requires that documentation generation not mutate contract state,
 * and recomputing would additionally mean two implementations of coverage
 * that could disagree about the same collection.
 */
function withMetrics(
  documentation: Documentation,
  coverage: CoverageReport | undefined,
  drift: DriftReport | undefined,
): Documentation {
  if (coverage === undefined && drift === undefined) return documentation;
  return {
    ...documentation,
    coverage: coverage === undefined ? undefined : toDocCoverage(coverage),
    drift: drift === undefined ? undefined : toDocDrift(drift),
  };
}
