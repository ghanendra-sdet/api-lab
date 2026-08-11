import { MAX_SCHEMA_DEPTH } from "./limits.ts";
import { checkPatternSafety } from "./redos.ts";
import type { JsonSchema, OpenApiVersion } from "./types.ts";

/**
 * Normalizes an OpenAPI schema object into a JSON Schema the validator can
 * evaluate under a single dialect (2020-12).
 *
 * ## Why normalize instead of switching dialects
 *
 * The chosen validator (@cfworker/json-schema) supports drafts 4, 7, 2019-09
 * and 2020-12, so an obvious alternative was to validate 3.0 documents as
 * draft-4 and 3.1 documents as 2020-12. That was rejected: OpenAPI 3.0's
 * schema object is *not* draft-4. It is a modified subset with its own
 * keywords (`nullable`) that no JSON Schema draft understands, so a
 * dialect switch would still leave the 3.0-specific keywords unhandled while
 * doubling the number of code paths under test.
 *
 * Instead there is one dialect (2020-12) and one explicit, tested
 * transformation from 3.0 into it. Spec §11 requires the difference to be
 * handled deliberately rather than by applying one version's rules to the
 * other, and an explicit transformation is what makes that auditable.
 *
 * ## The 3.0 → 2020-12 differences that materially affect validation
 *
 * 1. **`nullable: true`** — 3.0's way of saying "or null". Verified against
 *    the validator: `{type: "string", nullable: true}` *rejects* `null`,
 *    because `nullable` is not a JSON Schema keyword and is ignored as an
 *    unknown annotation. Left untranslated, every nullable field in every
 *    3.0 document would produce a false contract violation. Translated here
 *    to `type: ["string", "null"]`.
 *
 * 2. **Boolean `exclusiveMinimum`/`exclusiveMaximum`** — 3.0 (following
 *    draft-4) writes `{minimum: 5, exclusiveMinimum: true}`; 2020-12 writes
 *    `{exclusiveMinimum: 5}`. Left untranslated the bound would be dropped
 *    and an out-of-range value would pass.
 *
 * OpenAPI 3.1 is already JSON Schema 2020-12, so for 3.1 documents the walk
 * performs no dialect translation — only the security screening below, which
 * applies to both versions.
 *
 * ## Screening applied to both versions
 *
 * `pattern` keywords are screened by redos.ts and *removed* when unsafe,
 * with a warning recorded. Removing the keyword rather than trusting the
 * validator to survive it is mitigation by construction — the same choice
 * mock-engine made by refusing user-supplied route regexes outright.
 */

export interface NormalizeResult {
  schema: JsonSchema | undefined;
  warnings: string[];
}

const OPENAPI_ONLY_KEYS = new Set([
  "nullable",
  "discriminator",
  "xml",
  "externalDocs",
  "example",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Subschema-valued keywords: their value is itself a schema. */
const SCHEMA_VALUED_KEYS = new Set([
  "items",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "propertyNames",
  "additionalProperties",
  "additionalItems",
  "unevaluatedProperties",
  "unevaluatedItems",
]);

/** Keywords whose value is an array of schemas. */
const SCHEMA_ARRAY_KEYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

/** Keywords whose value is a map of name → schema. */
const SCHEMA_MAP_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

function normalizeNode(
  node: unknown,
  version: OpenApiVersion,
  depth: number,
  warnings: string[],
  seenPatternWarnings: Set<string>,
): JsonSchema | undefined {
  // Booleans are valid JSON Schemas (`true` = anything, `false` = nothing).
  if (typeof node === "boolean") return node;
  if (!isPlainObject(node)) return undefined;

  if (depth > MAX_SCHEMA_DEPTH) {
    warnings.push(
      `Schema nesting exceeded the ${MAX_SCHEMA_DEPTH}-level limit; the deeper levels were not validated.`,
    );
    return true; // Accept anything below the limit rather than reject wrongly.
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    // `__proto__` and friends arriving from an untrusted document must never
    // reach an object literal's prototype. Mirrors environment-engine's and
    // runner-engine's existing hardening.
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;

    if (SCHEMA_VALUED_KEYS.has(key)) {
      const child = normalizeNode(value, version, depth + 1, warnings, seenPatternWarnings);
      if (child !== undefined) out[key] = child;
      continue;
    }

    if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      out[key] = value.map((entry) => normalizeNode(entry, version, depth + 1, warnings, seenPatternWarnings) ?? true);
      continue;
    }

    if (SCHEMA_MAP_KEYS.has(key) && isPlainObject(value)) {
      const mapped: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(value)) {
        if (name === "__proto__" || name === "constructor" || name === "prototype") continue;
        const child = normalizeNode(entry, version, depth + 1, warnings, seenPatternWarnings);
        if (child !== undefined) mapped[name] = child;
      }
      out[key] = mapped;
      continue;
    }

    if (key === "pattern" && typeof value === "string") {
      const safety = checkPatternSafety(value);
      if (safety.safe) {
        out[key] = value;
      } else if (!seenPatternWarnings.has(value)) {
        seenPatternWarnings.add(value);
        warnings.push(`Pattern validation skipped for /${value}/ — ${safety.reason}.`);
      }
      continue;
    }

    // 3.0-only keywords are handled below or dropped; they are meaningless
    // (and in `nullable`'s case actively misleading) under 2020-12.
    if (OPENAPI_ONLY_KEYS.has(key)) continue;

    // draft-4-style boolean exclusive bounds, rewritten to the numeric form.
    if (key === "exclusiveMinimum" || key === "exclusiveMaximum") {
      if (typeof value === "boolean") continue; // Handled after the loop.
      out[key] = value;
      continue;
    }

    out[key] = value;
  }

  if (version === "3.0") {
    applyThreeZeroSemantics(node, out);
  }

  return out;
}

