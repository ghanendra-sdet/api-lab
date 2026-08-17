import type { AuthConfig } from "@api-lab/auth-engine";
import {
  extractRequestPath,
  resolveOperation,
  type ContractModel,
  type ContractOperation,
} from "@api-lab/contract-engine";
import type { ApiResponseResult, BuiltRequest } from "@api-lab/request-engine";
import type { AuthPlacement, SecurityRequestInput, SecurityResponseInput } from "@api-lab/security-engine";
import type { KeyValueRow } from "@api-lab/shared";
import type { RequestConfig } from "@api-lab/workspace-engine";
import { prepareRequest, type ExecutionScopes } from "./executeRequest";

/**
 * The one-way adaptation between API Lab's workspace model and the security
 * engine's neutral shapes.
 *
 * `@api-lab/security-engine` deliberately knows nothing about `RequestConfig`,
 * `AuthConfig`, or the Zustand store — the same boundary `runner-engine` and
 * `contract-engine` hold. Everything that needs both worlds lives here, so the
 * engine stays independently testable and reusable.
 */

// ---------------------------------------------------------------------------
// Authentication placement (spec §34)
// ---------------------------------------------------------------------------

/**
 * Describes *where* the Milestone 5 auth engine put the credential.
 *
 * Note what this function does not do: it does not read, copy, or return the
 * credential's value. Milestone 12 adds no second authentication
 * implementation (spec §34); it only needs to know which header or query
 * parameter to strip or overwrite. Returning the value would put a live
 * credential into a structure that flows toward generated test definitions,
 * which spec §33 forbids.
 *
 * `oauth2` maps to `none` because it is architecturally reserved and not
 * executable (see auth-engine's types.ts) — there is no credential on the
 * wire to mutate.
 */
export function authPlacementFor(config: AuthConfig): AuthPlacement {
  switch (config.type) {
    case "none":
    case "inherit":
    case "oauth2":
      return { kind: "none" };

    case "apiKey":
      if (config.key.trim() === "") return { kind: "none" };
      return config.addTo === "header"
        ? { kind: "header", name: config.key, scheme: "raw" }
        : { kind: "query", name: config.key };

    case "basic":
      return { kind: "header", name: "Authorization", scheme: "basic" };

    case "bearer":
    case "jwt":
      return { kind: "header", name: "Authorization", scheme: "bearer" };
  }
}

// ---------------------------------------------------------------------------
// Request adaptation
// ---------------------------------------------------------------------------

/**
 * The contract operation a request maps onto, when a contract is attached and
 * the match is unambiguous.
 *
 * An `ambiguous` match resolves to `undefined` rather than a guess, for the
 * same reason Milestone 11 refused to guess: mutating a path parameter based
 * on the wrong template would edit the wrong URL segment and produce a
 * plausible-looking 400 that means nothing.
 */
export function matchOperation(contract: ContractModel | null, method: BuiltRequest["method"], url: string): ContractOperation | undefined {
  if (contract === null) return undefined;
  const match = resolveOperation(contract, method, extractRequestPath(url, contract.servers));
  return match.status === "matched" ? match.operation : undefined;
}

function enabledRows(rows: KeyValueRow[]): Array<{ name: string; value: string }> {
  return rows.filter((row) => row.enabled && row.key.trim() !== "").map((row) => ({ name: row.key, value: row.value }));
}

export interface ResolveSecurityRequestResult {
  ok: boolean;
  request?: SecurityRequestInput;
  detail?: string;
}

/**
 * Materialises the fully-resolved request a security test will mutate.
 *
 * Composes `prepareRequest` — the *same* front half of the pipeline that Send
 * and the Collection Runner use — rather than reimplementing resolution. If
 * the two ever diverged, a security test would be reporting results about a
 * request the user never configured.
 *
 * Called per test, at execution time (spec §33). The credential it produces
 * lives in memory for the duration of one request and is never returned to a
 * caller that persists anything.
 */
export function resolveSecurityRequest(
  requestId: string,
  requestName: string,
  config: RequestConfig,
  scopes: ExecutionScopes,
  contract: ContractModel | null,
): ResolveSecurityRequestResult {
  const preparation = prepareRequest(requestId, requestName, config, scopes);
  if (!preparation.ok) return { ok: false, detail: preparation.validationError.message };

  const { built, params, resolvedAuth } = preparation.prepared;
  const operation = matchOperation(contract, built.method, built.url);

  const headers = Object.entries(built.headers).map(([name, value]) => ({ name, value }));

  // The URL is the source of truth for the query string (see mutate.ts); the
  // mirror is derived from it, with any params the builder appended folded in.
  const query: Array<{ name: string; value: string }> = [];
  try {
    const url = new URL(built.url);
    for (const [name, value] of url.searchParams.entries()) query.push({ name, value });
  } catch {
    query.push(...enabledRows(params));
  }

  return {
    ok: true,
    request: {
      method: built.method,
      url: built.url,
      headers,
      query,
      body: built.body,
      contentType: headers.find((header) => header.name.toLowerCase() === "content-type")?.value,
      pathTemplate: operation?.path,
      auth: authPlacementFor(resolvedAuth),
    },
  };
}

// ---------------------------------------------------------------------------
// Response adaptation
// ---------------------------------------------------------------------------

/** Adapts the request engine's response onto the security engine's shape. */
export function toSecurityResponse(response: ApiResponseResult): SecurityResponseInput {
  return {
    status: response.status,
    headers: response.headers,
    rawBody: response.rawBody,
    durationMs: response.duration,
    error: response.error,
  };
}
