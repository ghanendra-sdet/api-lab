import { MAX_MUTATED_BODY_BYTES } from "./limits.ts";
import { removeAtPointer, setAtPointer, getAtPointer } from "./pointer.ts";
import {
  EXPIRED_JWT,
  INVALID_BASIC_CREDENTIALS,
  INVALID_BEARER_TOKEN,
  MALFORMED_TOKEN,
  WRONG_API_KEY,
} from "./credentials.ts";
import type { AuthMutationKind, Mutation, SecurityRequestInput } from "./types.ts";

/**
 * Applies exactly one mutation to a fully-resolved request (spec §7-§12).
 *
 * ## Contract
 *
 * - Pure. The input is never modified; a new `SecurityRequestInput` comes
 *   back. A mutation applier that mutated its argument would make a failed
 *   test contaminate the next one, which for a security suite means a
 *   credential removed for test 4 silently staying removed for tests 5-100.
 * - Total. Every failure is a typed `{ ok: false, detail }`, never a throw
 *   and never a silent no-op. A mutation that quietly failed to apply would
 *   send the *original* request and then report PASS against expectations
 *   written for a mutated one — a false green, which is the worst possible
 *   outcome for this feature.
 * - Bounded. The result is size-checked against `MAX_MUTATED_BODY_BYTES`
 *   before it can be handed to a transport.
 *
 * ## The URL is the source of truth
 *
 * `SecurityRequestInput.url` carries the whole URL including its query
 * string, and `query` is a mirror kept in sync by this module. Having the
 * query live in two places that could disagree is exactly how a mutation
 * ends up being tested against one request and sent as another, so every
 * query mutation here rewrites both and derives one from the other.
 */

export type MutationApplication =
  | { ok: true; request: SecurityRequestInput; warnings: string[] }
  | { ok: false; detail: string };

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function readQuery(url: URL): Array<{ name: string; value: string }> {
  const entries: Array<{ name: string; value: string }> = [];
  for (const [name, value] of url.searchParams.entries()) entries.push({ name, value });
  return entries;
}

/** Rebuilds a request around a modified URL, re-deriving the query mirror. */
function withUrl(input: SecurityRequestInput, url: URL): SecurityRequestInput {
  return { ...input, url: url.toString(), query: readQuery(url) };
}

function findHeaderIndex(input: SecurityRequestInput, name: string): number {
  const target = name.toLowerCase();
  return input.headers.findIndex((header) => header.name.toLowerCase() === target);
}

function withHeaders(
  input: SecurityRequestInput,
  headers: Array<{ name: string; value: string }>,
): SecurityRequestInput {
  const contentTypeHeader = headers.find((header) => header.name.toLowerCase() === "content-type");
  return { ...input, headers, contentType: contentTypeHeader?.value };
}

// ---------------------------------------------------------------------------
// Path parameters (spec §9)
// ---------------------------------------------------------------------------

/**
 * Locates the URL path segment corresponding to `{name}` in the contract's
 * path template.
 *
 * Templates are aligned from the **right**. A specification's `servers` entry
 * frequently carries a base path (`https://host/api/v2`) that the template
 * does not repeat, so `/users/{id}` has to line up against the tail of
 * `/api/v2/users/42`. Aligning from the left would put every parameter one or
 * two segments off and mutate the wrong thing — quietly, and in a way that
 * still produces a plausible-looking 400.
 */
export function locatePathParameter(
  pathname: string,
  pathTemplate: string,
  parameterName: string,
): { segments: string[]; index: number } | null {
  const actual = pathname.split("/");

  // The template's own leading empty segment (produced by its "/" prefix) is
  // dropped before aligning. Keeping it would require "" to equal some middle
  // segment of the actual path, which fails for every URL carrying a server
  // base path — precisely the case right-alignment exists to handle.
  const template = pathTemplate.split("/").filter((segment, index) => !(index === 0 && segment === ""));

  // `< 1` rather than `< 0`: the actual path always contributes its own
  // leading empty segment, so a valid alignment leaves at least that one.
  const offset = actual.length - template.length;
  if (offset < 1) return null;

  const templateIndex = template.findIndex((segment) => segment === `{${parameterName}}`);
  if (templateIndex === -1) return null;

  // Every literal segment of the template must agree with the URL at the
  // aligned offset. If they do not, the template does not describe this URL
  // and guessing would be worse than declining.
  for (let i = 0; i < template.length; i++) {
    const templateSegment = template[i]!;
    if (templateSegment.startsWith("{") && templateSegment.endsWith("}")) continue;
    if (actual[offset + i] !== templateSegment) return null;
  }

  return { segments: actual, index: offset + templateIndex };
}

