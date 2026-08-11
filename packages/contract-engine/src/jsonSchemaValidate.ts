import { Validator, type OutputUnit, type Schema } from "@cfworker/json-schema";
import { MAX_VIOLATIONS } from "./limits.ts";
import type { ContractViolation, JsonSchema, ViolationLocation } from "./types.ts";

/**
 * The boundary between API Lab and the JSON Schema validator
 * (@cfworker/json-schema).
 *
 * ## Why this validator
 *
 * Spec §10 requires a mature validator rather than a hand-rolled one, and
 * the obvious candidate was ajv. ajv was rejected for this codebase after
 * inspection: it compiles each schema into JavaScript source and evaluates
 * it with `new Function` (`ajv/dist/compile/index.js`). API Lab runs in the
 * browser and treats OpenAPI documents as untrusted input, and spec §40
 * requires that "contract schemas themselves must not become an execution
 * mechanism". Turning an imported third-party document into generated,
 * evaluated code is the opposite of that, and it forces any deployment to
 * relax its Content-Security-Policy to allow `unsafe-eval`.
 *
 * @cfworker/json-schema is a pure interpreter — no `new Function`, no
 * `eval`, verified by inspecting its published bundle — with zero runtime
 * dependencies, ESM and CJS builds, bundled types, and support for drafts 4,
 * 7, 2019-09 and 2020-12. It runs unchanged in the browser and under Node,
 * which is what a pure engine package in this repo is required to do.
 *
 * ## Supported keywords
 *
 * Everything spec §10 lists is genuinely evaluated: `type`, `required`,
 * `properties`, `items`, `enum`, `const`, `minimum`, `maximum`,
 * `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`,
 * `maxLength`, `pattern`, `minItems`, `maxItems`, `uniqueItems`,
 * `minProperties`, `maxProperties`, `additionalProperties`,
 * `patternProperties`, `propertyNames`, `oneOf`, `anyOf`, `allOf`, `not`,
 * `if`/`then`/`else`, `$ref`/`$defs`, and `format`. OpenAPI 3.0's
 * `nullable` is translated before it reaches here (see schemaNormalize.ts).
 * The exact supported `format` list is FORMAT-ASSERTED below — anything
 * else is reported as a warning rather than silently passing.
 */

/**
 * Formats the validator actually asserts, read from its published
 * implementation. OpenAPI's own additional formats (`int32`, `int64`,
 * `float`, `double`, `byte`, `binary`, `password`) and JSON Schema's `date`,
 * `uri`, `idn-email`, `iri` are NOT in this list — a schema using one is
 * accepted structurally but reported as an unvalidated format warning, never
 * as a pass (spec §23).
 */
export const ASSERTED_FORMATS = [
  "date-time",
  "duration",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "json-pointer",
  "json-pointer-uri-fragment",
  "regex",
  "relative-json-pointer",
  "time",
  "uri-reference",
  "uri-template",
  "url",
  "uuid",
] as const;

const ASSERTED_FORMAT_SET = new Set<string>(ASSERTED_FORMATS);

export function isAssertedFormat(format: string): boolean {
  return ASSERTED_FORMAT_SET.has(format);
}

/**
 * Container keywords whose own error is redundant once a more specific error
 * exists inside them. `properties` reporting "Property "id" does not match
 * schema" adds nothing next to `type` reporting "Expected integer at $.id".
 */
const CONTAINER_KEYWORDS = new Set([
  "properties",
  "items",
  "prefixItems",
  "patternProperties",
  "additionalProperties",
  "dependentSchemas",
  "contains",
  "allOf",
  "$ref",
]);

/**
 * Keywords whose failure is best explained at their own level. When a value
 * fails `oneOf`, the per-branch errors underneath describe branches the user
 * never intended to match and are pure noise, so descendants are suppressed.
 */
const SUPPRESS_DESCENDANTS_KEYWORDS = new Set(["oneOf", "anyOf", "not"]);

// ---------------------------------------------------------------------------
// JSON pointer helpers
// ---------------------------------------------------------------------------

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function pointerSegments(pointer: string): string[] {
  const withoutHash = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (withoutHash === "" || withoutHash === "/") return [];
  return withoutHash.split("/").filter((part) => part !== "").map(decodePointerSegment);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Converts an instance pointer into the `$.data.users[2].id` notation the
 * milestone spec uses throughout (§13, §16, §17). Array indices become
 * bracketed so a failing element is identifiable at a glance, and keys that
 * are not plain identifiers are bracket-quoted so the path stays unambiguous.
 */
export function pointerToJsonPath(pointer: string): string {
  let path = "$";
  for (const segment of pointerSegments(pointer)) {
    if (/^\d+$/.test(segment)) path += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) path += `.${segment}`;
    else path += `[${JSON.stringify(segment)}]`;
  }
  return path;
}

