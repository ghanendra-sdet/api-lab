import { resolveVariables } from "@api-lab/environment-engine";
import type { PerfRequestSpec } from "./types.ts";

/**
 * Per-virtual-user runtime variable substitution (spec §14, §15).
 *
 * Environment and dataset variables are already resolved by the browser
 * before the run starts. What remains in a `PerfRequestSpec` are the
 * *runtime* `{{variables}}` produced by extractions earlier in the same
 * virtual user's own iteration — a chained login token, for example.
 *
 * The isolation guarantee is structural: this function is pure and takes
 * the runtime map as an argument. Each virtual user owns its own map,
 * created fresh per iteration inside the worker's VU loop, and no shared
 * mutable object exists for one VU's token to leak into another VU's
 * request. Reusing `resolveVariables` (rather than writing a second
 * substitution routine) also means performance runs and ordinary runs
 * interpret `{{name}}` syntax identically, including the prototype-
 * pollution hardening documented in docs/SECURITY.md.
 */
export function substituteRuntimeVariables(
  spec: PerfRequestSpec,
  runtime: Record<string, string>,
): PerfRequestSpec {
  // Fast path: the overwhelmingly common case is a spec with no remaining
  // placeholders at all (no chaining). Skipping the regex work here matters
  // because this runs once per request, per virtual user, per iteration.
  if (!specHasPlaceholder(spec)) return spec;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(spec.headers)) {
    headers[resolveVariables(key, runtime).value] = resolveVariables(value, runtime).value;
  }

  return {
    ...spec,
    url: resolveVariables(spec.url, runtime).value,
    headers,
    body: spec.body === null ? null : resolveVariables(spec.body, runtime).value,
  };
}

const PLACEHOLDER = /\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/;

export function specHasPlaceholder(spec: PerfRequestSpec): boolean {
  if (PLACEHOLDER.test(spec.url)) return true;
  if (spec.body !== null && PLACEHOLDER.test(spec.body)) return true;
  for (const [key, value] of Object.entries(spec.headers)) {
    if (PLACEHOLDER.test(key) || PLACEHOLDER.test(value)) return true;
  }
  return false;
}

/** Every `{{name}}` still present across a set of specs. The browser uses
 * this to check, before starting, that each remaining placeholder is
 * actually produced by an extraction earlier in the chain — otherwise the
 * run would issue thousands of requests to a URL containing a literal
 * "{{token}}", which is a configuration error, not a load test. */
export function collectPlaceholders(specs: readonly PerfRequestSpec[]): string[] {
  const pattern = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
  const found = new Set<string>();
  for (const spec of specs) {
    const parts = [spec.url, spec.body ?? "", ...Object.keys(spec.headers), ...Object.values(spec.headers)];
    for (const part of parts) {
      pattern.lastIndex = 0;
      let match = pattern.exec(part);
      while (match !== null) {
        found.add(match[1]!);
        match = pattern.exec(part);
      }
    }
  }
  return [...found];
}

/** The runtime variable names a set of specs produces via extraction. */
export function collectExtractedVariables(specs: readonly PerfRequestSpec[]): string[] {
  const names = new Set<string>();
  for (const spec of specs) {
    for (const extraction of spec.extractions) {
      if (extraction.enabled) names.add(extraction.variable);
    }
  }
  return [...names];
}
