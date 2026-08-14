import type { HttpMethod } from "@api-lab/shared";
import type { ParameterLocation } from "@api-lab/contract-engine";

/**
 * The normalized documentation model (spec §4).
 *
 * ## Why this is not the contract model, and not OpenAPI
 *
 * Spec §4 says plainly: do not simply reuse OpenAPI objects. The reason is
 * not stylistic. A documentation model has three requirements the OpenAPI
 * document cannot meet:
 *
 * 1. **It must be presentation-independent.** The same model renders to
 *    Markdown and to HTML. Anything shaped for one renderer leaks into the
 *    other.
 * 2. **It must be source-agnostic.** A collection-only API produces the same
 *    model shape as an OpenAPI one, so the renderers never branch on where
 *    the information came from — only on `provenance`, which is data.
 * 3. **It must be safe by construction.** Every string in this model has
 *    already been through length-capping and secret redaction. The renderers
 *    handle escaping; they do not handle redaction, because a renderer that
 *    could forget to redact is a renderer that eventually will.
 *
 * It is equally not the *contract* model. `ContractModel` is a validation
 * projection that deliberately discards descriptions, tags, examples and
 * response descriptions (see contract-engine/src/types.ts) — precisely the
 * material documentation is made of. The two are complementary projections
 * of the same document, not layers of one another.
 */

// ---------------------------------------------------------------------------
// Provenance (spec §2, §5, §7, §19)
// ---------------------------------------------------------------------------

/**
 * Where a piece of documentation came from.
 *
 * Spec §2 forbids silently inventing API behavior and §7 requires that
 * collection-derived material be labelled rather than presented as
 * contractual. Making provenance a required field on every fact — rather
 * than a flag set at the top of a document — is what makes that guarantee
 * structural: there is no way to add an endpoint or an example to this model
 * without saying where it came from.
 *
 * - `openapi`   — stated by the specification. Contractual.
 * - `collection`— observed in a saved request. Real, but not a promise.
 * - `mock`      — produced by a Milestone 9 mock scenario. Deterministic,
 *                 and explicitly not the real API (spec §19).
 * - `derived`   — computed by API Lab from the above (coverage, drift).
 */
export const PROVENANCE_KINDS = ["openapi", "collection", "mock", "derived"] as const;
export type Provenance = (typeof PROVENANCE_KINDS)[number];

/**
 * The badge label attached to an individual fact — an endpoint, an example.
 * Phrased as a full statement because it appears next to the thing it
 * qualifies, where "OpenAPI" alone would read as part of the content.
 */
export const PROVENANCE_LABELS: Record<Provenance, string> = {
  openapi: "Source: OpenAPI",
  collection: "Source: Collection",
  mock: "Source: Mock",
  derived: "Source: API Lab",
};

/**
 * The bare name of a source, for lists that already say "Sources:".
 *
 * Kept separate from `PROVENANCE_LABELS` rather than derived by trimming a
 * prefix off it: the overview line rendered as "Sources: Source: OpenAPI"
 * before this existed, and a string-stripping helper would have reintroduced
 * that the first time a label was reworded.
 */
export const PROVENANCE_NAMES: Record<Provenance, string> = {
  openapi: "OpenAPI",
  collection: "Collection",
  mock: "Mock",
  derived: "API Lab",
};

// ---------------------------------------------------------------------------
// Schema description (spec §13, §14)
// ---------------------------------------------------------------------------

/**
 * A JSON Schema reduced to something a human reads.
 *
 * `kind: "reference"` is the circular-schema terminator required by spec §14.
 * When the walk re-enters a schema it is already inside, it emits a reference
 * node instead of recursing — so `User → Manager → User` documents as
 * "User → see User" and terminates, deterministically, at the same place
 * every time.
 */
export type SchemaDescription =
  | {
      kind: "object";
      /** Present when the schema was reached through a named `$ref`. */
      name: string | undefined;
      properties: SchemaProperty[];
      /** Set when MAX_SCHEMA_PROPERTIES clipped the property list. */
      truncated: boolean;
      description: string | undefined;
      additionalProperties: boolean;
    }
  | {
      kind: "array";
      items: SchemaDescription | undefined;
      description: string | undefined;
    }
  | {
      kind: "scalar";
      /** e.g. "string", "integer", "boolean", "string | null". */
      type: string;
      format: string | undefined;
      description: string | undefined;
      enumValues: string[] | undefined;
      constraints: string[];
    }
  | {
      kind: "union";
      /** "oneOf" | "anyOf" | "allOf" — stated, never collapsed. */
      combinator: string;
      options: SchemaDescription[];
      description: string | undefined;
    }
  | {
      /** The circular / already-seen terminator (spec §14). */
      kind: "reference";
      name: string;
      note: string;
    }
  | {
      /** A schema too deep to walk, or one with no usable type information. */
      kind: "unknown";
      note: string;
    };