function resolvePointer(root: unknown, pointer: string): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (typeof current === "object" && current !== null && segment in current) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

// ---------------------------------------------------------------------------
// Human-readable value descriptions
// ---------------------------------------------------------------------------

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function describeValue(value: unknown): string {
  if (value === undefined) return "(absent)";
  if (typeof value === "string") return value.length > 60 ? `${JSON.stringify(value.slice(0, 60))}…` : JSON.stringify(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return jsonTypeOf(value);
  return serialized.length > 60 ? `${jsonTypeOf(value)} (${serialized.slice(0, 60)}…)` : serialized;
}

function describeExpectation(keyword: string, schemaValue: unknown, fallback: string): string {
  if (schemaValue === undefined) return fallback;
  if (keyword === "type") {
    return Array.isArray(schemaValue) ? schemaValue.join(" or ") : String(schemaValue);
  }
  if (keyword === "enum" && Array.isArray(schemaValue)) {
    return `one of ${schemaValue.map((entry) => JSON.stringify(entry)).join(", ")}`;
  }
  if (typeof schemaValue === "object") return fallback;
  return String(schemaValue);
}

/**
 * Resolves the failing keyword's value out of the schema so `expected` states
 * what the contract actually said, rather than re-parsing the validator's
 * prose. Falls back to the validator's message when the keyword location
 * runs through a `$ref` and cannot be resolved literally.
 */
function lookupExpected(root: JsonSchema, error: OutputUnit): string {
  const resolved = resolvePointer(root, error.keywordLocation);
  const fallbackMatch = /Expected "?([^".]+)"?\.?$/.exec(error.error);
  const fallback = fallbackMatch?.[1]?.trim() ?? error.error;
  if (!resolved.found) return fallback;
  return describeExpectation(error.keyword, resolved.value, fallback);
}

// ---------------------------------------------------------------------------
// Error normalization
// ---------------------------------------------------------------------------

function isDescendantOf(pointer: string, ancestor: string): boolean {
  return pointer !== ancestor && pointer.startsWith(ancestor === "#" ? "#/" : `${ancestor}/`);
}

/**
 * Turns the validator's raw output tree into a flat, de-duplicated list of
 * contract violations, each identifying the precise JSON path that failed.
 *
 * Spec §16 asks for multiple useful violations in one result rather than
 * only the first, which is why the validator runs with `shortCircuit`
 * disabled — at the cost of needing exactly this de-noising pass.
 */
