import type { ApiResponseResult } from "@api-lab/request-engine";
import { evaluateJsonPath } from "@api-lab/test-engine";
import type { Extraction, ExtractionResult } from "./types";

function jsonValueToString(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Extracts one value from a response. Never silently produces an empty
 * variable on failure — a missing path, non-JSON body, or missing header
 * always returns `ok: false` with a specific `error`, so the caller can
 * report it clearly rather than let a later request silently receive `""`.
 * Pure — never mutates the response, never touches storage.
 */
export function extractValue(extraction: Extraction, response: ApiResponseResult): ExtractionResult {
  if (extraction.source === "header") {
    const wantedKey = extraction.path.toLowerCase();
    const found = Object.entries(response.headers).find(([k]) => k.toLowerCase() === wantedKey);
    if (!found) {
      return { extraction, ok: false, error: `Header "${extraction.path}" was not present on the response.` };
    }
    return { extraction, ok: true, value: found[1] };
  }

  // source === "json"
  if (response.bodyKind !== "json") {
    return { extraction, ok: false, error: "Response body is not JSON." };
  }
  const pathResult = evaluateJsonPath(extraction.path, response.body);
  if (!pathResult.ok) {
    return { extraction, ok: false, error: pathResult.detail };
  }
  if (!pathResult.found) {
    return { extraction, ok: false, error: `JSON path "${extraction.path}" was not found in the response.` };
  }
  return { extraction, ok: true, value: jsonValueToString(pathResult.value) };
}

/** Extracts every enabled extraction rule, returning both the resulting
 * runtime variables and any failures — the caller decides what a failure
 * means for the overall request/run (see docs/ARCHITECTURE.md). */
export function extractAll(
  extractions: Extraction[],
  response: ApiResponseResult,
): { variables: Record<string, string>; results: ExtractionResult[] } {
  const variables: Record<string, string> = {};
  const results: ExtractionResult[] = [];
  for (const extraction of extractions.filter((e) => e.enabled)) {
    const result = extractValue(extraction, response);
    results.push(result);
    if (result.ok && result.value !== undefined) {
      variables[extraction.variable] = result.value;
    }
  }
  return { variables, results };
}
