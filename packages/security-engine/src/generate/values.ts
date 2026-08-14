import { MAX_BOUNDARY_MAGNITUDE, MAX_MUTATED_STRING_LENGTH } from "../limits.ts";
import { INVALID_ENUM_VALUE, INVALID_INTEGER_VALUE, INVALID_UUID_VALUE } from "../credentials.ts";
import type { SchemaField } from "./schemaFields.ts";

/**
 * Bounded value synthesis for mutations (spec §7-§10).
 *
 * Every function here returns a value derived from the schema's own
 * declarations, clamped by limits.ts. Nothing is random, nothing is
 * attacker-shaped, and nothing grows with the size of a number written in an
 * imported document — a specification declaring `maxLength: 50000000` gets a
 * 4 KB string and a warning, not a 50 MB request body.
 *
 * Determinism matters beyond safety: a security test that generates a
 * different value each run cannot be triaged, because the failure a developer
 * reproduces is not the failure that was reported.
 */

/** The primary declared type, ignoring an accompanying `"null"` (which 3.1
 * documents and normalized 3.0 documents both use for nullability). */
export function primaryType(field: Pick<SchemaField, "types">): string | undefined {
  return field.types.find((type) => type !== "null");
}

/**
 * A well-formed value of a *different* JSON type (spec §7).
 *
 * The spec's own example is `age: 25 → age: "invalid"`. The inverse case —
 * a string field receiving a number — matters just as much, because a
 * surprising number of APIs coerce `"25"` and `25` interchangeably and only
 * discover it when a client sends the wrong one.
 */
export function wrongTypeValue(field: Pick<SchemaField, "types">): { value: unknown; describe: string } | null {
  switch (primaryType(field)) {
    case "string":
      return { value: 12345, describe: "a number where a string is declared" };
    case "integer":
    case "number":
      return { value: "invalid", describe: "a string where a number is declared" };
    case "boolean":
      return { value: "invalid", describe: "a string where a boolean is declared" };
    case "array":
      return { value: "invalid", describe: "a string where an array is declared" };
    case "object":
      return { value: "invalid", describe: "a string where an object is declared" };
    default:
      // An untyped field has no wrong type. Generating a mutation would
      // produce a test asserting a rejection the contract never promised.
      return null;
  }
}

/** The empty form of the field's own type (spec §7). */
export function emptyValue(field: Pick<SchemaField, "types">): { value: unknown; describe: string } | null {
  switch (primaryType(field)) {
    case "string":
      return { value: "", describe: "an empty string" };
    case "array":
      return { value: [], describe: "an empty array" };
    case "object":
      return { value: {}, describe: "an empty object" };
    default:
      // "Empty" is not defined for a number or a boolean. `0` and `false` are
      // ordinary values, not empty ones, and testing them as if they were
      // would assert something the API is right to accept.
      return null;
  }
}

/** The single fixed out-of-range enum token (spec §8). Never a dictionary. */
export function invalidEnumValue(field: Pick<SchemaField, "enumValues" | "types">): { value: unknown; describe: string } | null {
  if (field.enumValues === undefined || field.enumValues.length === 0) return null;

  // A numeric enum needs a numeric out-of-range value; sending the string
  // "invalid_enum" would be caught by the type check first and the test would
  // no longer be an *enum* test.
  if (primaryType(field) === "integer" || primaryType(field) === "number") {
    const numbers = field.enumValues.filter((entry): entry is number => typeof entry === "number");
    const candidate = numbers.length > 0 ? Math.max(...numbers) + 1 : 999999;
    if (field.enumValues.includes(candidate)) return null;
    return { value: candidate, describe: `${candidate}, which is outside the declared enum` };
  }

  if (field.enumValues.includes(INVALID_ENUM_VALUE)) return null;
  return { value: INVALID_ENUM_VALUE, describe: `"${INVALID_ENUM_VALUE}", which is outside the declared enum` };
}

export interface BoundaryCase {
  label: string;
  value: unknown;
  /**
   * Whether this value is *inside* the declared bounds.
   *
   * Spec §7 asks for `minimum` and `minLength` themselves alongside
   * `minimum-1` and `maxLength+1`. Those on-boundary values are legal, and
   * the test's expectation is inverted accordingly: an API that rejects its
   * own declared minimum is off-by-one, which is exactly the bug boundary
   * testing exists to find. Carrying this flag is what lets one generator
   * emit both polarities without the caller having to know which is which.
   */
  expectValid: boolean;
  warning: string | undefined;
}

