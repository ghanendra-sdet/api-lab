import type { CoverageReport, DriftReport } from "@api-lab/contract-engine";
import type {
  DocCoverage,
  DocDrift,
  DocEndpoint,
  DocExample,
  Documentation,
} from "../types.ts";

/**
 * Source precedence: OpenAPI + Collection (spec §5).
 *
 * ## The rule, stated once
 *
 * > **The contract defines. The collection illustrates.**
 *
 * Concretely, when both sources describe the same operation:
 *
 * | Information                          | Winner     | Why |
 * | ------------------------------------ | ---------- | --- |
 * | Which operations exist               | OpenAPI    | The spec is the API's stated surface. |
 * | Parameters, types, required flags    | OpenAPI    | A collection cannot know that a field is required — it only knows one person sent it. |
 * | Request/response schemas             | OpenAPI    | Same. |
 * | Documented status codes              | OpenAPI    | Same. |
 * | Summary / description                | OpenAPI, collection as fallback | A spec description is authored for readers; a request *name* is a label. |
 * | Concrete request examples            | Collection | A real sent request beats a hand-written one. |
 * | Concrete response examples           | Collection | Same. |
 * | Endpoints absent from the spec       | Collection, clearly labelled | Dropping them would hide drift. |
 *
 * Spec §5 puts it as: do not overwrite contract definitions with arbitrary
 * collection data. The implementation is stricter than that sentence — the
 * merge below can only *add* examples to a contract-derived endpoint and can
 * only *fill* an absent description. There is no code path in which a
 * collection value replaces a contract value that exists, which means the
 * rule cannot be eroded by a later change without deleting an explicit
 * comment first.
 *
 * ## Endpoints the specification does not document
 *
 * These are kept, not discarded, and marked `contract.inSpecification: false`.
 * A collection request with no matching operation is one of the most useful
 * things this tool can tell a team — it is either an undocumented endpoint or
 * a stale request — and silently dropping it would turn documentation
 * generation into a way of hiding drift rather than surfacing it (spec §22).
 */

/** Endpoint identity for merging: method plus path, normalized. */
function mergeKey(endpoint: DocEndpoint): string {
  return `${endpoint.method} ${normalizePath(endpoint.path)}`;
}

/**
 * Reduces a path to a comparable shape.
 *
 * `/users/{id}` (OpenAPI) and `/users/{{userId}}` (collection) name the same
 * endpoint under different templating conventions, and a literal comparison
 * would treat them as two. Both template forms collapse to a single `{}`
 * placeholder so they match, while a genuinely different path still differs.
 *
 * This is deliberately simpler than contract-engine's `operationMatch`, which
 * resolves a *concrete* request URL against templated spec paths — a harder
 * problem involving ambiguity resolution. Here both sides are already
 * templates, so a normalization is sufficient and an ambiguity cannot arise.
 */
function normalizePath(path: string): string {
  const collapsed = path
    .replace(/\{\{[^{}]*\}\}/g, "{}")
    .replace(/\{[^{}]*\}/g, "{}")
    .replace(/\/+$/, "");
  return collapsed === "" ? "/" : collapsed;
}

/**
 * Merges collection examples into a contract-derived endpoint.
 *
 * Contract examples come first — they are the authored, canonical ones — and
 * collection examples follow, each keeping its own provenance label so a
 * reader can see which is which.
 */
function mergeExamples(contractExamples: DocExample[], collectionExamples: DocExample[]): DocExample[] {
  const seen = new Set(contractExamples.map((example) => `${example.kind}:${example.body ?? ""}`));
  const additional = collectionExamples.filter(
    (example) => !seen.has(`${example.kind}:${example.body ?? ""}`),
  );
  return [...contractExamples, ...additional];
}

export interface CombineOptions {
  coverage: CoverageReport | undefined;
  drift: DriftReport | undefined;
  /** When true, endpoints found only in the collection are documented too. */
  includeUndocumentedEndpoints: boolean;
}

/**
 * Combines an OpenAPI-derived documentation model with a collection-derived
 * one, applying the precedence above.
 *
 * Both inputs are already complete, valid documentation models. That is
 * deliberate: it means the combined path shares every code path the
 * single-source paths use, so an endpoint page cannot render differently
 * depending on how it was produced, and the single-source tests cover the
 * combined case's internals for free.
 */
