import { extractRequestPath, parsePathTemplate, resolveOperation, splitPath } from "./operationMatch.ts";
import type {
  CollectionEndpoint,
  ContractModel,
  ContractOperation,
  DriftEntry,
  DriftReport,
} from "./types.ts";

/**
 * Contract drift detection (spec §34–§36).
 *
 * Compares an API Lab collection against an OpenAPI specification and reports
 * where the two have diverged. This is deliberately a *structural* comparison
 * only: it answers "does this operation exist on both sides, with compatible
 * parameters", and never tries to infer whether two differently-named
 * endpoints mean the same thing. Spec §34 explicitly rules out inferring
 * business semantics, and a tool that guessed would produce drift reports
 * nobody could trust.
 *
 * ## Severity rules (spec §36)
 *
 * Severity is deterministic and documented, not a judgement call:
 *
 * - **error** — the two sides disagree about what exists or what is required.
 *   A request with no matching operation, an operation with no request, a
 *   missing required parameter, a request body required by one side only.
 *   Each of these means a contract test would fail or an endpoint is
 *   unexercised.
 * - **warning** — a difference that cannot break a call: an extra parameter
 *   the collection sends that the specification does not document (servers
 *   routinely ignore unknown query parameters).
 *
 * Descriptions, summaries, and examples are not compared at all. Spec §36 is
 * explicit that cosmetic differences must not be marked as breaking changes,
 * and the cheapest way to guarantee that is to never look at them.
 */

/** Extracts `{{variable}}`-tolerant path segments from a collection URL. */
function collectionPath(endpoint: CollectionEndpoint, contract: ContractModel): string {
  return extractRequestPath(endpoint.url, contract.servers);
}

/**
 * A collection URL frequently contains a concrete value (`/users/123`) or an
 * API Lab variable (`/users/{{userId}}`) where the specification has a
 * template (`/users/{id}`). Both must match the same operation, so a variable
 * segment is treated exactly like a concrete one: as "some value".
 */
function pathMatchesTemplate(template: string, actualPath: string): boolean {
  const templateSegments = parsePathTemplate(template);
  const actualSegments = splitPath(actualPath);
  if (templateSegments.length !== actualSegments.length) return false;

  return templateSegments.every((segment, index) => {
    if (segment.isTemplate) return true;
    const actual = actualSegments[index]!;
    // A variable in the collection could resolve to anything, including
    // this literal, so it cannot be declared a mismatch.
    if (actual.includes("{{")) return true;
    return segment.value === actual;
  });
}

function findOperationFor(contract: ContractModel, endpoint: CollectionEndpoint): ContractOperation | undefined {
  const path = collectionPath(endpoint, contract);

  // Reuse the real resolver first so specificity and ambiguity behave
  // identically to live validation.
  const resolved = resolveOperation(contract, endpoint.method, path);
  if (resolved.status === "matched") return resolved.operation;

  // Fall back to the variable-tolerant comparison for URLs holding
  // `{{placeholders}}`, which the strict resolver treats as literals.
  return contract.operations.find(
    (operation) => operation.method === endpoint.method && pathMatchesTemplate(operation.path, path),
  );
}

/** Compares parameters between a collection request and its matched operation. */
function parameterDrift(
  operation: ContractOperation,
  endpoint: CollectionEndpoint,
  queryParameterNames: string[],
): DriftEntry[] {
  const entries: DriftEntry[] = [];
  const sent = new Set(queryParameterNames);

  for (const parameter of operation.parameters) {
    if (parameter.location !== "query" || !parameter.required) continue;
    if (sent.has(parameter.name)) continue;
    entries.push({
      kind: "parameter-mismatch",
      severity: "error",
      method: operation.method,
      path: operation.path,
      operationId: operation.operationId,
      requestId: endpoint.id,
      requestName: endpoint.name,
      reason: `Required query parameter "${parameter.name}" is documented in the specification but not present in the collection request.`,
    });
  }

  const documented = new Set(
    operation.parameters.filter((parameter) => parameter.location === "query").map((parameter) => parameter.name),
  );
  for (const name of sent) {
    if (documented.has(name)) continue;
    entries.push({
      kind: "parameter-mismatch",
      severity: "warning",
      method: operation.method,
      path: operation.path,
      operationId: operation.operationId,
      requestId: endpoint.id,
      requestName: endpoint.name,
      reason: `Query parameter "${name}" is sent by the collection request but is not documented in the specification.`,
    });
  }

  return entries;
}

