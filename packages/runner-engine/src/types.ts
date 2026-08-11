/**
 * Framework-independent Runner primitives: extraction, runtime/iteration
 * context precedence, and dataset parsing. Deliberately does not know about
 * `workspace-engine`'s `RequestConfig`, `environment-engine`'s resolver, or
 * any Zustand/React state — those compositions live in `apps/web` (see
 * docs/ARCHITECTURE.md's Milestone 8 section for why), exactly as
 * `auth-engine`/`test-engine` stayed environment-agnostic in earlier
 * milestones.
 */

export const EXTRACTION_SOURCES = ["json", "header"] as const;
export type ExtractionSource = (typeof EXTRACTION_SOURCES)[number];

/**
 * A serializable, non-executable extraction rule: "take this JSON path (or
 * header name) from the response and save it as this variable name." Saved
 * with a request, exactly like an Assertion (see @api-lab/test-engine) —
 * never a script, never evaluated as code.
 */
export interface Extraction {
  id: string;
  source: ExtractionSource;
  /** JSON path (source "json", e.g. "$.data.token") or header name (source "header"). */
  path: string;
  /** The runtime variable name this value is saved as. */
  variable: string;
  enabled: boolean;
}

export interface ExtractionResult {
  extraction: Extraction;
  ok: boolean;
  value?: string;
  error?: string;
}

/**
 * The three variable scopes that exist as of Milestone 8, merged with
 * documented precedence — iteration (dataset row) wins over runtime
 * (extracted-this-run) wins over environment. Local/Collection/Global
 * scopes remain documented-but-unimplemented future work (see Milestone 4
 * and 5's own "As built" notes) — extending this precedence chain later
 * means inserting another object into `mergeResolutionContext`, not
 * redesigning it.
 */
export interface ResolutionScopes {
  environment: Record<string, string>;
  runtime: Record<string, string>;
  iteration: Record<string, string>;
}

export function mergeResolutionContext(scopes: ResolutionScopes): Record<string, string> {
  // Object.create(null): dataset/runtime keys are derived from untrusted
  // external input (CSV/JSON headers, extracted response data) — see
  // docs/SECURITY.md's Milestone 8 section and environment-engine's
  // existing __proto__ hardening, which this mirrors.
  const merged: Record<string, string> = Object.create(null) as Record<string, string>;
  Object.assign(merged, scopes.environment, scopes.runtime, scopes.iteration);
  return merged;
}

export interface DatasetRow {
  [column: string]: string;
}

export interface Dataset {
  columns: string[];
  rows: DatasetRow[];
}

export type DatasetParseResult = { ok: true; data: Dataset } | { ok: false; detail: string };
