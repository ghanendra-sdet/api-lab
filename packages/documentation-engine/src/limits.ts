/**
 * Resource limits for documentation generation (spec §35, §36).
 *
 * The threat model here is the same one contract-engine and security-engine
 * already answer, arriving through a third door: an OpenAPI document is
 * untrusted input, and documentation generation is the operation that walks
 * *all* of it — every description, every example, every nested schema — and
 * concatenates the result into a single string that a browser then has to
 * lay out.
 *
 * That last part is what makes these limits different in kind from M11's.
 * Contract validation touches one operation at a time and discards as it
 * goes. Documentation generation is inherently whole-document and inherently
 * accumulating, so a specification that validates comfortably can still
 * produce an HTML file large enough to lock up the tab that opens it. Every
 * value below exists to make that outcome impossible rather than unlikely.
 *
 * All limits degrade to a *truncation with a recorded warning*, never to a
 * thrown error and never to a silent omission. Documentation that quietly
 * dropped half an API would be worse than documentation that refused to
 * generate, so the omission is always stated in `Documentation.metadata`
 * and surfaced in the rendered output.
 */

/**
 * Maximum operations documented from one source.
 *
 * Lower than contract-engine's `MAX_OPERATIONS` (2000) on purpose. Those two
 * thousand operations are never all in memory as rendered prose at once
 * during validation; here they would be. At roughly 2-4 KB of rendered HTML
 * per documented operation, 1000 is already a multi-megabyte page.
 */
export const MAX_DOCUMENTED_OPERATIONS = 1_000;

/** Maximum named schemas documented in the Schemas section. */
export const MAX_DOCUMENTED_SCHEMAS = 500;

/**
 * Maximum depth walked when turning a JSON Schema into a readable
 * description. Mirrors contract-engine's `MAX_SCHEMA_DEPTH` rationale: an
 * unbounded recursive walk over untrusted structure is a stack overflow
 * waiting to happen, and a RangeError is not caught by a Zod boundary.
 *
 * Note this is a *second* line of defence, not the primary one. Circular
 * schemas are handled precisely by the visited-set in schema/describe.ts
 * (spec §14); this cap only bounds documents that are deep without being
 * circular.
 */
export const MAX_SCHEMA_DESCRIBE_DEPTH = 12;

/** Maximum properties described for one object schema. */
export const MAX_SCHEMA_PROPERTIES = 200;

/**
 * Maximum size of a single rendered example, in characters.
 *
 * Examples are the one part of documentation taken verbatim from a source
 * document or a recorded response, so they are the part most likely to be
 * enormous. A 4 MB example body embedded in a documentation page helps
 * nobody read the API.
 */
export const MAX_EXAMPLE_BYTES = 16 * 1024;

/**
 * Maximum size of the generated HTML document.
 *
 * Generation stops and records a truncation warning rather than handing the
 * browser a string it cannot render. This is the backstop for the case where
 * every individual limit above was respected and the total still ran away.
 */
export const MAX_HTML_BYTES = 8 * 1024 * 1024;

/** Maximum size of the generated Markdown document. */
export const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

/**
 * Maximum entries in the client-side search index embedded in generated HTML
 * (spec §27, §30). Spec §27 is explicit that M13 must not introduce a large
 * search infrastructure; the index is a flat array scanned with
 * `String.includes`, which is comfortably fast at this size and needs no
 * library, no server, and no build step.
 */
export const MAX_SEARCH_INDEX_ENTRIES = 2_000;

/**
 * Maximum length of any single free-text field (description, summary) copied
 * into the documentation model. Bounds the prose layer the same way the
 * example limit bounds the data layer.
 */
export const MAX_TEXT_LENGTH = 8 * 1024;