function clampString(length: number): { text: string; warning: string | undefined } {
  if (length <= 0) return { text: "", warning: undefined };
  if (length <= MAX_MUTATED_STRING_LENGTH) return { text: "a".repeat(length), warning: undefined };
  return {
    text: "a".repeat(MAX_MUTATED_STRING_LENGTH),
    warning: `A declared length bound of ${length} was clamped to ${MAX_MUTATED_STRING_LENGTH} characters; this test no longer crosses the declared boundary exactly.`,
  };
}

function withinMagnitude(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_BOUNDARY_MAGNITUDE;
}

/**
 * The boundary cases derivable from a field's declared bounds (spec §7).
 *
 * Returns an empty list when the schema declares no bounds — a boundary test
 * against an unbounded field is not a test, and inventing a bound to cross
 * would assert a rule the contract never stated.
 */
export function boundaryCases(field: SchemaField): BoundaryCase[] {
  const cases: BoundaryCase[] = [];
  const type = primaryType(field);

  if (type === "integer" || type === "number") {
    if (field.minimum !== undefined && withinMagnitude(field.minimum)) {
      const below = field.minimum - 1;
      if (withinMagnitude(below)) {
        cases.push({ label: `minimum - 1 (${below})`, value: below, expectValid: false, warning: undefined });
      }
      cases.push({ label: `minimum (${field.minimum})`, value: field.minimum, expectValid: true, warning: undefined });
    }
    if (field.maximum !== undefined && withinMagnitude(field.maximum)) {
      cases.push({ label: `maximum (${field.maximum})`, value: field.maximum, expectValid: true, warning: undefined });
      const above = field.maximum + 1;
      if (withinMagnitude(above)) {
        cases.push({ label: `maximum + 1 (${above})`, value: above, expectValid: false, warning: undefined });
      }
    }
    return cases;
  }

  if (type === "string") {
    if (field.minLength !== undefined && field.minLength > 0) {
      const below = clampString(field.minLength - 1);
      cases.push({
        label: `minLength - 1 (${field.minLength - 1} characters)`,
        value: below.text,
        expectValid: false,
        warning: below.warning,
      });
      const at = clampString(field.minLength);
      cases.push({
        label: `minLength (${field.minLength} characters)`,
        value: at.text,
        // A clamped "valid" value is no longer necessarily valid — it may now
        // be shorter than minLength — so it is not asserted as such.
        expectValid: at.warning === undefined,
        warning: at.warning,
      });
    }
    if (field.maxLength !== undefined) {
      const above = clampString(field.maxLength + 1);
      cases.push({
        label: `maxLength + 1 (${field.maxLength + 1} characters)`,
        value: above.text,
        expectValid: false,
        warning: above.warning,
      });
    }
    return cases;
  }

  return cases;
}

/**
 * The replacement for a path or query parameter of a declared type (spec §9,
 * §10). Returns a *string*, since path and query values are always strings on
 * the wire.
 */
export function invalidParameterValue(field: Pick<SchemaField, "types" | "format" | "enumValues">): { value: string; describe: string } | null {
  if (field.enumValues !== undefined && field.enumValues.length > 0) {
    return { value: INVALID_ENUM_VALUE, describe: `"${INVALID_ENUM_VALUE}", which is outside the declared enum` };
  }

  if (field.format === "uuid") {
    return { value: INVALID_UUID_VALUE, describe: `"${INVALID_UUID_VALUE}", which is not a UUID` };
  }

  switch (primaryType(field)) {
    case "integer":
    case "number":
      return { value: INVALID_INTEGER_VALUE, describe: `"${INVALID_INTEGER_VALUE}", which is not a number` };
    case "boolean":
      return { value: INVALID_INTEGER_VALUE, describe: `"${INVALID_INTEGER_VALUE}", which is not a boolean` };
    case "string":
      // A plain unbounded string parameter has no invalid value — anything is
      // a valid string. Only a format or an enum makes one possible.
      return null;
    default:
      return null;
  }
}
