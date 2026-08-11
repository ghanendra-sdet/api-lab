/**
 * Media-type handling (spec §18).
 *
 * Spec §18 is explicit that content types must not be compared naively as
 * strings. `application/json; charset=utf-8` is the same media type as
 * `application/json`, and a server is entitled to add parameters the
 * document never mentioned. OpenAPI also allows wildcard keys in a
 * `content` map (`application/*`, `*​/*`), which a string equality check
 * would miss entirely.
 */

export interface ParsedMediaType {
  /** Lowercased `type/subtype`, parameters stripped. */
  essence: string;
  type: string;
  subtype: string;
  parameters: Record<string, string>;
}

/**
 * Splits on `;` while respecting quoted-string parameter values. A naive
 * `split(";")` corrupts a legitimate header such as
 * `multipart/form-data; boundary="a;b"`, where the separator is part of the
 * value rather than between values (RFC 9110 §5.6.6).
 */
function splitParameters(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === "\\" && inQuotes && i + 1 < input.length) {
      current += char + input[i + 1];
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === ";" && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

/** Parses a Content-Type header or an OpenAPI content-map key. */
export function parseMediaType(raw: string): ParsedMediaType | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const [essenceRaw, ...parameterParts] = splitParameters(trimmed);
  const essence = (essenceRaw ?? "").trim().toLowerCase();
  const slash = essence.indexOf("/");
  if (slash <= 0 || slash === essence.length - 1) return null;

  const parameters: Record<string, string> = {};
  for (const part of parameterParts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (key !== "") parameters[key] = value;
  }

  return {
    essence,
    type: essence.slice(0, slash),
    subtype: essence.slice(slash + 1),
    parameters,
  };
}

/**
 * True when an actual media type satisfies a documented one. The documented
 * side may be a wildcard; the actual side never is.
 */
export function mediaTypeMatches(documented: string, actual: string): boolean {
  const expected = parseMediaType(documented);
  const received = parseMediaType(actual);
  if (!expected || !received) return false;

  if (expected.type === "*" && expected.subtype === "*") return true;
  if (expected.type !== received.type) return false;
  if (expected.subtype === "*") return true;
  return expected.subtype === received.subtype;
}

/**
 * True when a media type should be parsed as JSON. Covers the `+json`
 * structured-syntax suffix (RFC 6839), so `application/problem+json` and
 * `application/vnd.api+json` are schema-validated as the JSON they are
 * rather than skipped as unknown binary content.
 */
export function isJsonMediaType(raw: string): boolean {
  const parsed = parseMediaType(raw);
  if (!parsed) return false;
  return parsed.subtype === "json" || parsed.subtype.endsWith("+json");
}

/** Picks the documented entry matching an actual content type, if any. */
export function selectMediaType<T extends { contentType: string }>(
  entries: T[],
  actual: string,
): T | undefined {
  // Exact essence match wins over a wildcard, so `application/json` is
  // preferred over a `*​/*` catch-all documented alongside it.
  const parsedActual = parseMediaType(actual);
  if (parsedActual) {
    const exact = entries.find((entry) => parseMediaType(entry.contentType)?.essence === parsedActual.essence);
    if (exact) return exact;
  }
  return entries.find((entry) => mediaTypeMatches(entry.contentType, actual));
}
