import type { HttpMethod } from "@api-lab/shared";

/**
 * The normalized contract model (spec §5).
 *
 * Deliberately NOT a copy of the OpenAPI document. It contains only what
 * validation needs: which operations exist, what parameters they take, what
 * request bodies they accept, and what responses they promise. Descriptions,
 * examples, callbacks, links, webhooks, and tags are dropped — a contract
 * model that mirrored the whole document would double the memory cost of
 * every attached specification for data the validator never reads.
 *
 * The one deliberate exception is `components`, which is retained verbatim
 * so that `$ref: "#/components/schemas/User"` pointers inside retained
 * schemas still resolve. See jsonSchemaValidate.ts for how the validation
 * root is assembled.
 */

// ---------------------------------------------------------------------------
// OpenAPI version
// ---------------------------------------------------------------------------

/**
 * Which OpenAPI dialect a document was written in. This is not cosmetic:
 * 3.0 and 3.1 disagree about how "this value may be null" is expressed, and
 * applying 3.0's rules to a 3.1 document (or vice versa) silently changes
 * what passes. See schemaNormalize.ts and spec §11.
 */
export const OPENAPI_VERSIONS = ["3.0", "3.1"] as const;
export type OpenApiVersion = (typeof OPENAPI_VERSIONS)[number];

// ---------------------------------------------------------------------------
// Contract model
// ---------------------------------------------------------------------------

export const PARAMETER_LOCATIONS = ["path", "query", "header", "cookie"] as const;
export type ParameterLocation = (typeof PARAMETER_LOCATIONS)[number];

/**
 * Parameter serialization style (spec §21). Only the styles API Lab actually
 * implements and tests are listed; anything else in a document is retained
 * as an `unsupportedStyle` warning rather than being silently treated as
 * `form`, because guessing would turn a serialization bug into a spurious
 * contract violation.
 */
export const SUPPORTED_PARAMETER_STYLES = ["form", "simple"] as const;
export type ParameterStyle = (typeof SUPPORTED_PARAMETER_STYLES)[number];

export interface ContractParameter {
  name: string;
  location: ParameterLocation;
  required: boolean;
  /** Already normalized to JSON Schema 2020-12 — see schemaNormalize.ts. */
  schema: JsonSchema | undefined;
  style: ParameterStyle | undefined;
  explode: boolean | undefined;
  /** Set when the document declared a style this engine does not implement. */
  unsupportedStyle: string | undefined;
}

export interface ContractMediaType {
  /** Lowercased media type without parameters, e.g. "application/json". */
  contentType: string;
  schema: JsonSchema | undefined;
}

export interface ContractRequestBody {
  required: boolean;
  content: ContractMediaType[];
}

export interface ContractHeaderSpec {
  name: string;
  required: boolean;
  schema: JsonSchema | undefined;
}

export interface ContractResponse {
  /**
   * "200", "404", a range like "2XX", or "default". Kept as the document
   * wrote it; matching precedence is resolved in validateResponse.ts, not
   * here, so the model stays a faithful record of what was documented.
   */
  statusKey: string;
  headers: ContractHeaderSpec[];
  content: ContractMediaType[];
}

export interface ContractOperation {
  /** Stable identity for this operation within its contract. */
  id: string;
  method: HttpMethod;
  /** The templated path exactly as written, e.g. "/users/{id}". */
  path: string;
  operationId: string | undefined;
  summary: string | undefined;
  /** Path-level and operation-level parameters, already merged. */
  parameters: ContractParameter[];
  requestBody: ContractRequestBody | undefined;
  responses: ContractResponse[];
}

export interface ContractSecurityScheme {
  name: string;
  type: string;
  scheme: string | undefined;
  location: string | undefined;
  parameterName: string | undefined;
}

/** A JSON Schema value. Intentionally loose: it is untrusted external data
 * that only the schema validator interprets. */
export type JsonSchema = Record<string, unknown> | boolean;