// ---------------------------------------------------------------------------
// Authentication (spec §12, §34)
// ---------------------------------------------------------------------------

/**
 * The replacement credential for an auth mutation.
 *
 * `null` means "remove the credential entirely" — the missing-authentication
 * and missing-API-key cases. Everything else is a fixed constant from
 * credentials.ts; nothing here is derived from the user's real credential,
 * so a mutated request can never carry a partially-real secret.
 */
function authReplacement(kind: AuthMutationKind, scheme: "bearer" | "basic" | "raw"): string | null {
  switch (kind) {
    case "none":
    case "missing-api-key":
      return null;
    case "invalid-token":
      if (scheme === "basic") return `Basic ${INVALID_BASIC_CREDENTIALS}`;
      return scheme === "bearer" ? `Bearer ${INVALID_BEARER_TOKEN}` : INVALID_BEARER_TOKEN;
    case "expired-token":
      return scheme === "bearer" ? `Bearer ${EXPIRED_JWT}` : EXPIRED_JWT;
    case "malformed-token":
      return scheme === "bearer" ? `Bearer ${MALFORMED_TOKEN}` : MALFORMED_TOKEN;
    case "wrong-api-key":
      return WRONG_API_KEY;
    default:
      return null;
  }
}

function applyAuthMutation(input: SecurityRequestInput, kind: AuthMutationKind): MutationApplication {
  if (input.auth.kind === "none") {
    // Not an error in the abstract, but it is an error *here*: the generator
    // only emits auth mutations for requests that carry a credential, so
    // reaching this means the request changed between generation and
    // execution. Sending it anyway would produce a meaningless PASS.
    return {
      ok: false,
      detail: "The target request has no authentication configured, so there is no credential to remove or replace.",
    };
  }

  if (input.auth.kind === "header") {
    const replacement = authReplacement(kind, input.auth.scheme);
    const index = findHeaderIndex(input, input.auth.name);
    if (index === -1) {
      return { ok: false, detail: `Expected authorization header "${input.auth.name}" is not present on the built request.` };
    }
    const headers = [...input.headers];
    if (replacement === null) headers.splice(index, 1);
    else headers[index] = { name: input.auth.name, value: replacement };
    return { ok: true, request: withHeaders(input, headers), warnings: [] };
  }

  // Query-parameter credential (an API key in the query string).
  const replacement = authReplacement(kind, "raw");
  const url = new URL(input.url);
  if (!url.searchParams.has(input.auth.name)) {
    return { ok: false, detail: `Expected authorization query parameter "${input.auth.name}" is not present on the built request.` };
  }
  if (replacement === null) url.searchParams.delete(input.auth.name);
  else url.searchParams.set(input.auth.name, replacement);
  return { ok: true, request: withUrl(input, url), warnings: [] };
}

// ---------------------------------------------------------------------------
// Body (spec §7, §8)
// ---------------------------------------------------------------------------

