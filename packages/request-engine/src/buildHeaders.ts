import type { KeyValueRow } from "@api-lab/shared";

/**
 * Builds the outgoing header set from enabled rows only. User-provided
 * headers are never silently overridden — buildBody separately decides
 * whether it needs to *add* a Content-Type, and only does so when the user
 * hasn't already set one (see buildBody.ts).
 */
export function buildHeaders(headers: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of headers) {
    if (!row.enabled || row.key.trim() === "") continue;
    result[row.key] = row.value;
  }
  return result;
}

export function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}