export interface ContractModel {
  title: string;
  version: OpenApiVersion;
  /** The raw `openapi` string, e.g. "3.0.3" — reported verbatim in the UI. */
  openapiVersionString: string;
  servers: string[];
  operations: ContractOperation[];
  securitySchemes: ContractSecurityScheme[];
  /**
   * The document's `components` object, retained verbatim so `$ref`s inside
   * retained schemas resolve. Normalized alongside the schemas that point
   * into it, so a 3.0 document's `nullable` is handled here too.
   */
  components: Record<string, unknown> | undefined;
  /** Non-fatal notes produced while building this model. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation result (spec §22)
// ---------------------------------------------------------------------------

export const VIOLATION_LOCATIONS = [
  "request.path",
  "request.query",
  "request.header",
  "request.cookie",
  "request.body",
  "request.contentType",
  "request.method",
  "response.status",
  "response.header",
  "response.body",
  "response.contentType",
  "contract",
] as const;
export type ViolationLocation = (typeof VIOLATION_LOCATIONS)[number];

/**
 * `error` means the contract was violated. `warning` means validation could
 * not be performed completely — an unsupported `format`, a skipped regex, a
 * body too large to check. A warning is never folded into a pass: spec §23
 * is explicit that unsupported validation must not hide behind a green
 * PASS, so `ContractValidationResult.warnings` is surfaced separately in
 * every report and every UI surface.
 */
export const VIOLATION_SEVERITIES = ["error", "warning"] as const;
export type ViolationSeverity = (typeof VIOLATION_SEVERITIES)[number];

export interface ContractViolation {
  location: ViolationLocation;
  /** JSON path into the offending value, e.g. `$.data.users[2].id`. */
  path: string;
  /** The schema keyword or contract rule that failed, e.g. "type", "required". */
  keyword: string;
  expected: string;
  actual: string;
  message: string;
  severity: ViolationSeverity;
}

export interface ContractValidationResult {
  valid: boolean;
  /** The resolved operation, or null when no operation could be matched. */
  operation: ContractOperation | null;
  requestViolations: ContractViolation[];
  responseViolations: ContractViolation[];
  warnings: ContractViolation[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Operation resolution (spec §6, §27)
// ---------------------------------------------------------------------------

export type OperationMatchResult =
  | { status: "matched"; operation: ContractOperation }
  | { status: "ambiguous"; candidates: ContractOperation[]; detail: string }
  | { status: "unknown-path"; detail: string }
  | { status: "unknown-method"; detail: string; allowedMethods: HttpMethod[] };

// ---------------------------------------------------------------------------
// Drift detection (spec §34-§36)
// ---------------------------------------------------------------------------

export const DRIFT_KINDS = [
  "matched",
  "missing-from-spec",
  "missing-from-collection",
  "parameter-mismatch",
  "request-body-mismatch",
] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

/**
 * A collection request reduced to only what drift comparison needs. Kept
 * deliberately neutral rather than importing `RequestConfig` from
 * workspace-engine: contract-engine stays free of the workspace model for
 * the same reason runner-engine did (see its types.ts), and apps/web owns
 * the one-way adaptation.
 */
export interface CollectionEndpoint {
  id: string;
  name: string;
  method: HttpMethod;
  /** Full or partial URL, possibly containing `{{variables}}`. */
  url: string;
}

export interface DriftEntry {
  kind: DriftKind;
  severity: ViolationSeverity;
  method: HttpMethod;
  /** The spec path when known, otherwise the collection request's path. */
  path: string;
  operationId: string | undefined;
  requestId: string | undefined;
  requestName: string | undefined;
  reason: string;
}

export interface DriftReport {
  entries: DriftEntry[];
  matched: number;
  missingFromSpec: number;
  missingFromCollection: number;
  mismatched: number;
}

// ---------------------------------------------------------------------------
// Coverage (spec §37)
// ---------------------------------------------------------------------------

/**
 * Two distinct, separately-labelled ratios. Neither is code coverage and
 * neither is described as such anywhere in the UI or the exports (spec §37):
 *
 * - `operationCoverage` — how much of the specification the collection even
 *   has a request for. A static, structural measure.
 * - `validationCoverage` — how much of the specification has actually been
 *   exercised by a contract validation in this session. A dynamic measure,
 *   and always ≤ operation coverage in practice.
 */
export interface CoverageReport {
  totalOperations: number;
  coveredOperations: number;
  operationCoveragePercent: number;
  validatedOperations: number;
  validationCoveragePercent: number;
  uncovered: Array<{ method: HttpMethod; path: string }>;
}

// ---------------------------------------------------------------------------
// Contract test report (spec §38)
// ---------------------------------------------------------------------------

export interface ContractReportEntry {
  requestName: string;
  method: HttpMethod;
  /** Resolved spec path, or the raw URL path when unmatched. */
  path: string;
  valid: boolean;
  violations: ContractViolation[];
  warnings: ContractViolation[];
}

export interface ContractTestReport {
  specificationTitle: string;
  openapiVersionString: string;
  generatedAt: string;
  totalRequests: number;
  validCount: number;
  violationCount: number;
  warningCount: number;
  coverage: CoverageReport | null;
  entries: ContractReportEntry[];
}

// ---------------------------------------------------------------------------
// Persistence (spec §26)
// ---------------------------------------------------------------------------

export const CONTRACT_FORMAT_VERSION = 1;

/**
 * An attached specification. The raw document text is stored so the contract
 * model can be rebuilt after a reload without asking the user to re-import,
 * and because re-deriving text from a lossy contract model would be wrong.
 *
 * `collectionIds` is the collection ↔ contract association (spec §26). The
 * binding lives here, on API Lab's side, rather than as an annotation inside
 * the OpenAPI document: the specification is frequently a read-only artifact
 * owned by another team, and the milestone is explicit that associating a
 * collection must not require modifying it.
 */
export interface AttachedSpecification {
  id: string;
  name: string;
  /** Verbatim source text (JSON or YAML) as imported. */
  source: string;
  sourceFormat: "json" | "yaml";
  openapiVersionString: string;
  importedAt: string;
  collectionIds: string[];
}

export interface ContractWorkspace {
  specifications: AttachedSpecification[];
}

export interface PersistedContractWorkspace {
  version: number;
  contracts: ContractWorkspace;
}
