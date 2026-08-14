import type { AuthConfig } from "@api-lab/auth-engine";
import type {
  DocCollectionAuth,
  DocCollectionRequest,
  DocCollectionSource,
  DocKeyValue,
} from "@api-lab/documentation-engine";
import type { Collection, RequestConfig, SavedRequest } from "@api-lab/workspace-engine";
import { isFolder, isRequest } from "@api-lab/workspace-engine";
import type { KeyValueRow } from "@api-lab/shared";

/**
 * The one-way adaptation between API Lab's workspace model and the
 * documentation engine's neutral input shapes.
 *
 * `@api-lab/documentation-engine` deliberately knows nothing about
 * `RequestConfig`, `Collection`, `AuthConfig`, or the Zustand store — the
 * same boundary `runner-engine`, `contract-engine` and `security-engine`
 * hold. Everything that needs both worlds lives here, in `apps/web`, so the
 * engine stays independently testable and reusable. See `lib/contractAdapt.ts`
 * for the same pattern in Milestone 11.
 *
 * ## This file is a security boundary, not just a type conversion
 *
 * `describeAuth` below is the reason. `AuthConfig` holds live credentials —
 * bearer tokens, basic passwords, API key values. `DocCollectionAuth` has
 * nowhere to put one: it carries the auth *type*, the *location*, and the
 * parameter *name*, and that is the complete list of its fields.
 *
 * So the credential is dropped here, at the edge of the application, and
 * never crosses into the engine at all. Redaction inside the engine still
 * runs on everything else (URLs, headers, bodies), which makes this defence
 * in depth rather than the only control — but it is the control that cannot
 * be forgotten at a call site, because there is no call site that could carry
 * a token through.
 *
 * ## Variables are deliberately left unresolved
 *
 * Note what this file does *not* do: it does not resolve `{{variables}}`, and
 * it does not call `resolveRequestConfig`. Spec §16 wants
 * `Authorization: Bearer {{token}}` in the generated documentation, and a
 * resolved `Authorization: Bearer eyJhbGci…` would be an incident. Milestone
 * 11's `contractAdapt.ts` takes the opposite position — it insists on
 * *resolved* values — because validating the literal text `{{userId}}`
 * against an integer schema would be a guaranteed false failure. The two
 * requirements genuinely differ, and that is why these are two adapters
 * rather than one.
 */

/** Enabled, named rows only — a blank row is UI state, not configuration. */
function enabledRows(rows: KeyValueRow[]): DocKeyValue[] {
  return rows
    .filter((row) => row.enabled && row.key.trim() !== "")
    .map((row) => ({ name: row.key, value: row.value }));
}

/**
 * Reduces an `AuthConfig` to its credential-free description.
 *
 * Every branch returns only structural information. There is no `default`
 * case that could pass an unrecognised future auth type through with its
 * fields intact — the switch is exhaustive over `AuthConfig["type"]`, so
 * adding a variant to auth-engine produces a TypeScript error here rather
 * than a silent leak.
 */
export function describeAuth(auth: AuthConfig): DocCollectionAuth {
  switch (auth.type) {
    case "none":
      return { type: "none", location: undefined, parameterName: undefined };
    case "apiKey":
      return {
        type: "api-key",
        location: auth.addTo,
        // The key *name* (`X-API-Key`) is diagnostic and not secret. The
        // value (`auth.value`) is deliberately not read.
        parameterName: auth.key.trim() === "" ? undefined : auth.key,
      };
    case "basic":
      return { type: "basic", location: "header", parameterName: "Authorization" };
    case "bearer":
      return { type: "bearer", location: "header", parameterName: "Authorization" };
    case "jwt":
      return { type: "bearer", location: "header", parameterName: "Authorization" };
    case "oauth2":
      return { type: "oauth2", location: "header", parameterName: "Authorization" };
  }
}

/** The declared content type of a request, when it has a body. */
function contentTypeOf(config: RequestConfig): string | undefined {
  const header = config.headers.find(
    (row) => row.enabled && row.key.trim().toLowerCase() === "content-type",
  );
  if (header !== undefined && header.value.trim() !== "") return header.value.trim();

  if (config.bodyMode === "none") return undefined;
  if (config.bodyMode === "form-data") return "multipart/form-data";
  if (config.bodyMode === "x-www-form-urlencoded") return "application/x-www-form-urlencoded";

  switch (config.bodyRawFormat) {
    case "JSON":
      return "application/json";
    case "XML":
      return "application/xml";
    case "HTML":
      return "text/html";
    case "Text":
      return "text/plain";
  }
}

function toDocRequest(saved: SavedRequest, folderName: string | undefined): DocCollectionRequest {
  const config = saved.request;
  const hasBody = config.bodyMode !== "none" && config.bodyRawContent.trim() !== "";

  return {
    id: saved.id,
    name: saved.name,
    description: undefined,
    method: config.method,
    // Unresolved, on purpose — see the module comment.
    url: config.url,
    folderName,
    headers: enabledRows(config.headers),
    queryParams: enabledRows(config.params),
    body: hasBody ? config.bodyRawContent : undefined,
    contentType: hasBody ? contentTypeOf(config) : undefined,
    auth: describeAuth(config.auth),
    // Spec §18: recorded responses require explicit selection. Nothing is
    // promoted into documentation automatically, so this is always empty from
    // this adapter — a caller that wants a recorded example must attach it
    // deliberately with `withRecordedResponse` below.
    recordedResponses: [],
  };
}

/** Flattens a collection into the neutral documentation source shape. */
export function collectionToDocSource(collection: Collection): DocCollectionSource {
  const requests: DocCollectionRequest[] = [];

  for (const item of collection.items) {
    if (isFolder(item)) {
      for (const saved of item.items) requests.push(toDocRequest(saved, item.name));
    } else if (isRequest(item)) {
      requests.push(toDocRequest(item, undefined));
    }
  }

  return {
    name: collection.name,
    description: collection.description,
    requests,
  };
}

/**
 * Attaches an explicitly-chosen recorded response to one request in a source.
 *
 * Spec §18 permits real responses to become documentation examples but is
 * explicit that arbitrary production responses must not be persisted or
 * included automatically. Making this a separate, named function that the
 * caller has to invoke — rather than a flag on `collectionToDocSource` —
 * keeps "documentation includes a real response body" a deliberate act
 * rather than a default nobody noticed.
 *
 * The engine redacts whatever is supplied regardless.
 */
export function withRecordedResponse(
  source: DocCollectionSource,
  requestId: string,
  response: DocCollectionRequest["recordedResponses"][number],
): DocCollectionSource {
  return {
    ...source,
    requests: source.requests.map((request) =>
      request.id === requestId
        ? { ...request, recordedResponses: [...request.recordedResponses, response] }
        : request,
    ),
  };
}
