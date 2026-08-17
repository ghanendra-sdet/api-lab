import { isFolder, isRequest, type Collection, type RequestConfig, type RequestLocation } from "@api-lab/workspace-engine";
import type { ApiResponseResult, ValidationError } from "@api-lab/request-engine";
import type { TestResult } from "@api-lab/test-engine";
import type { ExtractionResult } from "@api-lab/runner-engine";
import type { ContractValidationResult } from "@api-lab/contract-engine";
import type { SecurityTestResult } from "@api-lab/security-engine";

export interface RunnableRequest {
  id: string;
  name: string;
  location: RequestLocation;
  request: RequestConfig;
}

/** Flattens a collection's requests (top-level and one folder deep) in
 * collection/folder order — the Runner's execution order matches display
 * order exactly, with no separate sequencing concept to keep in sync. */
export function flattenCollectionRequests(collection: Collection): RunnableRequest[] {
  const result: RunnableRequest[] = [];
  for (const item of collection.items) {
    if (isFolder(item)) {
      for (const request of item.items) {
        result.push({
          id: request.id,
          name: request.name,
          location: { collectionId: collection.id, folderId: item.id },
          request: request.request,
        });
      }
    } else if (isRequest(item)) {
      result.push({ id: item.id, name: item.name, location: { collectionId: collection.id }, request: item.request });
    }
  }
  return result;
}

/**
 * `contract-failed` (Milestone 11) is a distinct status, not a flavour of
 * `failed`. Spec §29 requires contract failures to appear separately from
 * ordinary assertion failures rather than being collapsed into one ambiguous
 * reason — a request whose assertions all passed but whose response broke
 * the contract is a genuinely different result from one whose assertions
 * failed, and the Runner has to be able to say which happened.
 */
export type RunnerItemStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "error"
  | "contract-failed"
  | "skipped"
  | "cancelled";

export interface RunnerItemResult {
  requestId: string;
  name: string;
  status: RunnerItemStatus;
  response?: ApiResponseResult;
  testResult?: TestResult;
  validationError?: ValidationError;
  extractionResults?: ExtractionResult[];
  /** Present only when the run had contract validation enabled. */
  contractResult?: ContractValidationResult;
}

/** One pass through the collection's requests — either the single implicit
 * iteration of a dataset-less run, or one row of an imported dataset. Each
 * iteration gets a fresh runtime-variable map (extractions from one
 * iteration never leak into the next), so a failed extraction in iteration
 * 2 can never accidentally read a stale value from iteration 1. */
export interface RunnerIterationResult {
  index: number;
  /** The dataset row this iteration ran with — empty for a dataset-less run. */
  data: Record<string, string>;
  items: RunnerItemResult[];
}

export type RunnerStatus = "idle" | "running" | "completed" | "cancelled";

export interface RunnerState {
  status: RunnerStatus;
  collectionId: string | null;
  folderId?: string | null;
  environmentId: string | null;
  stopOnFailure: boolean;
  datasetName: string | null;
  /** Whether this run validated responses against a contract (spec §29). */
  validateContract: boolean;
  iterations: RunnerIterationResult[];
  startedAt?: number;
  durationMs?: number;
  delayMs?: number;
}

export function createIdleRunnerState(): RunnerState {
  return {
    status: "idle",
    collectionId: null,
    folderId: null,
    environmentId: null,
    stopOnFailure: true,
    datasetName: null,
    validateContract: false,
    iterations: [],
    delayMs: 0,
  };
}

export function summarizeRunner(
  state: RunnerState,
): { passed: number; failed: number; errors: number; skipped: number; total: number; iterations: number } {
  let passed = 0;
  let failed = 0;
  let errors = 0;
  let skipped = 0;
  let total = 0;
  for (const iteration of state.iterations) {
    for (const item of iteration.items) {
      total += 1;
      if (item.status === "passed") passed += 1;
      // A contract failure counts in the `failed` total — the run did not
      // pass — while remaining distinguishable via the contract summary
      // below and the per-item status.
      else if (item.status === "failed" || item.status === "contract-failed") failed += 1;
      else if (item.status === "error") errors += 1;
      else if (item.status === "skipped" || item.status === "cancelled" || item.status === "pending") skipped += 1;
    }
  }
  return { passed, failed, errors, skipped, total, iterations: state.iterations.length };
}

export interface RunnerContractSummary {
  /** Requests whose contract validation ran and produced no violations. */
  passed: number;
  /** Requests with at least one contract violation. */
  failed: number;
  /** Total contract warnings across the run — never folded into passed. */
  warnings: number;
  /** Requests for which contract validation actually ran. */
  validated: number;
}

/**
 * The Runner's contract summary block (spec §30), reported alongside — never
 * merged into — the assertion summary above.
 */
export function summarizeRunnerContract(state: RunnerState): RunnerContractSummary {
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let validated = 0;

  for (const iteration of state.iterations) {
    for (const item of iteration.items) {
      const result = item.contractResult;
      if (!result) continue;
      validated += 1;
      warnings += result.warnings.length;
      if (result.valid) passed += 1;
      else failed += 1;
    }
  }

  return { passed, failed, warnings, validated };
}

/**
 * Per-category result counts for the Runner (Milestone 12, spec §22, §32).
 *
 * Before Milestone 12 the Runner reported one pass/fail total and a separate
 * contract block. With security and negative tests able to execute as part of
 * a collection run, a single total stops meaning anything: "34 passed, 6
 * failed" cannot tell a reader whether the six were broken assertions, broken
 * contracts, or an endpoint that accepted a request with no credential —
 * three findings with three different owners and three different urgencies.
 *
 * So every category is counted separately and displayed separately. They are
 * never summed into a headline number, because the sum would be the least
 * informative figure available.
 */
export interface RunnerCategoryCounts {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
}

export type RunnerCategorySummary = Record<"functional" | "contract" | "security" | "negative", RunnerCategoryCounts>;

function emptyCounts(): RunnerCategoryCounts {
  return { total: 0, passed: 0, failed: 0, warnings: 0 };
}

export function summarizeRunnerCategories(
  state: RunnerState,
  securityResults: SecurityTestResult[],
): RunnerCategorySummary {
  const summary: RunnerCategorySummary = {
    functional: emptyCounts(),
    contract: emptyCounts(),
    security: emptyCounts(),
    negative: emptyCounts(),
  };

  for (const iteration of state.iterations) {
    for (const item of iteration.items) {
      // Functional: the request's own assertions. A contract failure is not
      // counted as a functional failure here — it gets its own row.
      summary.functional.total += 1;
      if (item.status === "passed") summary.functional.passed += 1;
      else if (item.status === "failed" || item.status === "error") summary.functional.failed += 1;

      if (item.contractResult) {
        summary.contract.total += 1;
        if (item.contractResult.valid) summary.contract.passed += 1;
        else summary.contract.failed += 1;
        summary.contract.warnings += item.contractResult.warnings.length;
      }
    }
  }

  for (const result of securityResults) {
    // The engine already tags every result with its category, so the split
    // between "security" and "negative" comes from the generator's intent
    // rather than from a guess made here.
    const bucket = result.category === "security" ? summary.security : summary.negative;
    bucket.total += 1;
    if (result.status === "passed") bucket.passed += 1;
    else if (result.status === "failed" || result.status === "error") bucket.failed += 1;
    else if (result.status === "warning") bucket.warnings += 1;
  }

  return summary;
}
