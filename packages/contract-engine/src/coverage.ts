import type { ContractModel, CoverageReport, DriftReport } from "./types.ts";

/**
 * Contract coverage metrics (spec §37).
 *
 * ## What these numbers mean — and what they do not
 *
 * Neither figure is code coverage, and neither is presented as such
 * anywhere. Both are ratios over *documented operations*:
 *
 * - **Operation coverage** — of the operations the specification documents,
 *   how many does the collection contain a request for? Static; it says
 *   nothing about whether those requests were ever run.
 *
 * - **Contract test coverage** — of the operations the specification
 *   documents, how many have actually been contract-validated? Dynamic; it
 *   counts operations that a real request was sent to and validated against.
 *
 * Keeping them separate matters because they answer different questions. A
 * collection can have 100% operation coverage and 0% validation coverage
 * simply by never being run, and reporting a single blended "coverage"
 * number would hide exactly that.
 *
 * An operation is counted at most once no matter how many collection
 * requests or validation runs touch it, so neither figure can exceed 100%.
 */

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function computeCoverage(
  contract: ContractModel,
  drift: DriftReport,
  /** Ids (`"GET /users/{id}"`) of operations validated at least once. */
  validatedOperationIds: ReadonlySet<string>,
): CoverageReport {
  const totalOperations = contract.operations.length;

  const coveredIds = new Set<string>();
  for (const entry of drift.entries) {
    if (entry.kind !== "matched") continue;
    coveredIds.add(`${entry.method} ${entry.path}`);
  }

  // A validated operation is by definition covered, even if drift matching
  // did not pair it with a saved request (an unsaved ad-hoc request, say).
  const validatedAndDocumented = new Set<string>();
  for (const operation of contract.operations) {
    if (validatedOperationIds.has(operation.id)) {
      validatedAndDocumented.add(operation.id);
      coveredIds.add(operation.id);
    }
  }

  const uncovered = contract.operations
    .filter((operation) => !coveredIds.has(operation.id))
    .map((operation) => ({ method: operation.method, path: operation.path }));

  return {
    totalOperations,
    coveredOperations: coveredIds.size,
    operationCoveragePercent: percent(coveredIds.size, totalOperations),
    validatedOperations: validatedAndDocumented.size,
    validationCoveragePercent: percent(validatedAndDocumented.size, totalOperations),
    uncovered,
  };
}
