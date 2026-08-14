/**
 * Resource limits for contract validation. An OpenAPI document is untrusted
 * input (spec §40) — every limit here exists so that a hostile or merely
 * enormous specification degrades into a typed failure or a warning instead
 * of hanging the browser's single UI thread.
 *
 * See docs/SECURITY.md's Milestone 11 section for the reasoning behind each
 * value.
 */

/** Specification files larger than this are rejected before parsing. Mirrors
 * `MAX_IMPORT_FILE_SIZE_BYTES` in @api-lab/collection-format — the same
 * threat, the same answer. */
export const MAX_SPEC_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Maximum operations retained from one specification. A document with more
 * than this is accepted but truncated with a warning, so contract validation
 * cannot be turned into an unbounded memory allocation. */
export const MAX_OPERATIONS = 2_000;

/**
 * Maximum nesting depth walked when normalizing a schema (3.0 → 2020-12).
 * A pathologically deep document would otherwise exhaust the call stack —
 * a RangeError, which is not something Zod's safeParse catches.
 */
export const MAX_SCHEMA_DEPTH = 64;

/**
 * Response/request bodies larger than this are not schema-validated. Beyond
 * this size the validation cost stops being interactive, and the result
 * would not be trustworthy anyway because we would be validating a truncated
 * body. Reported as a warning, never as a silent pass (spec §23).
 */
export const MAX_VALIDATED_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * `pattern` keywords longer than this are not applied. Long attacker-authored
 * regular expressions are the input to the ReDoS problem described in
 * redos.ts; bounding the source length bounds the search space cheaply.
 */
export const MAX_PATTERN_LENGTH = 300;

/**
 * Strings longer than this are not `pattern`-validated. Catastrophic
 * backtracking is a function of *input* length as much as pattern shape —
 * even a pattern that passes the static safety check is not run against an
 * unbounded string.
 */
export const MAX_PATTERN_INPUT_LENGTH = 10_000;

/** Violations retained per validation result. A single mismatched array of
 * 100k elements must not produce 100k violation objects. */
export const MAX_VIOLATIONS = 200;

/** Compiled contracts kept in the validator cache (spec §42). */
export const MAX_CACHED_CONTRACTS = 16;

// ---------------------------------------------------------------------------
// Pattern complexity limits (Milestone 12, spec §37)
// ---------------------------------------------------------------------------
//
// Milestone 11 screened patterns by *shape* — reject a repeated group with an
// ambiguous body — and said plainly that this was conservative rather than a
// proof. Milestone 12 adds a second, independent axis: raw complexity.
//
// The two catch different things. Shape screening catches `(a+)+`. It does not
// catch a pattern that is individually unambiguous at every point but has
// forty sequential optional groups, whose combined backtracking is still
// exponential. Complexity caps catch that class without needing to reason
// about it, at the cost of rejecting some elaborate-but-safe patterns — an
// acceptable trade, since a rejected pattern degrades to a warning rather
// than a failure.

/** Maximum quantifiers (`*`, `+`, `?`, `{n,m}`) in one pattern. */
export const MAX_PATTERN_QUANTIFIERS = 20;

/** Maximum group nesting depth. Nested groups multiply the number of ways a
 * given input can be matched, which is the quantity that actually explodes. */
export const MAX_PATTERN_GROUP_DEPTH = 5;

/** Maximum alternation branches (`|`) in one pattern. */
export const MAX_PATTERN_ALTERNATIONS = 20;

/** Maximum explicit repetition count in a `{n,m}` quantifier. `a{1,50000}`
 * compiles fine and expands to fifty thousand states at match time. */
export const MAX_PATTERN_REPETITION = 1_000;

/** Distinct patterns collected from one document for dynamic vetting. Bounds
 * the work handed to the vetting worker. */
export const MAX_VETTED_PATTERNS = 200;

/**
 * Wall-clock budget for evaluating a single pattern inside the isolated
 * vetting worker. A well-behaved regex over the probe inputs completes in
 * well under a millisecond; anything still running at 50 ms is pathological
 * by definition, and the worker is terminated.
 */
export const PATTERN_VETTING_TIMEOUT_MS = 50;
