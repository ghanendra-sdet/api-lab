import type { ApiResponseResult } from "@api-lab/request-engine";
import { evaluateJsonPath } from "./jsonPath.ts";
import type { Assertion, AssertionOperator, AssertionResult } from "./types.ts";

function compareNumeric(actual: number, operator: AssertionOperator, expected: number): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "notEquals":
      return actual !== expected;
    case "greaterThan":
      return actual > expected;
    case "lessThan":
      return actual < expected;
    case "greaterThanOrEqual":
      return actual >= expected;
    case "lessThanOrEqual":
      return actual <= expected;
    default:
      return false;
  }
}

function compareString(actual: string, operator: AssertionOperator, expected: string): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "notEquals":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    case "notContains":
      return !actual.includes(expected);
    case "matches":
      // Native RegExp — never `eval`, but a pathological user-authored
      // pattern can still be slow to evaluate (ReDoS-class risk, the same
      // class any app accepting a user regex has). Not mitigated this
      // milestone; see docs/SECURITY.md's Milestone 7 section.
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function truncate(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function jsonValueToString(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function result(assertion: Assertion, passed: boolean, actual: string, expected: string): AssertionResult {
  return {
    assertion,
    passed,
    actual,
    expected,
    message: `${describeAssertion(assertion)} — ${passed ? "passed" : `expected ${expected}, got ${actual}`}`,
  };
}

function errorResult(assertion: Assertion, detail: string): AssertionResult {
  return {
    assertion,
    passed: false,
    actual: "",
    expected: assertion.expected,
    message: `${describeAssertion(assertion)} — could not be evaluated`,
    error: detail,
  };
}

function describeAssertion(assertion: Assertion): string {
  const target = assertion.key ? `${assertion.target} "${assertion.key}"` : assertion.target;
  return `${target} ${assertion.operator}`;
}

/**
 * Pure evaluation of one assertion against an already-normalized response.
 * Never mutates the response. `assertion.expected`/`assertion.key` are
 * expected to already be variable-resolved by the caller (see
 * apps/web/src/lib/resolveAssertions.ts) — this function treats them as
 * plain, final strings.
 */
export function evaluateAssertion(assertion: Assertion, response: ApiResponseResult): AssertionResult {
  try {
    switch (assertion.target) {
      case "status": {
        const actualNum = response.status ?? -1;
        const expectedNum = Number(assertion.expected);
        if (Number.isNaN(expectedNum)) return errorResult(assertion, "Expected value is not a number.");
        return result(assertion, compareNumeric(actualNum, assertion.operator, expectedNum), String(actualNum), assertion.expected);
      }

      case "statusRange": {
        const actualNum = response.status ?? -1;
        const rangeLabel = actualNum >= 0 ? `${Math.floor(actualNum / 100)}xx` : "unknown";
        return result(assertion, rangeLabel === assertion.expected, rangeLabel, assertion.expected);
      }

      case "header": {
        const wantedKey = (assertion.key ?? "").toLowerCase();
        const found = Object.entries(response.headers).find(([k]) => k.toLowerCase() === wantedKey);
        if (assertion.operator === "exists") {
          return result(assertion, found !== undefined, found ? found[1] : "(missing)", "exists");
        }
        if (assertion.operator === "notExists") {
          return result(assertion, found === undefined, found ? found[1] : "(missing)", "does not exist");
        }
        if (!found) return result(assertion, false, "(missing)", assertion.expected);
        return result(assertion, compareString(found[1], assertion.operator, assertion.expected), found[1], assertion.expected);
      }

      case "body": {
        const actual = response.rawBody ?? "";
        if (assertion.operator === "exists") {
          return result(assertion, actual.length > 0, actual.length > 0 ? "(non-empty)" : "(empty)", "non-empty");
        }
        if (assertion.operator === "notExists") {
          return result(assertion, actual.length === 0, actual.length > 0 ? "(non-empty)" : "(empty)", "empty");
        }
        return result(assertion, compareString(actual, assertion.operator, assertion.expected), truncate(actual), assertion.expected);
      }

      case "json": {
        if (response.bodyKind !== "json") {
          return errorResult(assertion, "Response body is not JSON.");
        }
        const path = assertion.key && assertion.key.trim() !== "" ? assertion.key : "$";
        const pathResult = evaluateJsonPath(path, response.body);
        if (!pathResult.ok) return errorResult(assertion, pathResult.detail);
        if (assertion.operator === "exists") {
          return result(assertion, pathResult.found, pathResult.found ? "(present)" : "(missing)", "exists");
        }
        if (assertion.operator === "notExists") {
          return result(assertion, !pathResult.found, pathResult.found ? "(present)" : "(missing)", "does not exist");
        }
        if (!pathResult.found) return result(assertion, false, "(missing)", assertion.expected);
        const actualStr = jsonValueToString(pathResult.value);
        const passed = assertion.operator === "contains" ? actualStr.includes(assertion.expected) : actualStr === assertion.expected;
        return result(assertion, passed, actualStr, assertion.expected);
      }

      case "responseTime": {
        const expectedNum = Number(assertion.expected);
        if (Number.isNaN(expectedNum)) return errorResult(assertion, "Expected value is not a number.");
        return result(assertion, compareNumeric(response.duration, assertion.operator, expectedNum), `${response.duration}ms`, `${assertion.expected}ms`);
      }

      case "responseSize": {
        if (response.size === null) return errorResult(assertion, "Response size is unknown for this response.");
        const expectedNum = Number(assertion.expected);
        if (Number.isNaN(expectedNum)) return errorResult(assertion, "Expected value is not a number.");
        return result(assertion, compareNumeric(response.size, assertion.operator, expectedNum), `${response.size} bytes`, `${assertion.expected} bytes`);
      }
    }
  } catch (err) {
    return errorResult(assertion, err instanceof Error ? err.message : "Assertion could not be evaluated.");
  }
}

/** Evaluates every enabled assertion and aggregates into a TestResult. */
export function evaluateAssertions(assertions: Assertion[], response: ApiResponseResult): AssertionResult[] {
  return assertions.filter((a) => a.enabled).map((a) => evaluateAssertion(a, response));
}
