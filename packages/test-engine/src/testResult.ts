import type { AssertionResult, TestResult, TestStatus } from "./types.ts";

export function deriveTestStatus(assertionResults: AssertionResult[], executionError: string | undefined): TestStatus {
  if (executionError) return "error";
  if (assertionResults.length === 0) return "skipped";
  return assertionResults.every((r) => r.passed) ? "passed" : "failed";
}

export function buildTestResult(
  requestId: string,
  requestName: string,
  duration: number,
  assertionResults: AssertionResult[],
  executionError?: string,
): TestResult {
  return {
    requestId,
    requestName,
    status: deriveTestStatus(assertionResults, executionError),
    duration,
    assertions: assertionResults,
    error: executionError,
  };
}
