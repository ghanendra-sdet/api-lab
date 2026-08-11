/**
 * A deliberately small, documented JSONPath subset — not a general
 * expression language, and never `eval`'d. Supported syntax:
 *
 *   $                latest value
 *   $.key            property access
 *   $.a.b.c          nested property access
 *   $.arr[0]         array index
 *   $.a.b[2].c       combined
 *
 * Not supported (out of scope for this milestone): wildcards (`*`),
 * filters (`[?(...)]`), slices, recursive descent (`..`). An unsupported
 * or malformed path returns `{ ok: false }` rather than guessing.
 */
export type JsonPathResult = { ok: true; found: true; value: unknown } | { ok: true; found: false } | { ok: false; detail: string };

const TOKEN_PATTERN = /^\$((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)$/;
const SEGMENT_PATTERN = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;

export function evaluateJsonPath(path: string, data: unknown): JsonPathResult {
  const trimmed = path.trim();
  const match = TOKEN_PATTERN.exec(trimmed);
  if (!match) {
    return { ok: false, detail: `Unsupported or malformed JSON path: "${path}".` };
  }

  let current: unknown = data;
  const rest = match[1] ?? "";
  SEGMENT_PATTERN.lastIndex = 0;
  let segmentMatch: RegExpExecArray | null;
  while ((segmentMatch = SEGMENT_PATTERN.exec(rest))) {
    const key = segmentMatch[1];
    const index = segmentMatch[2];

    if (current === null || current === undefined) {
      return { ok: true, found: false };
    }

    if (key !== undefined) {
      if (typeof current !== "object" || Array.isArray(current)) {
        return { ok: true, found: false };
      }
      const obj = current as Record<string, unknown>;
      if (!Object.hasOwn(obj, key)) {
        return { ok: true, found: false };
      }
      current = obj[key];
      continue;
    }

    if (index !== undefined) {
      if (!Array.isArray(current)) {
        return { ok: true, found: false };
      }
      const i = Number(index);
      if (i < 0 || i >= current.length) {
        return { ok: true, found: false };
      }
      current = current[i];
      continue;
    }
  }

  return { ok: true, found: true, value: current };
}
