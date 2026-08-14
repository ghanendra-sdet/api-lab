import { extractRequestPath } from "@api-lab/contract-engine";
import type { HttpMethod } from "@api-lab/shared";

/**
 * The neutral collection input documentation generation takes (spec §7).
 *
 * ## Why not `Collection` from workspace-engine
 *
 * The same boundary `runner-engine` and `contract-engine` already hold, for
 * the same reason: an engine that imported `Collection` would import
 * `RequestConfig`, and through it `AuthConfig`, `Assertion` and `Extraction`
 * — the entire application model — into a package whose value is that it is
 * independently usable and independently testable. `apps/web` owns the
 * one-way adaptation, in `lib/documentationAdapt.ts`.
 *
 * ## Why there is no credential field anywhere in this file
 *
 * This is the security-critical part of the boundary, and it is deliberate
 * rather than incidental.
 *
 * `AuthConfig` in `@api-lab/auth-engine` holds real credentials: bearer
 * tokens, basic passwords, API key values. If this interface accepted an
 * `AuthConfig`, then every future change to the generator would be one
 * careless line away from rendering a live token into a documentation file
 * that is designed to be exported and shared.
 *
 * So the adapter in `apps/web` reduces auth to `DocCollectionAuth` — type,
 * scheme, location and parameter *name* — before the engine ever sees it. The
 * credential does not cross the package boundary. `redactExampleBody` and
 * `redactExampleHeaders` still run on everything else, so this is defence in
 * depth rather than the only control, but it is the control that cannot be
 * forgotten at a call site.
 *
 * The same reasoning governs `url` and `headers`: these carry the request as
 * *configured*, with `{{variables}}` unresolved. Spec §16 wants exactly that
 * — `Authorization: Bearer {{token}}` is the useful documentation and
 * `Authorization: Bearer eyJhbGci…` is an incident.
 */

/**
 * An authentication scheme described without its credential.
 *
 * Note the absence of `token`, `username`, `password`, `value`, `key`. There
 * is nowhere here to put a secret.
 */
export interface DocCollectionAuth {
  /** "none" | "bearer" | "basic" | "api-key" | "oauth2" — the configured type. */
  type: string;
  /** For api-key auth: "header" | "query". Not a secret. */
  location: string | undefined;
  /** For api-key auth: the header or query parameter name. Not a secret. */
  parameterName: string | undefined;
}

/** A key/value pair from a request, with variables left unresolved. */
export interface DocKeyValue {
  name: string;
  value: string;
}

/**
 * A recorded response offered as a documentation example (spec §18).
 *
 * Spec §18 is cautious about this, and the caution is respected structurally:
 * this field is populated only when the caller explicitly supplies it. The
 * engine never reaches out for a response, never persists one, and never
 * promotes a Runner result into documentation on its own. Redaction applies
 * to whatever is supplied regardless.
 */
export interface DocRecordedResponse {
  status: number;
  contentType: string | undefined;
  headers: DocKeyValue[];
  body: string | undefined;
  /** "collection" for a real recorded response, "mock" for a M9 scenario. */
  origin: "collection" | "mock";
}

export interface DocCollectionRequest {
  id: string;
  name: string;
  description: string | undefined;
  method: HttpMethod;
  /** As configured, with `{{variables}}` intact. */
  url: string;
  /** The containing folder's name, when the request lives in one (spec §28). */
  folderName: string | undefined;
  headers: DocKeyValue[];
  queryParams: DocKeyValue[];
  /** Raw request body as configured, variables intact. */
  body: string | undefined;
  contentType: string | undefined;
  auth: DocCollectionAuth;
  /** Explicitly selected recorded responses only. See DocRecordedResponse. */
  recordedResponses: DocRecordedResponse[];
}

export interface DocCollectionSource {
  name: string;
  description: string | undefined;
  requests: DocCollectionRequest[];
}

/**
 * Extracts the path portion of a request URL for documentation.
 *
 * Two problems, solved in two layers.
 *
 * **The variable prefix** is this package's own. A collection URL is
 * frequently `{{baseUrl}}/orders`, which `new URL()` rejects outright, so any
 * leading `{{...}}` segments are stripped textually first. They are the
 * base-URL placeholder, and the server is documented once in the Servers
 * section — repeating a variable reference on every endpoint row adds nothing.
 *
 * **The server base path** is not this package's problem to re-solve.
 * `extractRequestPath` in contract-engine already strips a documented
 * server's base path, longest-match-first so the most specific server wins,
 * and Milestone 11 tested it. Reimplementing it here would produce a second
 * answer to "is `/v1/orders` the same endpoint as `/orders`?" — and the two
 * answers would only have to disagree once for the combined-source merge in
 * combine.ts to silently stop matching operations it should match.
 *
 * That is not hypothetical: it is exactly the defect this function had when
 * it first tried to do the job itself, caught by the combined-source tests.
 *
 * `servers` is empty for a collection-only source, which is the honest
 * result — with no specification, nothing says `/v1` is a base path rather
 * than part of the endpoint, and inventing that would violate spec §2.
 */
export function extractCollectionPath(url: string, servers: string[] = []): string {
  const trimmed = url.trim();

  // Leading `{{var}}` segments are the base-URL placeholder.
  const withoutVariablePrefix = trimmed.replace(/^(\{\{[^{}]+\}\})+/, "");
  if (withoutVariablePrefix === "") return "/";

  const normalized =
    /^https?:\/\//i.test(withoutVariablePrefix) || withoutVariablePrefix.startsWith("/")
      ? withoutVariablePrefix
      : `/${withoutVariablePrefix}`;

  const path = extractRequestPath(normalized, servers);
  return path === "" ? "/" : path;
}

/**
 * Derives the server origin a collection request points at, when it is
 * literal enough to be useful.
 *
 * A URL built entirely from variables has no documentable origin, and
 * inventing one would violate spec §2's rule against stating API behavior the
 * source did not.
 */
export function extractCollectionServer(url: string): string | undefined {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed.split("?")[0] ?? trimmed);
    return parsed.origin;
  } catch {
    return undefined;
  }
}