export function normalizeSchemaErrors(
  errors: OutputUnit[],
  location: ViolationLocation,
  root: JsonSchema,
  instance: unknown,
): ContractViolation[] {
  // Composition branches are suppressed by *keyword* location, not instance
  // location. When `oneOf` fails at the root, each branch's own error is
  // reported at the same instance location (`#`), so an instance-location
  // comparison would suppress nothing. Their keyword locations, however, are
  // nested under the composition's (`#/oneOf/0/type` under `#/oneOf`), which
  // distinguishes a branch's error from a genuinely independent sibling
  // failure such as `#/required` that must still be reported.
  const suppressionRoots = errors
    .filter((error) => SUPPRESS_DESCENDANTS_KEYWORDS.has(error.keyword))
    .map((error) => error.keywordLocation);

  const retained = errors.filter((error) => {
    if (suppressionRoots.some((ancestor) => isDescendantOf(error.keywordLocation, ancestor))) return false;

    if (CONTAINER_KEYWORDS.has(error.keyword)) {
      // Containers are judged by *instance* location: the validator reports
      // `additionalProperties` against the containing object while the
      // specific error lands on the offending property, and only the
      // instance path relates the two.
      const hasSpecificChild = errors.some(
        (other) =>
          other !== error &&
          !CONTAINER_KEYWORDS.has(other.keyword) &&
          (isDescendantOf(other.instanceLocation, error.instanceLocation) ||
            other.instanceLocation === error.instanceLocation),
      );
      return !hasSpecificChild;
    }

    return true;
  });

  const violations: ContractViolation[] = [];
  const seen = new Set<string>();

  for (const error of retained) {
    const path = pointerToJsonPath(error.instanceLocation);
    const actualValue = resolvePointer(instance, error.instanceLocation);

    let keyword = error.keyword;
    let message = error.error;
    let expected = lookupExpected(root, error);
    let actual = actualValue.found ? describeValue(actualValue.value) : "(absent)";

    if (keyword === "false") {
      // The validator's representation of a value matched against the schema
      // `false`. In practice this is almost always `additionalProperties:
      // false` rejecting an undocumented property (spec §14).
      const segments = pointerSegments(error.instanceLocation);
      const property = segments[segments.length - 1];
      keyword = "additionalProperties";
      expected = "no additional properties";
      message =
        property === undefined
          ? "Value is not permitted by the contract."
          : `Property "${property}" is not documented and the contract sets additionalProperties: false.`;
    } else if (keyword === "required") {
      // The missing property's name is in the message, not the pointer —
      // the pointer addresses the containing object (spec §15 wants the path).
      const missing = /required property "([^"]+)"/.exec(error.error)?.[1];
      if (missing !== undefined) {
        const base = pointerToJsonPath(error.instanceLocation);
        const childPath = IDENTIFIER.test(missing)
          ? `${base}.${missing}`
          : `${base}[${JSON.stringify(missing)}]`;
        expected = "present (required)";
        actual = "(absent)";
        message = `Missing required property: ${missing}`;
        violations.push({ location, path: childPath, keyword, expected, actual, message, severity: "error" });
        seen.add(`${childPath}|${keyword}`);
        continue;
      }
    } else if (keyword === "type") {
      actual = actualValue.found ? jsonTypeOf(actualValue.value) : "(absent)";
      message = `Expected ${expected}, received ${actual}.`;
    }

    const dedupeKey = `${path}|${keyword}|${message}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    violations.push({ location, path, keyword, expected, actual, message, severity: "error" });
    if (violations.length >= MAX_VIOLATIONS) break;
  }

  return dropEchoedAdditionalProperties(violations);
}

/**
 * Removes `additionalProperties` violations for properties the contract
 * plainly documents.
 *
 * The validator reports `additionalProperties` against any property that did
 * not *successfully* match the `properties` subschema — which includes
 * documented properties that failed their own validation, not just genuinely
 * undocumented ones. Left alone, a response whose documented `users` array
 * contains one bad element is reported twice: once for the real type error
 * deep inside the array, and once claiming `users` itself is undocumented.
 * The second message is simply false, and it is the more prominent of the
 * two.
 *
 * A property that failed its own documented schema always produces another
 * violation at or below its path, so that other violation is the reliable
 * signal that the property *was* documented. A genuinely undocumented
 * property — spec §14's `debug` field — has no other violation beneath it
 * and is therefore retained.
 */
function dropEchoedAdditionalProperties(violations: ContractViolation[]): ContractViolation[] {
  return violations.filter((violation) => {
    if (violation.keyword !== "additionalProperties") return true;
    return !violations.some(
      (other) =>
        other !== violation &&
        other.keyword !== "additionalProperties" &&
        (other.path === violation.path ||
          other.path.startsWith(`${violation.path}.`) ||
          other.path.startsWith(`${violation.path}[`)),
    );
  });
}

// ---------------------------------------------------------------------------
// Validation entry point
// ---------------------------------------------------------------------------

/**
 * Assembles the root document handed to the validator.
 *
 * A schema pulled out of an operation may contain `$ref:
 * "#/components/schemas/User"`, and JSON pointers resolve against the root
 * of the schema document. Passing the bare subschema would leave every such
 * pointer dangling, so the components object is re-attached alongside it —
 * verified to resolve correctly, including recursive references.
 */
export function buildValidationRoot(
  schema: JsonSchema,
  components: Record<string, unknown> | undefined,
): JsonSchema {
  if (typeof schema === "boolean" || components === undefined) return schema;
  return { ...schema, components };
}

export function validateAgainstSchema(
  schema: JsonSchema,
  components: Record<string, unknown> | undefined,
  instance: unknown,
  location: ViolationLocation,
): ContractViolation[] {
  const root = buildValidationRoot(schema, components);
  // `shortCircuit: false` — spec §16 wants every useful violation, not the
  // first one. Draft 2020-12 is the single dialect: 3.0 documents are
  // translated into it up front (see schemaNormalize.ts).
  const validator = new Validator(root as Schema | boolean, "2020-12", false);

  let output: { valid: boolean; errors: OutputUnit[] };
  try {
    output = validator.validate(instance);
  } catch (error) {
    // A malformed schema (unresolvable $ref, cyclic structure the validator
    // rejects) must never escape as an exception into the request pipeline.
    return [
      {
        location,
        path: "$",
        keyword: "schema",
        expected: "a resolvable JSON Schema",
        actual: "unresolvable",
        message: `The contract's schema could not be evaluated: ${error instanceof Error ? error.message : "unknown error"}.`,
        severity: "warning",
      },
    ];
  }

  if (output.valid) return [];
  return normalizeSchemaErrors(output.errors, location, root, instance);
}
