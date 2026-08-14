/**
 * Secret redaction (spec §14, §25, §40, §41, §42).
 *
 * ## The rule
 *
 * A security report is the single most likely artifact in API Lab to be
 * copied into a ticket, an email, or a chat channel. It is therefore the
 * single worst place for a credential to end up. Milestone 12's position is
 * that a security tool which leaks the secrets it finds has caused a bigger
 * problem than the one it reported.
 *
 * So: findings record *that* a sensitive field was present and *where*, and
 * never *what its value was*. `password` in the response body produces
 * "sensitive field `password` present in response body" — enough for a
 * developer to find it in thirty seconds, and useless to anyone who
 * intercepts the report.
 *
 * ## Why masking is not enough on its own
 *
 * `maskSecret` exists for the cases where some shape information genuinely
 * helps (was the token empty? is it the staging key or the prod key?), and
 * it keeps at most four leading characters. Four characters of a bearer
 * token is not a usable credential, and it is enough to distinguish two
 * environments. Anywhere the value is not needed at all, the correct call is
 * to store nothing — see `describeSensitiveField`.
 */

/** Header names never written to a log, an export, or a report body. */
export const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
]);

/**
 * Response/request body field names treated as sensitive (spec §14).
 *
 * A small, deliberately unambitious list. It is matched case-insensitively
 * against the *field name*, and it is explicitly not a classifier: spec §14
 * says detection must be reported as "detected"/"potential exposure" and the
 * tester decides whether it matters. A `password` field in a response is
 * frequently correct — an admin tool echoing a generated initial password,
 * for instance. The tool's job is to surface it, not to adjudicate it.
 */
export const SENSITIVE_FIELD_NAMES = [
  "password",
  "passwd",
  "passwordhash",
  "password_hash",
  "secret",
  "clientsecret",
  "client_secret",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "privatekey",
  "private_key",
  "apikey",
  "api_key",
  "sessiontoken",
  "session_token",
  "creditcard",
  "credit_card",
  "ssn",
] as const;

/**
 * Strips the separators that distinguish `password_hash` from `passwordHash`
 * from `password-hash`. All three name the same thing, all three occur in
 * real APIs, and a check that matched only one of them would be trivially
 * evaded by a naming convention rather than by intent.
 */
function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[-_\s]/g, "");
}

export function isSensitiveFieldName(name: string): boolean {
  const normalized = normalizeFieldName(name);
  return SENSITIVE_FIELD_NAMES.some((candidate) => normalized === normalizeFieldName(candidate));
}

export function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase());
}

/**
 * Masks a value to at most four leading characters plus a length-free
 * marker.
 *
 * The length is deliberately not reported. Token length is a real
 * fingerprint — it distinguishes credential types and narrows a brute-force
 * search space — and it buys the tester nothing.
 */
export function maskSecret(value: string): string {
  if (value === "") return "(empty)";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 4)}****`;
}

/**
 * Redacts a header map for display or export. Sensitive headers keep their
 * name (which is diagnostic and not secret) and lose their value entirely.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = isSensitiveHeaderName(name) ? "(redacted)" : value;
  }
  return result;
}

/**
 * Strips credentials from a URL before it is stored in a result or report.
 *
 * Two separate leaks are closed here: RFC 3986 userinfo (`https://user:pw@h`),
 * and query parameters whose *name* looks like a credential — API keys in
 * query strings are common enough that reporting a raw URL would routinely
 * publish one.
 */
export function redactUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Not parseable as absolute — fall back to dropping any query string
    // wholesale rather than risk echoing a credential we cannot parse out.
    const questionMark = rawUrl.indexOf("?");
    return questionMark === -1 ? rawUrl : `${rawUrl.slice(0, questionMark)}?(redacted)`;
  }

  url.username = "";
  url.password = "";

  const params = url.searchParams;
  for (const name of [...params.keys()]) {
    if (isSensitiveFieldName(name) || isSensitiveHeaderName(name) || /token|secret|key|password/i.test(name)) {
      params.set(name, "(redacted)");
    }
  }
  url.search = params.toString();

  return url.toString();
}

/**
 * The path + query of a request, credential-free — what results and reports
 * record instead of a full URL. The host lives once on the report header
 * (spec §25), so repeating it per row would add nothing but exposure.
 */
export function toRedactedPath(rawUrl: string): string {
  const redacted = redactUrl(rawUrl);
  try {
    const url = new URL(redacted);
    return `${url.pathname}${url.search}`;
  } catch {
    return redacted;
  }
}

/**
 * Describes a detected sensitive field without reproducing its value
 * (spec §14). This is the only function that should ever be used to build a
 * `Finding.evidence` for a sensitive-data detection.
 */
export function describeSensitiveField(path: string): string {
  return `field ${path} (value withheld)`;
}
