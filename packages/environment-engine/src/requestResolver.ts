import type { KeyValueRow } from "@api-lab/shared";
import { resolveVariables } from "./resolver.ts";

/** The subset of a request's fields that can contain `{{variable}}`
 * references. Deliberately duck-typed against `@api-lab/shared`'s
 * `KeyValueRow` rather than importing a request-engine or workspace-engine
 * type, so this module has no dependency on either package. */
export interface ResolvableRequestConfig {
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  bodyRawContent: string;
}

export interface RequestResolveResult {
  resolved: ResolvableRequestConfig;
  unresolvedVariables: string[];
  hasCircularReference: boolean;
}

/**
 * Resolves variables across every part of a request that can reference
 * them (URL, query parameter keys/values, header keys/values, raw body)
 * without mutating the input — the caller's saved/tab config keeps its
 * `{{name}}` expressions untouched; only the returned copy is resolved.
 */
export function resolveRequestConfig(
  config: ResolvableRequestConfig,
  context: Record<string, string>,
): RequestResolveResult {
  const unresolvedVariables = new Set<string>();
  let hasCircularReference = false;

  function res(input: string): string {
    const result = resolveVariables(input, context);
    result.unresolvedVariables.forEach((name) => unresolvedVariables.add(name));
    if (result.hasCircularReference) hasCircularReference = true;
    return result.value;
  }

  function resRow(row: KeyValueRow): KeyValueRow {
    return { ...row, key: res(row.key), value: res(row.value) };
  }

  const resolved: ResolvableRequestConfig = {
    url: res(config.url),
    params: config.params.map(resRow),
    headers: config.headers.map(resRow),
    bodyRawContent: res(config.bodyRawContent),
  };

  return { resolved, unresolvedVariables: [...unresolvedVariables], hasCircularReference };
}