export function combineDocumentation(
  fromOpenApi: Documentation,
  fromCollection: Documentation,
  options: CombineOptions,
): Documentation {
  const collectionByKey = new Map<string, DocEndpoint>();
  for (const group of fromCollection.groups) {
    for (const endpoint of group.endpoints) {
      // First writer wins: two saved requests against one operation is common
      // (a success case and an error case), and the first is as good a
      // representative as any. Deterministic because collection order is.
      if (!collectionByKey.has(mergeKey(endpoint))) {
        collectionByKey.set(mergeKey(endpoint), endpoint);
      }
    }
  }

  const matchedKeys = new Set<string>();

  const groups = fromOpenApi.groups.map((group) => ({
    ...group,
    endpoints: group.endpoints.map((endpoint): DocEndpoint => {
      const key = mergeKey(endpoint);
      const counterpart = collectionByKey.get(key);
      if (counterpart === undefined) {
        return {
          ...endpoint,
          contract: {
            inSpecification: true,
            inCollection: false,
            alignment: "missing-from-collection",
            detail: "Documented in the specification, but no saved request exercises it.",
          },
        };
      }

      matchedKeys.add(key);

      return {
        ...endpoint,
        // Fill-only, never replace. See the module comment.
        summary: endpoint.summary ?? counterpart.summary,
        description: endpoint.description ?? counterpart.description,
        examples: mergeExamples(endpoint.examples, counterpart.examples),
        contract: {
          inSpecification: true,
          inCollection: true,
          alignment: "aligned",
          detail: undefined,
        },
      };
    }),
  }));

  // Endpoints only the collection knows about.
  if (options.includeUndocumentedEndpoints) {
    const undocumented: DocEndpoint[] = [];
    for (const [key, endpoint] of collectionByKey) {
      if (matchedKeys.has(key)) continue;
      undocumented.push({
        ...endpoint,
        contract: {
          inSpecification: false,
          inCollection: true,
          alignment: "missing-from-spec",
          detail: "Present in the collection but not documented in the specification.",
        },
      });
    }

    if (undocumented.length > 0) {
      groups.push({
        name: "Not in specification",
        description:
          "Saved requests with no matching operation in the OpenAPI specification. These are observations, not contract.",
        source: "default",
        endpoints: undocumented.sort((a, b) => a.id.localeCompare(b.id)),
      });
    }
  }

  const endpointCount = groups.reduce((total, group) => total + group.endpoints.length, 0);

  return {
    // The specification's identity wins — it is the authored one.
    title: fromOpenApi.title,
    description: fromOpenApi.description ?? fromCollection.description,
    version: fromOpenApi.version,
    servers: fromOpenApi.servers.length > 0 ? fromOpenApi.servers : fromCollection.servers,
    authentication: fromOpenApi.authentication,
    groups,
    schemas: fromOpenApi.schemas,
    coverage: options.coverage === undefined ? undefined : toDocCoverage(options.coverage),
    drift: options.drift === undefined ? undefined : toDocDrift(options.drift),
    metadata: {
      sources: ["openapi", "collection"],
      openapiVersion: fromOpenApi.metadata.openapiVersion,
      endpointCount,
      schemaCount: fromOpenApi.metadata.schemaCount,
      warnings: [...new Set([...fromOpenApi.metadata.warnings, ...fromCollection.metadata.warnings])],
      generatedAt: fromOpenApi.metadata.generatedAt,
    },
  };
}

/**
 * Adapts M11's `CoverageReport` for documentation (spec §21).
 *
 * The `uncovered` operation list is deliberately dropped. It is a QA working
 * list, useful in the Contract dialog where somebody is deciding what to test
 * next, and out of place in published API documentation — a reader of the
 * docs does not need to know which endpoints this team has not got round to.
 */
export function toDocCoverage(coverage: CoverageReport): DocCoverage {
  return {
    totalOperations: coverage.totalOperations,
    coveredOperations: coverage.coveredOperations,
    operationCoveragePercent: coverage.operationCoveragePercent,
    validatedOperations: coverage.validatedOperations,
    validationCoveragePercent: coverage.validationCoveragePercent,
  };
}

/** Adapts M11's `DriftReport` for documentation (spec §22). */
export function toDocDrift(drift: DriftReport): DocDrift {
  return {
    matched: drift.matched,
    missingFromSpec: drift.missingFromSpec,
    missingFromCollection: drift.missingFromCollection,
    mismatched: drift.mismatched,
    entries: drift.entries
      .filter((entry) => entry.kind !== "matched")
      .map((entry) => ({
        method: entry.method,
        path: entry.path,
        alignment: entry.kind,
        detail: entry.reason,
      }))
      // Sorted for determinism (spec §33).
      .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`)),
  };
}
