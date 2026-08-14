/**
 * Hard resource limits for security and negative testing (spec §29, §38).
 *
 * Every value here exists to stop the same failure mode: a generator that
 * turns one request into an unbounded amount of outbound traffic, or a
 * mutation that turns a bounded request into an unbounded one. Milestone 10
 * deliberately owns load generation; nothing in Milestone 12 is allowed to
 * become an accidental load generator (spec §36).
 *
 * These are *engine* limits, not UI suggestions. Generation clamps against
 * them and reports the truncation, and execution refuses to start a run that
 * exceeds them — a limit that only exists in the UI is a limit an automated
 * caller can skip.
 */

/**
 * Maximum negative tests produced by one generation pass.
 *
 * The generator is combinatorial by nature: operations × parameters ×
 * mutation categories. A 60-operation specification with eight categories
 * enabled would otherwise generate thousands of requests from a single
 * button press. 100 is the spec's suggested ceiling and is also roughly the
 * largest list a human will actually read in the preview (spec §28) before
 * approving it — a preview nobody reads is not a safety control.
 */
export const MAX_GENERATED_TESTS = 100;

/**
 * Maximum wall-clock duration of one security run. At the 10-minute mark the
 * run stops and every remaining test is reported as `skipped`, never as
 * passed — an unfinished check must not read as a clean result.
 */
export const MAX_EXECUTION_DURATION_MS = 10 * 60 * 1000;

/**
 * Delay inserted between consecutive security requests. Security testing is
 * a functional activity, so it runs strictly sequentially with a small pause:
 * 100 generated tests fired concurrently at an endpoint is a load test, and
 * spec §36 forbids this milestone from becoming one.
 */
export const REQUEST_INTERVAL_MS = 25;

/**
 * Longest string any mutation is permitted to synthesize.
 *
 * Boundary mutations derive values from a schema's `maxLength`, which is
 * attacker-controlled data inside an imported OpenAPI document. A document
 * declaring `maxLength: 50000000` must not cause API Lab to build a 50 MB
 * request body. Generation clamps to this and records a warning, so the
 * mutation is still performed and still meaningful, just bounded.
 */
export const MAX_MUTATED_STRING_LENGTH = 4096;

/**
 * Ceiling on numeric boundary values synthesized from a schema. Beyond
 * `Number.MAX_SAFE_INTEGER` arithmetic stops being exact, so a "maximum + 1"
 * value could silently equal "maximum" and produce a test that asserts
 * nothing.
 */
export const MAX_BOUNDARY_MAGNITUDE = Number.MAX_SAFE_INTEGER;

/**
 * Maximum request body size a mutation may produce, matching the existing
 * request limits referenced by spec §29. A mutated body larger than this is
 * not sent; the test reports `error` with a reason.
 */
export const MAX_MUTATED_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

/** Maximum body size scanned by the response checks. Beyond this the checks
 * report a warning rather than spending unbounded time on regex scanning of
 * a huge response — the same trade-off contract-engine makes for schema
 * validation. */
export const MAX_SCANNED_RESPONSE_BYTES = 512 * 1024;

/** Findings retained per single test result, so one pathological response
 * cannot produce an unbounded findings array. */
export const MAX_FINDINGS_PER_RESULT = 50;

/** Mutations generated per single operation, before the global
 * `MAX_GENERATED_TESTS` clamp. Keeps one enormous schema from consuming the
 * entire budget and starving every other operation of coverage. */
export const MAX_TESTS_PER_OPERATION = 12;

/**
 * Maximum depth walked when collecting mutable fields from a request body or
 * a schema. Mirrors contract-engine's `MAX_SCHEMA_DEPTH` rationale: an
 * unbounded recursive walk over untrusted structure is a stack-overflow
 * waiting to happen, and a RangeError is not catchable by the Zod boundary.
 */
export const MAX_BODY_WALK_DEPTH = 12;

/** Mutable leaf fields collected from one body/schema. Bounds the generator's
 * input the same way `MAX_TESTS_PER_OPERATION` bounds its output. */
export const MAX_COLLECTED_FIELDS = 200;
