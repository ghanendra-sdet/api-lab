import { MAX_BODY_WALK_DEPTH, MAX_COLLECTED_FIELDS } from "./limits.ts";

/**
 * A minimal RFC 6901 JSON Pointer implementation, used to address the field a
 * body mutation targets (`/user/roles/0`).
 *
 * Written here rather than pulled in as a dependency, per CLAUDE.md's
 * "no unnecessary dependencies" rule: this is sixty lines of well-specified
 * string handling, and the alternative is a transitive dependency in a
 * package whose entire justification is that it is small, pure, and
 * auditable.
 *
 * Note the deliberate absence of a `set` that creates intermediate objects.
 * Every mutation in Milestone 12 modifies a field that already exists (it was
 * discovered by walking the body or the schema), so an auto-vivifying setter
 * would only ever mask a bug in the generator.
 */

export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer: ${pointer}`);
  // Unescape in the order the RFC mandates: ~1 before ~0, otherwise "~01"
  // round-trips incorrectly.
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function formatPointer(tokens: string[]): string {
  if (tokens.length === 0) return "";
  return `/${tokens.map((token) => token.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rejects prototype-polluting tokens.
 *
 * The pointer is derived from a generator walking an untrusted OpenAPI
 * document or an untrusted response body, so a field literally named
 * `__proto__` is reachable. Writing through it would corrupt
 * `Object.prototype` for the whole page. environment-engine and
 * runner-engine already harden against the same class of input; this is the
 * same defence at a different door.
 */
const FORBIDDEN_TOKENS = new Set(["__proto__", "constructor", "prototype"]);

function tokenIsSafe(token: string): boolean {
  return !FORBIDDEN_TOKENS.has(token);
}

export function getAtPointer(root: unknown, pointer: string): { found: boolean; value: unknown } {
  const tokens = parsePointer(pointer);
  let current: unknown = root;

  for (const token of tokens) {
    if (!tokenIsSafe(token)) return { found: false, value: undefined };
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
      continue;
    }
    return { found: false, value: undefined };
  }

  return { found: true, value: current };
}

/** Resolves the container holding a pointer's final token. */
function resolveParent(root: unknown, pointer: string): { parent: unknown; key: string } | null {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return null;

  const key = tokens[tokens.length - 1]!;
  if (!tokenIsSafe(key)) return null;

  const parentPointer = formatPointer(tokens.slice(0, -1));
  const parent = getAtPointer(root, parentPointer);
  if (!parent.found) return null;

  return { parent: parent.value, key };
}

/** Replaces the value at `pointer`. Mutates `root` in place — callers pass a
 * freshly parsed copy of the body, never shared state. */
export function setAtPointer(root: unknown, pointer: string, value: unknown): boolean {
  const resolved = resolveParent(root, pointer);
  if (!resolved) return false;

  if (Array.isArray(resolved.parent)) {
    const index = Number(resolved.key);
    if (!Number.isInteger(index) || index < 0 || index >= resolved.parent.length) return false;
    resolved.parent[index] = value;
    return true;
  }
  if (isRecord(resolved.parent) && Object.prototype.hasOwnProperty.call(resolved.parent, resolved.key)) {
    resolved.parent[resolved.key] = value;
    return true;
  }
  return false;
}

/** Deletes the value at `pointer`. Array elements are spliced out rather than
 * left as holes, since a sparse array serializes to `null` and would silently
 * become a *different* mutation than the one requested. */
export function removeAtPointer(root: unknown, pointer: string): boolean {
  const resolved = resolveParent(root, pointer);
  if (!resolved) return false;

  if (Array.isArray(resolved.parent)) {
    const index = Number(resolved.key);
    if (!Number.isInteger(index) || index < 0 || index >= resolved.parent.length) return false;
    resolved.parent.splice(index, 1);
    return true;
  }
  if (isRecord(resolved.parent) && Object.prototype.hasOwnProperty.call(resolved.parent, resolved.key)) {
    delete resolved.parent[resolved.key];
    return true;
  }
  return false;
}

export type JsonValueKind = "string" | "number" | "boolean" | "null" | "array" | "object";

export function kindOf(value: unknown): JsonValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

export interface CollectedField {
  pointer: string;
  kind: JsonValueKind;
  value: unknown;
}

/**
 * Enumerates the mutable leaf fields of a parsed body, depth- and
 * count-bounded (limits.ts).
 *
 * Used only for *heuristic* generation — the no-specification case, where
 * the request's own body is the only description of its shape available.
 * Contract-backed generation walks the schema instead, because the schema
 * knows which fields are required and what their bounds are, and a body
 * cannot tell you either.
 *
 * Objects and arrays are reported alongside their children, since "send `{}`
 * where an object was expected" is itself one of the empty-value mutations
 * spec §7 asks for.
 */
export function collectFields(root: unknown): CollectedField[] {
  const fields: CollectedField[] = [];

  function walk(value: unknown, tokens: string[], depth: number): void {
    if (fields.length >= MAX_COLLECTED_FIELDS) return;
    if (depth > MAX_BODY_WALK_DEPTH) return;

    if (tokens.length > 0) {
      fields.push({ pointer: formatPointer(tokens), kind: kindOf(value), value });
    }

    if (Array.isArray(value)) {
      // Only the first element. Mutating element 7 of a 200-element array
      // tests the same code path as mutating element 0, and generating 200
      // near-identical tests would consume the entire budget for no coverage.
      if (value.length > 0) walk(value[0], [...tokens, "0"], depth + 1);
      return;
    }
    if (isRecord(value)) {
      for (const key of Object.keys(value)) {
        if (!tokenIsSafe(key)) continue;
        walk(value[key], [...tokens, key], depth + 1);
      }
    }
  }

  walk(root, [], 0);
  return fields;
}
