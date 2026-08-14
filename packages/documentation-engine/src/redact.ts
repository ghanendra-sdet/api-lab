import {
  isSensitiveFieldName,
  isSensitiveHeaderName,
  redactUrl,
} from "@api-lab/security-engine";
import { MAX_EXAMPLE_BYTES, MAX_TEXT_LENGTH } from "./limits.ts";

/**
 * Secret redaction for generated documentation (spec §11, §15, §16, §17,
 * §18, §34).
 *
 * ## Why this reuses security-engine rather than defining its own list
 *
 * Milestone 12 already answered "what counts as a secret" — `redact.ts` in
 * `@api-lab/security-engine` owns `SENSITIVE_HEADER_NAMES`,
 * `SENSITIVE_FIELD_NAMES`, and `redactUrl`. Duplicating that list here would
 * create the worst possible failure mode for a security control: two lists
 * that agree today, diverge in six months, and leave whichever consumer was
 * not updated quietly leaking. So documentation-engine depends on
 * security-engine for the *definition* of sensitive, and adds only what
 * documentation specifically needs on top.
 *
 * The dependency direction is safe — security-engine is pure and already
 * depends on contract-engine, so nothing circular is introduced.
 *
 * ## What documentation adds
 *
 * Two things M12 did not need:
 *
 * 1. **Placeholder preservation (spec §16).** A security report wants the
 *    literal request that was sent. Documentation wants the *opposite*: an
 *    unresolved `{{token}}` is the correct, useful thing to publish, and a
 *    resolved `Bearer eyJhbGci…` is a leak. So documentation is generated
 *    from unresolved request configuration and never from resolved values,
 *    and `looksLikePlaceholder` exists so redaction can tell the two apart
 *    and leave the useful one intact.
 *
 * 2. **Whole-body traversal.** A security finding names a field. A
 *    documentation example reproduces an entire JSON body, so every sensitive
 *    leaf in it has to be replaced, at every depth, including inside arrays.
 *
 * ## The standing guarantee
 *
 * No function in this package returns a string containing a credential. That
 * is enforced structurally where possible (`DocAuthentication` has no field a
 * secret could be stored in — see types.ts) and by these functions where a
 * value genuinely has to be carried. `secretCanary.test.ts` pins it with
 * explicit canary credentials driven end to end.
 */

/** The marker written in place of any redacted value. Stable and greppable. */
export const REDACTED = "{{redacted}}";

/**
 * Whether a value is an API Lab variable placeholder rather than a literal.
 *
 * Placeholders are what documentation *wants* to publish (spec §16), so they
 * are exempted from redaction. The test is deliberately strict — the whole
 * trimmed value must be a single `{{name}}` — because a partial match would
 * let `Bearer {{x}}eyJhbGci...` through on the strength of its prefix.
 */
export function looksLikePlaceholder(value: string): boolean {
  return /^\{\{[^{}]+\}\}$/.test(value.trim());
}

/**
 * HTTP authentication schemes permitted to precede a placeholder.
 *
 * A **closed set**, not a pattern. `Authorization: Bearer {{token}}` is the
 * single most useful line in an authentication section and `looksLikePlaceholder`
 * alone rejects it, because the value is not *only* a placeholder — so it was
 * being redacted to `{{redacted}}`, destroying the one thing spec §16 asks for.
 *
 * The obvious fix is a heuristic: "allow it if what remains after removing
 * placeholders looks harmless". That was rejected for the reason Milestone 12
 * gives for `MutationOperation` being a closed union — a security control
 * built on "looks harmless" is one clever input away from being wrong, and
 * nobody can tell by reading it whether it is currently correct.
 *
 * A fixed list of four scheme words cannot be widened by an attacker. Anything
 * else in the prefix position is redacted, including a longer scheme name we
 * have not listed, which fails in the safe direction.
 */
const PLACEHOLDER_SCHEME_PREFIXES = ["bearer", "basic", "token", "apikey"];

/**
 * Whether a value carries no credential — either a bare placeholder, or a
 * recognised scheme word followed by one.
 */
export function isPlaceholderOnly(value: string): boolean {
  const trimmed = value.trim();
  if (looksLikePlaceholder(trimmed)) return true;

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) return false;
  const [scheme, credential] = parts;
  if (scheme === undefined || credential === undefined) return false;

  return PLACEHOLDER_SCHEME_PREFIXES.includes(scheme.toLowerCase()) && looksLikePlaceholder(credential);
}

/**
 * Whether a *name* — a query parameter, a form field, a header — suggests its
 * value is a credential.
 *
 * Broader than `isSensitiveFieldName` alone, because a parameter called
 * `api_key`, `access-token` or `client_secret` is not always spelled the way
 * M12's exact-match list spells it, and a query string is where API keys most
 * often live in the wild.
 *
 * Erring toward over-redaction here is deliberate. The cost of redacting a
 * harmless parameter named `monkey` is a slightly less useful example; the
 * cost of missing one named `apiKeyV2` is a published credential.
 */
export function isCredentialName(name: string): boolean {
  return (
    isSensitiveFieldName(name) ||
    isSensitiveHeaderName(name) ||
    /token|secret|password|passwd|credential|(^|[^a-z])key([^a-z]|$)|apikey/i.test(name)
  );
}

