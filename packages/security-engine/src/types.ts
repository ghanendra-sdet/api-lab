import type { HttpMethod } from "@api-lab/shared";

/**
 * The security and negative-testing domain model (spec §5, §6, §22-§25).
 *
 * ## What this package is, and is not
 *
 * It is a framework for *controlled, bounded, deterministic* robustness and
 * security-behaviour testing of an API the user already has a request for.
 * Every mutation it can produce is enumerated in `MUTATION_OPERATIONS`
 * below, and every one of them is a documented QA technique: remove a
 * required field, send the wrong type, cross a declared boundary, drop the
 * credential.
 *
 * It is deliberately NOT a vulnerability scanner, an exploit generator, or a
 * discovery tool (spec §2, §48). There is no payload dictionary here, no
 * endpoint enumeration, no credential guessing, and no free-text injection
 * of attacker-supplied strings. The model is closed on purpose: a caller
 * cannot express "send this arbitrary payload" because `Mutation.operation`
 * is a fixed union, not a script. That closure is the security control — it
 * means the set of requests API Lab can be made to emit is bounded by this
 * file rather than by a caller's imagination.
 */

// ---------------------------------------------------------------------------
// Test classification (spec §22)
// ---------------------------------------------------------------------------

/**
 * Every result in API Lab now carries a category. Before Milestone 12 the
 * distinction was implicit in which panel a result appeared in, which stops
 * working the moment the Collection Runner reports functional, contract and
 * security outcomes side by side (spec §32).
 *
 * `negative` and `security` are separate on purpose. A negative test asks
 * "does this API reject bad input cleanly?" — a robustness question whose
 * failure is a bug. A security test asks "does this API enforce its own
 * access and disclosure rules?" — whose failure has a different audience and
 * a different urgency. Collapsing them would make the report less useful,
 * not simpler.
 */
