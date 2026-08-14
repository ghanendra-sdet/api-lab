import type { JsonSchema } from "@api-lab/contract-engine";
import { MAX_BODY_WALK_DEPTH, MAX_COLLECTED_FIELDS } from "../limits.ts";
import { formatPointer } from "../pointer.ts";

/**
 * Walks an OpenAPI request-body schema and enumerates the fields a negative
 * test can meaningfully mutate (spec §20).
 *
 * ## Why the schema, and not the body
 *
 * This is the difference between contract-aware generation and guessing. A
 * request body says `{"age": 25}`; only the schema says that `age` is
 * *required*, that it is an `integer`, and that its `minimum` is 18. Those
 * three facts are what make "remove age → expect 400", "send age as a string
 * → expect 400", and "send age = 17 → expect 400" real assertions rather
 * than hopeful ones. `pointer.ts`'s `collectFields` handles the no-schema
 * case and is correspondingly weaker; see generate/heuristic.ts.
 *
 * ## Bounded on every axis
 *
 * The schema comes from an imported OpenAPI document and is untrusted input
 * (spec §38). It is walked with a depth cap, a field-count cap, and
 * `$ref` cycle detection. A recursive schema — `Node` containing an array of
 * `Node` — is entirely legal OpenAPI and would otherwise recurse until the
 * stack gives out, producing a RangeError that no Zod boundary catches.
 */

export interface SchemaField {
  /** JSON pointer into the request body instance, e.g. `/user/age`. */
  pointer: string;
  /** The property's own name, for messages. */
  name: string;
  /** Declared `required` on its immediate parent object. */
  required: boolean;
  /** Declared type(s), normalized to an array. Empty when untyped. */
  types: string[];
  enumValues: unknown[] | undefined;
  minimum: number | undefined;
  maximum: number | undefined;
  minLength: number | undefined;
  maxLength: number | undefined;
  format: string | undefined;
}

export interface CollectSchemaFieldsResult {
  fields: SchemaField[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function typesOf(schema: Record<string, unknown>): string[] {
  const raw = schema["type"];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/**
 * Resolves a local `$ref` against the document root.
 *
 * Only `#/...` pointers are followed. An external `$ref` (`./common.yaml#/X`)
 * would mean fetching a URL that came out of an imported document — a
 * server-side request forgery primitive handed to whoever wrote the
 * specification. API Lab does not resolve them anywhere, and this is not the
 * place to start.
 */
function resolveRef(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;

  let current: unknown = root;
  for (const rawToken of ref.slice(2).split("/")) {
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    current = current[token];
  }
  return current;
}

export function collectSchemaFields(
  schema: JsonSchema | undefined,
  components: Record<string, unknown> | undefined,
): CollectSchemaFieldsResult {
  const fields: SchemaField[] = [];
  const warnings: string[] = [];

  if (schema === undefined || typeof schema === "boolean") {
    return { fields, warnings: schema === undefined ? ["The operation declares no request body schema, so no body mutations were generated."] : [] };
  }

  // Same root-assembly convention as contract-engine's `buildValidationRoot`:
  // components are re-attached so `#/components/schemas/X` resolves.
  const root: Record<string, unknown> = components === undefined ? { ...schema } : { ...schema, components };

  let truncated = false;

  function walk(
    node: unknown,
    tokens: string[],
    depth: number,
    requiredNames: Set<string>,
    refsOnPath: Set<string>,
  ): void {
    if (fields.length >= MAX_COLLECTED_FIELDS) {
      truncated = true;
      return;
    }
    if (depth > MAX_BODY_WALK_DEPTH) {
      truncated = true;
      return;
    }
    if (!isRecord(node)) return;

    let current = node;

    // --- $ref -----------------------------------------------------------
    const ref = current["$ref"];
    if (typeof ref === "string") {
      if (refsOnPath.has(ref)) {
        // A recursive schema. Legal, common, and not something a negative
        // test needs to descend into — the fields at the first level already
        // cover every distinct mutation the recursion would repeat.
        return;
      }
      const resolved = resolveRef(root, ref);
      if (!isRecord(resolved)) {
        warnings.push(`Schema reference ${ref} could not be resolved; fields beneath it were not enumerated.`);
        return;
      }
      walk(resolved, tokens, depth + 1, requiredNames, new Set([...refsOnPath, ref]));
      return;
    }

    // --- Composition ------------------------------------------------------
    // `allOf` is merged by walking each branch in turn, which is the common
    // "base object + extension" case and behaves correctly for it. `anyOf`
    // and `oneOf` are deliberately not descended into: a field that is
    // required in one branch and absent in another has no single correct
    // negative expectation, and generating "remove it, expect 400" would
    // produce a test that fails against a conforming API.
    const allOf = current["allOf"];
    if (Array.isArray(allOf)) {
      for (const branch of allOf) walk(branch, tokens, depth + 1, requiredNames, refsOnPath);
    }
    if (Array.isArray(current["anyOf"]) || Array.isArray(current["oneOf"])) {
      warnings.push(
        `The schema at ${formatPointer(tokens) || "the request body root"} uses anyOf/oneOf; its alternatives were not enumerated because a required field in one branch is optional in another.`,
      );
    }

    const types = typesOf(current);

    // --- Objects ----------------------------------------------------------
    const properties = current["properties"];
    if (isRecord(properties)) {
      const required = new Set(
        Array.isArray(current["required"]) ? current["required"].filter((entry): entry is string => typeof entry === "string") : [],
      );

      for (const [name, propertySchema] of Object.entries(properties)) {
        if (fields.length >= MAX_COLLECTED_FIELDS) {
          truncated = true;
          return;
        }
        // `__proto__` as a property name is legal JSON Schema and a
        // prototype-pollution vector on the way back out. pointer.ts refuses
        // to write through it; not collecting it at all is cheaper.
        if (name === "__proto__" || name === "constructor" || name === "prototype") continue;

        const childTokens = [...tokens, name];
        const child = isRecord(propertySchema) ? propertySchema : {};

        // Follow one level of $ref purely to read the child's own keywords,
        // so a `$ref`-ed field still gets its type and bounds.
        let effective = child;
        const childRef = child["$ref"];
        if (typeof childRef === "string" && !refsOnPath.has(childRef)) {
          const resolved = resolveRef(root, childRef);
          if (isRecord(resolved)) effective = resolved;
        }

        fields.push({
          pointer: formatPointer(childTokens),
          name,
          required: required.has(name),
          types: typesOf(effective),
          enumValues: Array.isArray(effective["enum"]) ? effective["enum"] : undefined,
          minimum: numberOrUndefined(effective["minimum"]),
          maximum: numberOrUndefined(effective["maximum"]),
          minLength: numberOrUndefined(effective["minLength"]),
          maxLength: numberOrUndefined(effective["maxLength"]),
          format: stringOrUndefined(effective["format"]),
        });

        walk(child, childTokens, depth + 1, required, refsOnPath);
      }
    }

    // --- Arrays -------------------------------------------------------------
    // Only element 0 is described, for the reason given in pointer.ts: every
    // element exercises the same validation path.
    if (types.includes("array") || current["items"] !== undefined) {
      const items = current["items"];
      if (items !== undefined) walk(items, [...tokens, "0"], depth + 1, new Set(), refsOnPath);
    }
  }

  walk(schema, [], 0, new Set(), new Set());

  if (truncated) {
    warnings.push(
      `The request body schema was only partially enumerated (limit: ${MAX_COLLECTED_FIELDS} fields, depth ${MAX_BODY_WALK_DEPTH}). Generated tests do not cover every field.`,
    );
  }

  return { fields, warnings };
}