/**
 * The two OpenAPI 3.0 constructs that change what validates. Applied only
 * for 3.0 documents — running these against a 3.1 document would be exactly
 * the "blindly apply 3.0 rules to 3.1" mistake spec §11 forbids, and would
 * corrupt a legitimate 3.1 schema that happens to use `exclusiveMinimum`
 * numerically.
 */
function applyThreeZeroSemantics(source: Record<string, unknown>, out: Record<string, unknown>): void {
  if (source.nullable === true) {
    const type = out.type;
    if (typeof type === "string") {
      out.type = [type, "null"];
    } else if (Array.isArray(type)) {
      if (!type.includes("null")) out.type = [...type, "null"];
    } else if (type === undefined) {
      // No declared type: `nullable` alone constrains nothing in 3.0, and
      // inventing `type: ["null"]` here would wrongly reject every non-null
      // value. Correctly a no-op.
    }
  }

  if (source.exclusiveMinimum === true && typeof source.minimum === "number") {
    out.exclusiveMinimum = source.minimum;
    delete out.minimum;
  }
  if (source.exclusiveMaximum === true && typeof source.maximum === "number") {
    out.exclusiveMaximum = source.maximum;
    delete out.maximum;
  }
}

/** Normalizes one schema object. Never throws. */
export function normalizeSchema(raw: unknown, version: OpenApiVersion): NormalizeResult {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { schema: undefined, warnings };
  const schema = normalizeNode(raw, version, 0, warnings, new Set());
  return { schema, warnings };
}

/**
 * Normalizes the document's `components` object. `components.schemas` holds
 * schemas that `$ref` pointers resolve into, so they need exactly the same
 * treatment as inline schemas — a `nullable` inside `#/components/schemas/User`
 * is no less wrong for being behind a reference.
 */
export function normalizeComponents(
  raw: unknown,
  version: OpenApiVersion,
): { components: Record<string, unknown> | undefined; warnings: string[] } {
  if (!isPlainObject(raw)) return { components: undefined, warnings: [] };

  const warnings: string[] = [];
  const seen = new Set<string>();
  const out: Record<string, unknown> = {};

  for (const [section, value] of Object.entries(raw)) {
    if (section === "__proto__" || section === "constructor" || section === "prototype") continue;
    if (!isPlainObject(value)) continue;

    const mapped: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(value)) {
      if (name === "__proto__" || name === "constructor" || name === "prototype") continue;
      // Only `schemas` holds bare JSON Schemas. Other component sections
      // (responses, parameters, requestBodies…) are OpenAPI objects that
      // merely *contain* schemas; they are retained verbatim so pointers
      // into them still resolve structurally.
      mapped[name] =
        section === "schemas" ? (normalizeNode(entry, version, 0, warnings, seen) ?? true) : entry;
    }
    out[section] = mapped;
  }

  return { components: out, warnings };
}