function applyBodyMutation(input: SecurityRequestInput, mutation: Mutation): MutationApplication {
  if (input.body === undefined || input.body.trim() === "") {
    return { ok: false, detail: "The target request has no body to mutate." };
  }

  if (mutation.operation === "malform-json") {
    // Derived from the user's own body by deletion, never by injection: drop
    // the final non-whitespace character so the document stops parsing. This
    // tests the parser's error path (spec §19) without introducing a single
    // byte the tester did not already intend to send.
    const trimmed = input.body.replace(/\s+$/, "");
    if (trimmed.length === 0) return { ok: false, detail: "The target request body is empty." };
    return { ok: true, request: { ...input, body: trimmed.slice(0, -1) }, warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return { ok: false, detail: "The target request body is not valid JSON, so field-level mutations cannot be applied." };
  }

  const existing = getAtPointer(parsed, mutation.target);
  if (!existing.found) {
    return { ok: false, detail: `The target request body has no field at ${mutation.target}.` };
  }

  const applied =
    mutation.operation === "remove"
      ? removeAtPointer(parsed, mutation.target)
      : setAtPointer(parsed, mutation.target, mutation.value.kind === "json" ? mutation.value.json : null);

  if (!applied) {
    return { ok: false, detail: `Could not apply the mutation at ${mutation.target}.` };
  }

  const body = JSON.stringify(parsed);
  if (utf8Bytes(body) > MAX_MUTATED_BODY_BYTES) {
    return {
      ok: false,
      detail: `The mutated body exceeds the ${MAX_MUTATED_BODY_BYTES}-byte request limit and was not sent.`,
    };
  }

  return { ok: true, request: { ...input, body }, warnings: [] };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function mutationText(mutation: Mutation): string | null {
  if (mutation.value.kind === "text") return mutation.value.text;
  if (mutation.value.kind === "json") return typeof mutation.value.json === "string" ? mutation.value.json : JSON.stringify(mutation.value.json);
  return null;
}

export function applyMutation(input: SecurityRequestInput, mutation: Mutation): MutationApplication {
  switch (mutation.location) {
    case "request.auth": {
      if (mutation.value.kind !== "auth") {
        return { ok: false, detail: "An authorization mutation requires an authorization value." };
      }
      return applyAuthMutation(input, mutation.value.auth);
    }

    case "request.body":
      return applyBodyMutation(input, mutation);

    case "request.query": {
      const url = new URL(input.url);
      if (mutation.operation === "remove") {
        if (!url.searchParams.has(mutation.target)) {
          return { ok: false, detail: `Query parameter "${mutation.target}" is not present on the built request.` };
        }
        url.searchParams.delete(mutation.target);
        return { ok: true, request: withUrl(input, url), warnings: [] };
      }
      const text = mutationText(mutation);
      if (text === null) return { ok: false, detail: "A query mutation requires a replacement value." };
      url.searchParams.set(mutation.target, text);
      return { ok: true, request: withUrl(input, url), warnings: [] };
    }

    case "request.header": {
      const headers = [...input.headers];
      const index = findHeaderIndex(input, mutation.target);

      if (mutation.operation === "remove") {
        if (index === -1) {
          return { ok: false, detail: `Header "${mutation.target}" is not present on the built request.` };
        }
        headers.splice(index, 1);
        return { ok: true, request: withHeaders(input, headers), warnings: [] };
      }

      const text = mutationText(mutation);
      if (text === null) return { ok: false, detail: "A header mutation requires a replacement value." };
      // A header mutation may legitimately *introduce* the header — sending an
      // unexpected Content-Type to a request that declared none is one of the
      // cases spec §11 asks for.
      if (index === -1) headers.push({ name: mutation.target, value: text });
      else headers[index] = { name: headers[index]!.name, value: text };
      return { ok: true, request: withHeaders(input, headers), warnings: [] };
    }

    case "request.path": {
      if (input.pathTemplate === undefined) {
        return { ok: false, detail: "Path-parameter mutation requires a matched contract operation." };
      }
      const text = mutationText(mutation);
      if (text === null) return { ok: false, detail: "A path mutation requires a replacement value." };

      const url = new URL(input.url);
      const located = locatePathParameter(url.pathname, input.pathTemplate, mutation.target);
      if (!located) {
        return {
          ok: false,
          detail: `Could not locate path parameter "${mutation.target}" in ${url.pathname} using template ${input.pathTemplate}.`,
        };
      }
      const segments = [...located.segments];
      segments[located.index] = encodeURIComponent(text);
      url.pathname = segments.join("/");
      return { ok: true, request: withUrl(input, url), warnings: [] };
    }

    default:
      return { ok: false, detail: "Unsupported mutation location." };
  }
}