export interface SchemaProperty {
  name: string;
  required: boolean;
  schema: SchemaDescription;
}

/** A schema documented by name in the Schemas section (spec §13). */
export interface DocumentedSchema {
  name: string;
  description: SchemaDescription;
}

// ---------------------------------------------------------------------------
// Endpoint parts (spec §8-§12)
// ---------------------------------------------------------------------------

export interface DocParameter {
  name: string;
  location: ParameterLocation;
  required: boolean;
  /** Rendered type, e.g. "string", "integer", "array of string". */
  type: string;
  description: string | undefined;
  /** Already redacted and stringified; never a live credential. */
  defaultValue: string | undefined;
  example: string | undefined;
  /** e.g. "minLength: 3", "maximum: 100", "pattern: ^[a-z]+$". */
  constraints: string[];
  provenance: Provenance;
}

export interface DocMediaType {
  contentType: string;
  schema: SchemaDescription | undefined;
}

export interface DocRequestBody {
  required: boolean;
  description: string | undefined;
  content: DocMediaType[];
  provenance: Provenance;
}

export interface DocResponseHeader {
  name: string;
  required: boolean;
  type: string;
  description: string | undefined;
}

export interface DocResponse {
  /** "200", "2XX", "default" — as the source wrote it. */
  status: string;
  description: string | undefined;
  headers: DocResponseHeader[];
  content: DocMediaType[];
  provenance: Provenance;
}

/**
 * A concrete request or response example.
 *
 * `body` has already been through `redactExampleBody` — there is no code path
 * that puts an unredacted body here, and the renderers do not redact.
 */
export interface DocExample {
  /** "Request" or a response status, plus a short qualifier. */
  title: string;
  kind: "request" | "response";
  contentType: string | undefined;
  /** Header pairs, already redacted (values of sensitive headers removed). */
  headers: Array<{ name: string; value: string }>;
  body: string | undefined;
  /** Set when MAX_EXAMPLE_BYTES clipped the body. */
  truncated: boolean;
  provenance: Provenance;
}

/**
 * How an endpoint is authenticated, described without ever carrying a
 * credential (spec §15, §16, §17).
 *
 * There is deliberately no `value`, `token`, or `credential` field anywhere
 * in this interface. Redaction that relies on remembering to call a function
 * is redaction that fails eventually; a model with nowhere to put a secret
 * cannot leak one.
 */
export interface DocAuthentication {
  /** The security scheme name, e.g. "bearerAuth". */
  name: string;
  /** "apiKey" | "http" | "oauth2" | "openIdConnect" | "collection". */
  type: string;
  /** e.g. "bearer", "basic" for http schemes. */
  scheme: string | undefined;
  /** For apiKey schemes: "header" | "query" | "cookie". */
  location: string | undefined;
  /** For apiKey schemes: the header/query parameter name. Not a secret. */
  parameterName: string | undefined;
  description: string | undefined;
  /** A placeholder-only usage line, e.g. "Authorization: Bearer {{token}}". */
  usage: string | undefined;
  provenance: Provenance;
}

/** Contract status for one endpoint (spec §20, §22). */
export interface DocContractStatus {
  /** Whether the specification documents this operation at all. */
  inSpecification: boolean;
  /** Whether a collection request exists for it. */
  inCollection: boolean;
  /** "aligned" | "missing-from-spec" | "missing-from-collection" | "mismatch". */
  alignment: string;
  detail: string | undefined;
}

export interface DocEndpoint {
  /** Stable, deterministic id derived from method + path (see id.ts). */
  id: string;
  method: HttpMethod;
  path: string;
  summary: string | undefined;
  description: string | undefined;
  operationId: string | undefined;
  deprecated: boolean;
  parameters: DocParameter[];
  request: DocRequestBody | undefined;
  responses: DocResponse[];
  examples: DocExample[];
  authentication: DocAuthentication[];
  contract: DocContractStatus | undefined;
  provenance: Provenance;
}

export interface DocGroup {
  name: string;
  description: string | undefined;
  /** "tag" | "folder" | "collection" | "default" — spec §28's precedence. */
  source: string;
  endpoints: DocEndpoint[];
}

// ---------------------------------------------------------------------------
// Coverage / drift metadata (spec §21, §22)
// ---------------------------------------------------------------------------

/**
 * QA metadata, labelled as such (spec §21).
 *
 * Spec §21 is explicit that coverage must not be represented as API quality.
 * The renderers therefore print these under a heading that says "QA metadata"
 * and never in the overview's headline block.
 */
