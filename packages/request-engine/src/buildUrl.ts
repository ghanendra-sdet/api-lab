import type { KeyValueRow } from "@api-lab/shared";

/**
 * Builds the final request URL from a base URL and enabled query params.
 * Uses URLSearchParams so encoding is always correct (spaces, special
 * characters) instead of manual string concatenation.
 */
export function buildUrl(baseUrl: string, queryParams: KeyValueRow[]): string {
  const url = new URL(baseUrl);
  const enabled = queryParams.filter((row) => row.enabled && row.key.trim() !== "");

  for (const row of enabled) {
    url.searchParams.append(row.key, row.value);
  }

  return url.toString();
}
