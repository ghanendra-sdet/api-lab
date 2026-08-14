import type { JsonSchema } from "@api-lab/contract-engine";
import { MAX_SCHEMA_DESCRIBE_DEPTH, MAX_SCHEMA_PROPERTIES } from "../limits.ts";
import { capText } from "../redact.ts";
import type { SchemaDescription, SchemaProperty } from "../types.ts";

/**
 * JSON Schema → readable description (spec §13, §14).
 *
 * ## The problem this file exists to solve
 *
 * A JSON Schema is a graph, not a tree. `$ref` can point anywhere, including
 * back at an ancestor, and real specifications do this constantly — a `User`
 * with a `manager: User`, a `Comment` with `replies: Comment[]`, an
 * organisation tree. A naive recursive renderer meets one of these and either
 * blows the stack or emits until it runs out of memory. Spec §14 calls this
 * out specifically and requires a deterministic reference representation
 * instead.
 *
 * ## The mechanism
 *
 * Two independent guards, doing different jobs:
 *
 * 1. **The visited set** is the correct fix, and handles cycles exactly. It
 *    tracks the `$ref` pointers on the current *path* — not every ref seen
 *    anywhere — so re-entering a schema you are already inside emits
 *    `{ kind: "reference", name: "User" }`, rendered as "User → see User".
 *
 *    Path-scoped rather than globally-scoped matters. A global set would
 *    collapse the second, third and fourth *sibling* use of `Address` into
 *    bare references too, which is not a cycle and produces documentation
 *    where most fields are unexplained cross-references. Sibling reuse
 *    expands; only genuine recursion terminates.
 *
 * 2. **The depth cap** is a backstop for documents that are deep without
 *    being circular — a hand-written schema nested forty levels deep is not
 *    recursive, so the visited set never fires, and the stack is still
 *    finite. It emits `kind: "unknown"` with a note rather than silently
 *    stopping.
 *
 * Both terminate with a *stated* node. Neither ever truncates silently: a
 * reader has to be able to tell "this is recursive" apart from "this is all
 * there is".
 */

/** The document root that `$ref` pointers resolve against. */
export interface SchemaResolutionContext {
  /** The specification's `components` object, as retained by contract-engine. */
  components: Record<string, unknown> | undefined;
}

/**
 * Resolves an internal `$ref` pointer.
 *
 * Only `#/`-rooted internal pointers resolve. External refs
 * (`./common.yaml#/User`, `https://…`) return undefined and document as an
 * unknown node — resolving them would mean fetching an attacker-controlled
 * URL at documentation-generation time, which is not something a documentation
 * generator should ever do. The same position contract-engine takes.
 */
export function resolveRef(
  ref: string,
  context: SchemaResolutionContext,
): { schema: JsonSchema; name: string } | undefined {
  if (!ref.startsWith("#/")) return undefined;

  const segments = ref
    .slice(2)
    .split("/")
    // RFC 6901 pointer escaping: ~1 is "/", ~0 is "~". Order matters —
    // decoding ~0 first would turn "~01" into "~1" and then into "/".
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  if (segments[0] !== "components") return undefined;

  let current: unknown = context.components;
  for (const segment of segments.slice(1)) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  if (current === undefined || current === null) return undefined;
  if (typeof current !== "object" && typeof current !== "boolean") return undefined;

  return { schema: current as JsonSchema, name: segments[segments.length - 1] ?? ref };
}