export interface DocCoverage {
  totalOperations: number;
  coveredOperations: number;
  operationCoveragePercent: number;
  validatedOperations: number;
  validationCoveragePercent: number;
}

export interface DocDrift {
  matched: number;
  missingFromSpec: number;
  missingFromCollection: number;
  mismatched: number;
  entries: Array<{ method: string; path: string; alignment: string; detail: string }>;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export interface DocServer {
  url: string;
  description: string | undefined;
}

export interface DocMetadata {
  /** Which sources contributed, in precedence order. */
  sources: Provenance[];
  /** Raw `openapi` version string, when an OpenAPI source contributed. */
  openapiVersion: string | undefined;
  endpointCount: number;
  schemaCount: number;
  /**
   * Non-fatal notes: truncations, dropped operations, unsupported constructs.
   * Never empty-but-meaningful — an omission is always recorded here.
   */
  warnings: string[];
  /**
   * ISO timestamp, and `undefined` unless the caller explicitly asked for it.
   *
   * Spec §33 requires byte-identical output for identical input, and a
   * generation timestamp is the single most common way a generator quietly
   * breaks that guarantee. It is opt-in rather than opt-out for exactly that
   * reason.
   */
  generatedAt: string | undefined;
}

export interface Documentation {
  title: string;
  description: string | undefined;
  version: string | undefined;
  servers: DocServer[];
  authentication: DocAuthentication[];
  groups: DocGroup[];
  schemas: DocumentedSchema[];
  coverage: DocCoverage | undefined;
  drift: DocDrift | undefined;
  metadata: DocMetadata;
}

// ---------------------------------------------------------------------------
// Generation configuration (spec §32, §42)
// ---------------------------------------------------------------------------

export const DOC_FORMATS = ["html", "markdown", "json"] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

export const DOC_SOURCE_KINDS = ["openapi", "collection", "combined"] as const;
export type DocSourceKind = (typeof DOC_SOURCE_KINDS)[number];

export const DOC_GROUPING_MODES = ["auto", "tag", "folder", "none"] as const;
export type DocGroupingMode = (typeof DOC_GROUPING_MODES)[number];

/**
 * Which sections appear in the rendered output (spec §32).
 *
 * Sections are a *rendering* concern, not a model concern: the model always
 * contains everything the source provided, and the renderer omits. That way
 * turning a section back on never requires regenerating from source, and the
 * JSON export is always complete regardless of what the user was previewing.
 */
export interface DocSections {
  overview: boolean;
  authentication: boolean;
  endpoints: boolean;
  schemas: boolean;
  examples: boolean;
  contractStatus: boolean;
}

export function createDefaultSections(): DocSections {
  return {
    overview: true,
    authentication: true,
    endpoints: true,
    schemas: true,
    examples: true,
    contractStatus: false,
  };
}

/**
 * A persisted documentation configuration (spec §42).
 *
 * Holds *references* and settings only. Generated HTML is never persisted —
 * spec §42 forbids treating rendered output as the source of truth, and it
 * would go stale against its own specification within a day.
 */
export interface DocumentationConfig {
  id: string;
  name: string;
  sourceKind: DocSourceKind;
  /** Attached specification id (contract-engine), when applicable. */
  specificationId: string | undefined;
  /** Collection id (workspace-engine), when applicable. */
  collectionId: string | undefined;
  format: DocFormat;
  sections: DocSections;
  grouping: DocGroupingMode;
  /**
   * Whether examples derived from collection requests are included.
   *
   * Defaults to true; redaction applies regardless. This is not the secret
   * control — redaction is unconditional — it is an editorial one.
   */
  includeCollectionExamples: boolean;
  /** Opt-in generation timestamp. See DocMetadata.generatedAt. */
  includeTimestamp: boolean;
}

export interface DocumentationWorkspace {
  configs: DocumentationConfig[];
}

export const DOCUMENTATION_FORMAT_VERSION = 1;

export interface PersistedDocumentationWorkspace {
  version: number;
  documentation: DocumentationWorkspace;
}

// ---------------------------------------------------------------------------
// Rendering options
// ---------------------------------------------------------------------------

export interface RenderOptions {
  sections: DocSections;
  /** Embed the client-side search index and script (HTML only, spec §30). */
  includeSearch: boolean;
}

export function createDefaultRenderOptions(): RenderOptions {
  return { sections: createDefaultSections(), includeSearch: true };
}

export interface RenderedDocument {
  format: DocFormat;
  content: string;
  /** Companion files for a static site, e.g. `assets/styles.css` (spec §24). */
  assets: Array<{ path: string; content: string }>;
  /** Set when a size limit clipped the output. */
  truncated: boolean;
}