export const TEST_CATEGORIES = ["functional", "contract", "performance", "security", "negative"] as const;
export type TestCategory = (typeof TEST_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Mutations (spec §6-§11)
// ---------------------------------------------------------------------------

/** Where in the request a mutation applies. Closed set (spec §6). */
export const MUTATION_LOCATIONS = [
  "request.path",
  "request.query",
  "request.header",
  "request.body",
  "request.auth",
] as const;
export type MutationLocation = (typeof MUTATION_LOCATIONS)[number];

/**
 * What a mutation does. This union is the hard boundary on API Lab's
 * outbound behaviour — see the file header.
 *
 * - `remove`          drop a required field/parameter/header entirely (§7)
 * - `set-wrong-type`  replace a value with a well-formed value of another
 *                     JSON type, e.g. `25` → `"invalid"` (§7)
 * - `set-null`        replace a value with `null` (§7)
 * - `set-empty`       replace with the empty form of its own type: `""`,
 *                     `[]`, `{}` (§7)
 * - `set-boundary`    a value derived from the schema's own declared bounds
 *                     (§7). Always clamped by limits.ts.
 * - `set-invalid-enum` a single fixed out-of-range enum token (§8). Not a
 *                     dictionary, not a fuzzer — one deterministic value.
 * - `malform-json`    truncate a JSON body so it stops parsing (§7). Derived
 *                     from the user's own body; nothing is injected.
 * - `set-content-type` replace the declared Content-Type (§11)
 * - `set-invalid-auth` replace the credential with a syntactically valid but
 *                     non-authentic one (§12)
 *
 * Note what is absent: there is no `set-arbitrary`, no `inject`, no
 * `append-payload`. Adding one would take this package outside the product's
 * stated scope, and doing so requires revisiting docs/SECURITY.md, not just
 * this union.
 */
export const MUTATION_OPERATIONS = [
  "remove",
  "set-wrong-type",
  "set-null",
  "set-empty",
  "set-boundary",
  "set-invalid-enum",
  "malform-json",
  "set-content-type",
  "set-invalid-auth",
] as const;
export type MutationOperation = (typeof MUTATION_OPERATIONS)[number];

/**
 * The flavours of `set-invalid-auth` (spec §12). Each produces a credential
 * that is *shaped* correctly and *certainly* not valid — never a guess at a
 * real one. `wrong-api-key` sends a fixed placeholder string, not a
 * candidate from any list: this package does not do credential attacks
 * (spec §48).
 */
export const AUTH_MUTATION_KINDS = [
  "none",
  "invalid-token",
  "expired-token",
  "malformed-token",
  "wrong-api-key",
  "missing-api-key",
] as const;
export type AuthMutationKind = (typeof AUTH_MUTATION_KINDS)[number];

/**
 * The value a mutation installs. A closed tagged union rather than
 * `unknown`, so that "what could API Lab possibly send here?" is answerable
 * by reading a type instead of by auditing call sites.
 */
export type MutationValue =
  | { kind: "none" }
  | { kind: "json"; json: unknown }
  | { kind: "text"; text: string }
  | { kind: "auth"; auth: AuthMutationKind };

export interface Mutation {
  location: MutationLocation;
  operation: MutationOperation;
  /**
   * What within the location is being mutated: a JSON pointer-style path for
   * `request.body` (`/user/age`), or a parameter/header name for the other
   * locations. Empty string when the mutation applies to the location as a
   * whole (`malform-json`, auth mutations).
   *
   * Not in the spec's four-field sketch, but a mutation without a target is
   * not executable — the sketch's `value` alone cannot say *which* field
   * becomes null.
   */
  target: string;
  value: MutationValue;
  /** Human-readable, shown in the preview and every report row. */
  description: string;
}

// ---------------------------------------------------------------------------
// Expected behaviour (spec §12, §15, §17)
// ---------------------------------------------------------------------------

export const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

/**
 * What the tester asserts *should* happen (spec §12).
 *
 * Every field is configurable and nothing is assumed, because the milestone
 * is explicit that APIs disagree: some return 401 for a missing credential,
 * some 403, some 404 to avoid confirming a resource exists. All three can be
 * correct. An engine that hardcoded 401 would generate false failures on
 * conforming APIs and teach testers to ignore its output.
 *
 * Likewise `requiredSecurityHeaders` defaults to empty. Spec §15 is explicit
 * that a missing `Strict-Transport-Security` is not a universal
 * vulnerability — on a purely internal HTTP service it is simply irrelevant.
 */
export interface ExpectedBehavior {
  /** Exact acceptable status codes. Empty means "any within statusClasses". */
  statusCodes: number[];
  /** Acceptable status classes. Empty means "any status". */
  statusClasses: StatusClass[];
  /**
   * A 5xx means the API crashed on input it should have rejected — spec §19
   * treats that as a robustness failure distinct from an unexpected-but-
   * handled status.
   */
  forbidServerError: boolean;
  /** Fail on stack traces / internal paths / raw database errors (spec §18). */
  forbidInformationDisclosure: boolean;
  /** Fail on obvious sensitive fields in the response body (spec §14). */
  forbidSensitiveData: boolean;
  /** Response headers that must be present (spec §15). */
  requiredSecurityHeaders: string[];
  /** Flag `Access-Control-Allow-Origin: *` with credentials (spec §17). */
  checkCors: boolean;
  /** Report transport information and flag plaintext HTTP (spec §16). */
  checkTransport: boolean;
}

export function createDefaultExpectedBehavior(): ExpectedBehavior {
  return {
    statusCodes: [],
    statusClasses: [],
    forbidServerError: true,
    forbidInformationDisclosure: true,
    forbidSensitiveData: false,
    requiredSecurityHeaders: [],
    checkCors: false,
    checkTransport: false,
  };
}

// ---------------------------------------------------------------------------
// Negative test definition (spec §6)
// ---------------------------------------------------------------------------

export const TEST_SOURCES = ["contract", "heuristic", "manual"] as const;
/** How a test came to exist. `contract` means it was derived from an
 * OpenAPI operation and therefore knows the real declared types and bounds;
 * `heuristic` means it was derived from the request's own body/params
 * without a specification, and is correspondingly less precise. Reports show
 * this so a tester can tell a schema-backed assertion from an inferred one. */
export type TestSource = (typeof TEST_SOURCES)[number];

export interface NegativeTestMetadata {
  source: TestSource;
  /** Stable rule identifier, e.g. "negative.body.required-missing". */
  ruleId: string;
  /** The contract operation this was generated from, when source is "contract". */
  operationId: string | undefined;
  createdAt: string;
}

/**
 * One generated test: a target request, one mutation, and the behaviour the
 * tester expects in response.
 *
 * `targetRequestId` is a reference, never an embedded copy of the request.
 * That is a security requirement, not a normalization preference: spec §33
 * forbids resolving or persisting credentials into generated definitions, so
 * the definition must not contain the request's auth configuration or any
 * resolved variable value. The request is fetched and resolved at execution
 * time, in memory, per run.
 */
export interface NegativeTest {
  id: string;
  name: string;
  category: TestCategory;
  targetRequestId: string;
  targetRequestName: string;
  mutation: Mutation;
  expected: ExpectedBehavior;
  enabled: boolean;
  metadata: NegativeTestMetadata;
}

// ---------------------------------------------------------------------------
// Findings (spec §24)
// ---------------------------------------------------------------------------

/**
 * Severity is capped at `high` on purpose (spec §24). "Critical" in a QA tool
 * that has not proven exploitability is noise: it escalates, it gets
 * escalated onward, and when it turns out to be a documented internal
 * behaviour the whole report loses credibility. `high` additionally requires
 * evidence — see `requiresEvidence` in findings.ts.
 */
export const FINDING_SEVERITIES = ["info", "low", "medium", "high"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface Finding {
  /** Stable rule id, e.g. "security.response.sensitive-field". */
  rule: string;
  severity: FindingSeverity;
  /** Where it was observed: "response.body", "response.header.X", etc. */
  location: string;
  message: string;
  /** Concise, QA-oriented, never an exploitation instruction (spec §26). */
  remediation: string;
  /**
   * Non-sensitive corroboration — a field *name*, a header *name*, a matched
   * pattern label. Never a matched secret value (spec §14, §25). Everything
   * placed here passes through redact.ts first.
   */
  evidence: string | undefined;
}

// ---------------------------------------------------------------------------
// Results (spec §23)
// ---------------------------------------------------------------------------

/**
 * `warning` is a first-class outcome, not a soft pass. It means the request
 * was executed and something was observed that the tester has not declared
 * an expectation about — a missing security header when none were required,
 * a permissive CORS policy on an endpoint where that may be intended. Spec
 * §15 and §17 both insist these must not be reported as universal failures;
 * they must also not vanish into a green PASS, which is the same rule
 * contract-engine applies to its own warnings.
 */
export const SECURITY_TEST_STATUSES = ["passed", "failed", "warning", "error", "skipped"] as const;
export type SecurityTestStatus = (typeof SECURITY_TEST_STATUSES)[number];

export interface SecurityTestResult {
  testId: string;
  testName: string;
  status: SecurityTestStatus;
  category: TestCategory;
  requestMutation: Mutation;
  method: HttpMethod;
  /** The mutated request path, with query string. Never the full URL with
   * credentials in it — see redact.ts. */
  path: string;
  actualStatus: number | null;
  /** Human-readable rendering of `ExpectedBehavior`, e.g. "4xx" or "401, 403". */
  expectedStatus: string;
  findings: Finding[];
  /** Non-fatal notes: skipped checks, clamped values, oversized bodies. */
  warnings: string[];
  durationMs: number;
  /** Set when `status` is "error" or "skipped". */
  detail: string | undefined;
}

// ---------------------------------------------------------------------------
// Run + report (spec §25)
// ---------------------------------------------------------------------------

export type SecurityRunStatus = "idle" | "running" | "completed" | "cancelled" | "aborted";

export interface SecurityRunSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  errors: number;
  skipped: number;
  /** Findings grouped by severity, for the report header. */
  findingsBySeverity: Record<FindingSeverity, number>;
}

export interface SecurityReport {
  generatedAt: string;
  /** Host under test, shown so a report can never be misread as describing a
   * different environment than the one that was actually exercised. */
  targetHost: string;
  specificationTitle: string | undefined;
  summary: SecurityRunSummary;
  results: SecurityTestResult[];
}

// ---------------------------------------------------------------------------
// Neutral request shapes
// ---------------------------------------------------------------------------

/**
 * The request shape this engine mutates.
 *
 * Deliberately not `RequestConfig` from workspace-engine, and not
 * `BuiltRequest` from request-engine. security-engine holds the same
 * boundary runner-engine and contract-engine hold (see their types.ts):
 * apps/web owns the one-way adaptation, so this package stays independently
 * testable and has no opinion about how API Lab stores a request.
 *
 * Everything here is already fully resolved — variables substituted, auth
 * applied — because mutating `{{userId}}` would produce a test that proves
 * nothing about the API.
 */
export interface SecurityRequestInput {
  method: HttpMethod;
  /** Absolute URL, already resolved. */
  url: string;
  headers: Array<{ name: string; value: string }>;
  query: Array<{ name: string; value: string }>;
  body: string | undefined;
  contentType: string | undefined;
  /**
   * The contract path template (`/users/{id}`) when the request matched an
   * operation. Path-parameter mutation needs it to know which URL segment is
   * the parameter; without it, path mutations are simply not generated
   * rather than guessed at.
   */
  pathTemplate: string | undefined;
  /** Where the credential lives, so auth mutations know what to remove or
   * replace. Resolved per run and never persisted (spec §33). */
  auth: AuthPlacement;
}

/**
 * How the target request carries its credential. Derived at runtime from the
 * M5 auth engine's output — Milestone 12 adds no second authentication
 * implementation (spec §34), it only describes where M5 put the credential
 * so the mutation knows what to strip.
 */
export type AuthPlacement =
  | { kind: "none" }
  | { kind: "header"; name: string; scheme: "bearer" | "basic" | "raw" }
  | { kind: "query"; name: string };

export interface SecurityResponseInput {
  status: number | null;
  headers: Record<string, string>;
  rawBody: string;
  durationMs: number;
  /** Transport-level failure (DNS, TLS, connection refused), if any. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Which mutation families the user ticked in the generator UI (spec §27).
 * Every one defaults to off in the type's consumers; the UI supplies its own
 * defaults. Nothing is generated that was not explicitly requested.
 */
export interface GeneratorCategories {
  missingRequiredFields: boolean;
  invalidTypes: boolean;
  nullValues: boolean;
  emptyValues: boolean;
  boundaryValues: boolean;
  invalidEnums: boolean;
  malformedJson: boolean;
  invalidContentType: boolean;
  missingAuthentication: boolean;
  invalidAuthentication: boolean;
}

export function createDefaultGeneratorCategories(): GeneratorCategories {
  return {
    missingRequiredFields: true,
    invalidTypes: true,
    nullValues: true,
    emptyValues: false,
    boundaryValues: true,
    invalidEnums: true,
    malformedJson: false,
    invalidContentType: false,
    missingAuthentication: true,
    invalidAuthentication: false,
  };
}

export interface GenerationResult {
  tests: NegativeTest[];
  /** Why fewer tests exist than the inputs implied: clamped limits,
   * unsupported schema shapes, missing contract information. Surfaced in the
   * preview so a short list is never mistaken for thorough coverage. */
  warnings: string[];
  /** True when generation stopped at MAX_GENERATED_TESTS. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Persistence (spec §42)
// ---------------------------------------------------------------------------

export const SECURITY_FORMAT_VERSION = 1;

/**
 * Persisted security state.
 *
 * Note what is not here: no responses, no findings' raw evidence, no request
 * bodies, no credentials, no environment values. Spec §40 requires an audit
 * of everything API Lab writes down; the conclusion for this milestone was
 * that a security *report* is exactly the kind of artifact that gets shared
 * carelessly, so results are session-scoped in memory and only the test
 * definitions (which by construction contain no secrets) are stored.
 */
export interface SecurityWorkspace {
  tests: NegativeTest[];
}

export interface PersistedSecurityWorkspace {
  version: number;
  security: SecurityWorkspace;
}