/** Reads a string field from a schema object, ignoring non-strings. */
function stringField(schema: Record<string, unknown>, key: string): string | undefined {
  const value = schema[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Renders the `type` keyword as a display string.
 *
 * OpenAPI 3.1 permits `type: ["string", "null"]`, which is how 3.1 expresses
 * nullability, and contract-engine's normalizer converts 3.0's
 * `nullable: true` into exactly that shape. Rendering the array as
 * "string | null" therefore documents both dialects identically, which is the
 * point — a reader should not have to know which OpenAPI version the team
 * used to know whether a field can be null.
 */
function renderType(schema: Record<string, unknown>): string | undefined {
  const type = schema.type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const parts = type.filter((entry): entry is string => typeof entry === "string");
    if (parts.length > 0) return parts.join(" | ");
  }
  return undefined;
}

/**
 * Collects the human-meaningful validation keywords as display strings.
 *
 * Deliberately a fixed, ordered list rather than "every keyword that is not
 * one we handle". Ordering it explicitly keeps output deterministic
 * regardless of the source document's key order (spec §33), and enumerating
 * it keeps internal bookkeeping keywords from leaking into prose.
 */
function collectConstraints(schema: Record<string, unknown>): string[] {
  const constraints: string[] = [];
  const numeric = [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
  ] as const;

  for (const key of numeric) {
    const value = schema[key];
    if (typeof value === "number" || typeof value === "boolean") {
      constraints.push(`${key}: ${String(value)}`);
    }
  }

  const pattern = stringField(schema, "pattern");
  // The pattern is documentation, never compiled here. contract-engine's
  // three-layer ReDoS screening governs whether it is ever *executed*; this
  // package only ever prints it, and printing a hostile regex is harmless.
  if (pattern !== undefined) constraints.push(`pattern: ${pattern}`);

  if (schema.uniqueItems === true) constraints.push("uniqueItems: true");
  if (schema.readOnly === true) constraints.push("readOnly: true");
  if (schema.writeOnly === true) constraints.push("writeOnly: true");

  return constraints;
}

function renderEnum(schema: Record<string, unknown>): string[] | undefined {
  const values = schema.enum;
  if (!Array.isArray(values) || values.length === 0) return undefined;
  return values.map((value) => (typeof value === "string" ? value : JSON.stringify(value) ?? "null"));
}

/**
 * Describes a schema for human consumption.
 *
 * `visitedRefs` is the path-scoped cycle guard described at the top of this
 * file. Callers pass nothing; recursion threads it.
 */
export function describeSchema(
  schema: JsonSchema | undefined,
  context: SchemaResolutionContext,
  depth: number = MAX_SCHEMA_DESCRIBE_DEPTH,
  visitedRefs: ReadonlySet<string> = new Set<string>(),
  /** The `$ref` name this schema was reached through, if any. */
  refName: string | undefined = undefined,
): SchemaDescription {
  if (schema === undefined) {
    return { kind: "unknown", note: "No schema provided." };
  }

  // `true` accepts anything, `false` accepts nothing. Both are legal schemas
  // and both need saying out loud rather than rendering as an empty object.
  if (typeof schema === "boolean") {
    return {
      kind: "unknown",
      note: schema ? "Any value is permitted." : "No value is permitted.",
    };
  }

  if (depth <= 0) {
    return {
      kind: "unknown",
      note: `Nested more than ${MAX_SCHEMA_DESCRIBE_DEPTH} levels deep; not expanded.`,
    };
  }

  const object = schema as Record<string, unknown>;

  // --- $ref -------------------------------------------------------------
  const ref = stringField(object, "$ref");
  if (ref !== undefined) {
    if (visitedRefs.has(ref)) {
      // The cycle terminator required by spec §14.
      const name = ref.split("/").pop() ?? ref;
      return { kind: "reference", name, note: `see ${name}` };
    }

    const resolved = resolveRef(ref, context);
    if (resolved === undefined) {
      const name = ref.split("/").pop() ?? ref;
      return { kind: "reference", name, note: `see ${name} (not resolvable in this document)` };
    }

    const nextVisited = new Set(visitedRefs);
    nextVisited.add(ref);
    return describeSchema(resolved.schema, context, depth - 1, nextVisited, resolved.name);
  }

  const description = capText(stringField(object, "description"));

  // --- combinators ------------------------------------------------------
  for (const combinator of ["oneOf", "anyOf", "allOf"] as const) {
    const options = object[combinator];
    if (Array.isArray(options) && options.length > 0) {
      return {
        kind: "union",
        combinator,
        options: options.map((option) =>
          describeSchema(option as JsonSchema, context, depth - 1, visitedRefs),
        ),
        description,
      };
    }
  }

  const type = renderType(object);

  // --- array ------------------------------------------------------------
  if (type === "array" || (type === undefined && object.items !== undefined)) {
    return {
      kind: "array",
      items:
        object.items === undefined
          ? undefined
          : describeSchema(object.items as JsonSchema, context, depth - 1, visitedRefs),
      description,
    };
  }

  // --- object -----------------------------------------------------------
  const rawProperties = object.properties;
  if (type === "object" || (type === undefined && typeof rawProperties === "object" && rawProperties !== null)) {
    const required = new Set(
      Array.isArray(object.required)
        ? object.required.filter((entry): entry is string => typeof entry === "string")
        : [],
    );

    const entries = Object.entries((rawProperties as Record<string, unknown>) ?? {});
    // Sorted for determinism (spec §33): object key order in a parsed YAML or
    // JSON document is stable in practice but is not something to depend on
    // across parsers, and required-first is more readable regardless.
    entries.sort(([a], [b]) => {
      const aRequired = required.has(a);
      const bRequired = required.has(b);
      if (aRequired !== bRequired) return aRequired ? -1 : 1;
      return a.localeCompare(b);
    });

    const truncated = entries.length > MAX_SCHEMA_PROPERTIES;
    const properties: SchemaProperty[] = entries
      .slice(0, MAX_SCHEMA_PROPERTIES)
      .map(([name, value]) => ({
        name,
        required: required.has(name),
        schema: describeSchema(value as JsonSchema, context, depth - 1, visitedRefs),
      }));

    return {
      kind: "object",
      name: refName,
      properties,
      truncated,
      description,
      additionalProperties: object.additionalProperties !== false,
    };
  }

  // --- scalar -----------------------------------------------------------
  if (type === undefined && description === undefined && Object.keys(object).length === 0) {
    return { kind: "unknown", note: "Any value is permitted." };
  }

  return {
    kind: "scalar",
    type: type ?? "any",
    format: stringField(object, "format"),
    description,
    enumValues: renderEnum(object),
    constraints: collectConstraints(object),
  };
}

/**
 * A one-line type label for a schema — what a parameter table cell shows.
 *
 * Separate from `describeSchema` because a table cell and an expanded schema
 * block have genuinely different jobs: the cell needs to fit, so it names the
 * type and stops, while the block explains. Deriving the cell from the block
 * would mean either a truncated block or an unreadable cell.
 */
export function schemaTypeLabel(description: SchemaDescription): string {
  switch (description.kind) {
    case "object":
      return description.name ?? "object";
    case "array": {
      if (description.items === undefined) return "array";
      return `array of ${schemaTypeLabel(description.items)}`;
    }
    case "scalar":
      return description.format === undefined
        ? description.type
        : `${description.type} (${description.format})`;
    case "union":
      return description.options.map((option) => schemaTypeLabel(option)).join(
        description.combinator === "allOf" ? " & " : " | ",
      );
    case "reference":
      return description.name;
    case "unknown":
      return "any";
  }
}

/**
 * Collects the named schemas from a document's `components.schemas` for the
 * Schemas section (spec §13).
 *
 * Sorted by name for determinism, and capped. Each is described with an empty
 * visited set seeded with its own pointer, so a self-referential schema
 * documents its own recursion as "see User" at the point it recurs rather
 * than expanding one redundant level first.
 */
export function collectNamedSchemas(
  context: SchemaResolutionContext,
  maxSchemas: number,
): { schemas: Array<{ name: string; description: SchemaDescription }>; truncated: boolean } {
  const raw = context.components?.schemas;
  if (typeof raw !== "object" || raw === null) return { schemas: [], truncated: false };

  const names = Object.keys(raw as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
  const truncated = names.length > maxSchemas;

  const schemas = names.slice(0, maxSchemas).map((name) => {
    const pointer = `#/components/schemas/${name}`;
    return {
      name,
      description: describeSchema(
        (raw as Record<string, unknown>)[name] as JsonSchema,
        context,
        MAX_SCHEMA_DESCRIBE_DEPTH,
        new Set([pointer]),
        name,
      ),
    };
  });

  return { schemas, truncated };
}