export interface DriftInputEndpoint extends CollectionEndpoint {
  /** Enabled query parameter names on the saved request. */
  queryParameterNames: string[];
  /** Whether the saved request sends a body. */
  hasBody: boolean;
}

export function detectDrift(contract: ContractModel, endpoints: DriftInputEndpoint[]): DriftReport {
  const entries: DriftEntry[] = [];
  const matchedOperationIds = new Set<string>();

  for (const endpoint of endpoints) {
    const operation = findOperationFor(contract, endpoint);

    if (!operation) {
      entries.push({
        kind: "missing-from-spec",
        severity: "error",
        method: endpoint.method,
        path: collectionPath(endpoint, contract),
        operationId: undefined,
        requestId: endpoint.id,
        requestName: endpoint.name,
        reason: "Request exists in collection, missing from specification.",
      });
      continue;
    }

    matchedOperationIds.add(operation.id);

    entries.push({
      kind: "matched",
      severity: "warning", // Never surfaced as a problem; kind drives display.
      method: operation.method,
      path: operation.path,
      operationId: operation.operationId,
      requestId: endpoint.id,
      requestName: endpoint.name,
      reason: "Request matches a documented operation.",
    });

    entries.push(...parameterDrift(operation, endpoint, endpoint.queryParameterNames));

    const requiresBody = operation.requestBody?.required === true;
    if (requiresBody && !endpoint.hasBody) {
      entries.push({
        kind: "request-body-mismatch",
        severity: "error",
        method: operation.method,
        path: operation.path,
        operationId: operation.operationId,
        requestId: endpoint.id,
        requestName: endpoint.name,
        reason: "The specification requires a request body for this operation, but the collection request sends none.",
      });
    }
    if (!operation.requestBody && endpoint.hasBody) {
      entries.push({
        kind: "request-body-mismatch",
        severity: "warning",
        method: operation.method,
        path: operation.path,
        operationId: operation.operationId,
        requestId: endpoint.id,
        requestName: endpoint.name,
        reason: "The collection request sends a body, but the specification documents no request body for this operation.",
      });
    }
  }

  for (const operation of contract.operations) {
    if (matchedOperationIds.has(operation.id)) continue;
    entries.push({
      kind: "missing-from-collection",
      severity: "error",
      method: operation.method,
      path: operation.path,
      operationId: operation.operationId,
      requestId: undefined,
      requestName: undefined,
      reason: "Operation exists in specification, missing from collection.",
    });
  }

  return {
    entries,
    matched: entries.filter((entry) => entry.kind === "matched").length,
    missingFromSpec: entries.filter((entry) => entry.kind === "missing-from-spec").length,
    missingFromCollection: entries.filter((entry) => entry.kind === "missing-from-collection").length,
    mismatched: entries.filter(
      (entry) => entry.kind === "parameter-mismatch" || entry.kind === "request-body-mismatch",
    ).length,
  };
}

/** Filter options exposed by the drift report UI (spec §35). */
export const DRIFT_FILTERS = ["all", "missing-from-spec", "missing-from-collection", "changed"] as const;
export type DriftFilter = (typeof DRIFT_FILTERS)[number];

export function filterDrift(report: DriftReport, filter: DriftFilter): DriftEntry[] {
  if (filter === "all") return report.entries;
  if (filter === "changed") {
    return report.entries.filter(
      (entry) => entry.kind === "parameter-mismatch" || entry.kind === "request-body-mismatch",
    );
  }
  return report.entries.filter((entry) => entry.kind === filter);
}