/**
 * Redacts a single named value — a parameter default, a parameter example, a
 * query value.
 *
 * This exists because the canary suite caught two real leaks that neither
 * `redactExampleBody` nor `redactExampleHeaders` covered: an OpenAPI
 * parameter's `default` / `example` (which reach documentation through the
 * prose projection, not through a body) and a collection query parameter's
 * value. Both are ordinary places for an API key to sit, and both were being
 * published verbatim.
 */
export function redactNamedValue(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isCredentialName(name)) return value;
  if (isPlaceholderOnly(value)) return value;
  return REDACTED;
}

/**
 * Redacts a header value by header name.
 *
 * Sensitive header *names* are kept — `Authorization` is diagnostic, not
 * secret, and a reader needs to know the header exists. Only the value goes.
 */
export function redactHeaderValue(name: string, value: string): string {
  if (!isSensitiveHeaderName(name)) return value;
  // `Bearer {{token}}` is the useful documentation, not a leak — see
  // isPlaceholderOnly.
  if (isPlaceholderOnly(value)) return value;
  return REDACTED;
}

/** Redacts a list of header pairs for inclusion in a documentation example. */
export function redactExampleHeaders(
  headers: Array<{ name: string; value: string }>,
): Array<{ name: string; value: string }> {
  return headers.map((header) => ({
    name: header.name,
    value: redactHeaderValue(header.name, header.value),
  }));
}

/**
 * Recursively replaces sensitive leaf values in a parsed JSON structure.
 *
 * Depth-bounded for the same reason every walk in this repository is: an
 * untrusted document can be nested deeply enough to overflow the stack, and a
 * RangeError is not something a Zod boundary catches. At the cap the subtree
 * is replaced wholesale with the redaction marker rather than being emitted
 * unredacted — the failure mode of a redactor must be to redact too much.
 */
function redactJsonValue(value: unknown, depth: number): unknown {
  if (depth <= 0) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonValue(entry, depth - 1));
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveFieldName(key)) {
        // A placeholder in a sensitive field is still the useful thing to
        // publish, and is still not a credential.
        result[key] = typeof entry === "string" && isPlaceholderOnly(entry) ? entry : REDACTED;
        continue;
      }
      result[key] = redactJsonValue(entry, depth - 1);
    }
    return result;
  }

  return value;
}

/**
 * Redacts and size-caps an example body.
 *
 * Two paths, because a body is not always JSON:
 *
 * - **Parseable JSON** is walked structurally, which is precise: only fields
 *   whose *name* is sensitive lose their value, and the body stays readable
 *   and re-indented.
 * - **Anything else** (XML, form-encoded, plain text, malformed JSON) cannot
 *   be walked, so it falls back to a line-oriented scan for `name: value` and
 *   `name=value` shapes. That is admittedly less precise, and it is the right
 *   trade: a documentation example is worth publishing only if it is
 *   definitely safe, and over-redacting a text body costs a reader a little
 *   context while under-redacting one costs them a credential.
 */
export function redactExampleBody(
  body: string,
  maxBytes: number = MAX_EXAMPLE_BYTES,
): { body: string; truncated: boolean } {
  let redacted: string;

  let parsed: unknown;
  let isJson = true;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    isJson = false;
  }

  if (isJson && typeof parsed === "object" && parsed !== null) {
    redacted = JSON.stringify(redactJsonValue(parsed, 24), null, 2);
  } else {
    redacted = redactTextBody(body);
  }

  if (redacted.length > maxBytes) {
    return { body: `${redacted.slice(0, maxBytes)}\n… (truncated)`, truncated: true };
  }
  return { body: redacted, truncated: false };
}

/**
 * Line-oriented redaction for non-JSON bodies.
 *
 * Handles the two shapes that actually carry credentials in text payloads:
 * `key: value` (header-like, HTTP text) and `key=value` (form-encoded, query
 * strings, .env-style). Anything else is left alone, because guessing at
 * arbitrary text structure produces noise rather than safety.
 */
function redactTextBody(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) =>
      line.replace(/([\w.-]+)(\s*[:=]\s*)([^\s&;]+)/g, (match, key: string, separator: string, value: string) => {
        if (!isSensitiveFieldName(key) && !isSensitiveHeaderName(key)) return match;
        if (isPlaceholderOnly(value)) return match;
        return `${key}${separator}${REDACTED}`;
      }),
    )
    .join("\n");
}

/**
 * Redacts a URL for display in documentation.
 *
 * Delegates to M12's `redactUrl` (userinfo + credential-shaped query
 * parameters) and adds nothing, so the two products treat the same URL
 * identically.
 */
export function redactDocUrl(url: string): string {
  return redactUrl(url);
}

/**
 * Caps a free-text field copied from a source document.
 *
 * Applied to every description and summary on the way *into* the model, not
 * on the way out to a renderer, so the cap holds for all three output formats
 * and for the JSON export without any of them having to remember it.
 */
export function capText(value: string | undefined, maxLength: number = MAX_TEXT_LENGTH): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}
