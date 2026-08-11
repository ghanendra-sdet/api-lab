import type { Assertion } from "@api-lab/test-engine";
import { resolveVariables } from "@api-lab/environment-engine";

/**
 * Resolves {{variables}} inside an assertion's `expected`/`key` fields
 * against the merged execution context (environment/runtime/iteration) —
 * the same composition pattern as `resolveAuthConfig`. An unresolved
 * reference is left as literal `{{name}}` text (not blocked): unlike the
 * URL/auth, a stray unresolved assertion value naturally fails the
 * assertion's comparison rather than needing to block the send outright.
 */
export function resolveAssertions(assertions: Assertion[], context: Record<string, string>): Assertion[] {
  return assertions.map((assertion) => ({
    ...assertion,
    expected: resolveVariables(assertion.expected, context).value,
    key: assertion.key !== undefined ? resolveVariables(assertion.key, context).value : assertion.key,
  }));
}
