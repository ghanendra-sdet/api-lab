/**
 * A serializable, non-executable assertion definition. Deliberately a
 * closed set of (target, operator) combinations rather than a free-form
 * expression language — see docs/SECURITY.md's Milestone 7 section for why
 * "no arbitrary code execution through assertion expressions" is a hard
 * requirement, not just a style preference. `expected`/`key` are always
 * plain strings; they may contain `{{variable}}` references, resolved the
 * same way the URL/headers/body already are (see apps/web's
 * resolveAssertions bridge), but are never interpreted as code.
 */
export const ASSERTION_TARGETS = ["status", "statusRange", "header", "body", "json", "responseTime", "responseSize"] as const;
export type AssertionTarget = (typeof ASSERTION_TARGETS)[number];

export const ASSERTION_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "exists",
  "notExists",
  "greaterThan",
  "lessThan",
  "greaterThanOrEqual",
  "lessThanOrEqual",
  "matches",
] as const;
export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number];

export interface Assertion {
  id: string;
  target: AssertionTarget;
  operator: AssertionOperator;
  /** Header name (target "header") or JSONPath (target "json"). Unused otherwise. */
  key?: string;
  /** Always a plain string — including for numeric/status comparisons,
   * parsed at evaluation time. May contain {{variables}}. */
  expected: string;
  enabled: boolean;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  /** Human-readable actual value, for display — never the raw response object. */
  actual: string;
  /** Human-readable expected value, post variable-resolution. */
  expected: string;
  message: string;
  /** Set when the assertion couldn't be evaluated at all (e.g. invalid JSON
   * path syntax) — distinct from a normal pass/fail. */
  error?: string;
}

export type TestStatus = "passed" | "failed" | "error" | "skipped";

export interface TestResult {
  requestId: string;
  requestName: string;
  status: TestStatus;
  duration: number;
  assertions: AssertionResult[];
  error?: string;
}

/** The operators that make sense for a given target — the assertion
 * builder UI uses this to avoid offering nonsensical combinations (e.g.
 * "header greaterThan"). */
export const OPERATORS_BY_TARGET: Record<AssertionTarget, AssertionOperator[]> = {
  status: ["equals", "notEquals", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"],
  statusRange: ["equals"],
  header: ["exists", "notExists", "equals", "notEquals", "contains", "notContains"],
  body: ["contains", "notContains", "equals", "notEquals", "exists", "notExists", "matches"],
  json: ["exists", "notExists", "equals", "notEquals", "contains", "notContains", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"],
  responseTime: ["equals", "notEquals", "lessThan", "lessThanOrEqual", "greaterThan", "greaterThanOrEqual"],
  responseSize: ["equals", "notEquals", "lessThan", "lessThanOrEqual", "greaterThan", "greaterThanOrEqual"],
};
