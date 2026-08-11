import { isFolder, isRequest, type Collection, type RequestConfig, type RequestLocation } from "@api-lab/workspace-engine";
import type { ApiResponseResult, ValidationError } from "@api-lab/request-engine";
import type { TestResult } from "@api-lab/test-engine";
import type { ExtractionResult } from "@api-lab/runner-engine";

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

export type RunnerItemStatus = "pending" | "running" | "passed" | "failed" | "error" | "skipped" | "cancelled";

export interface RunnerItemResult {
  requestId: string;
  name: string;
  status: RunnerItemStatus;
  response?: ApiResponseResult;
  testResult?: TestResult;
  validationError?: ValidationError;
  extractionResults?: ExtractionResult[];
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
  environmentId: string | null;
  stopOnFailure: boolean;
  datasetName: string | null;
  iterations: RunnerIterationResult[];
  startedAt?: number;
  durationMs?: number;
}

export function createIdleRunnerState(): RunnerState {
  return {
    status: "idle",
    collectionId: null,
    environmentId: null,
    stopOnFailure: true,
    datasetName: null,
    iterations: [],
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
      else if (item.status === "failed") failed += 1;
      else if (item.status === "error") errors += 1;
      else if (item.status === "skipped" || item.status === "cancelled" || item.status === "pending") skipped += 1;
    }
  }
  return { passed, failed, errors, skipped, total, iterations: state.iterations.length };
}
