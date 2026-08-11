import type { ContractModel, ContractRequestInput, DriftInputEndpoint } from "@api-lab/contract-engine";
import { extractRequestPath } from "@api-lab/contract-engine";
import type { Collection, RequestConfig } from "@api-lab/workspace-engine";
import { isFolder, isRequest } from "@api-lab/workspace-engine";
import type { HttpMethod, KeyValueRow } from "@api-lab/shared";

/**
 * The one-way adaptation between API Lab's workspace model and the contract
 * engine's neutral input shapes.
 *
 * `@api-lab/contract-engine` deliberately knows nothing about `RequestConfig`,
 * `Collection`, or the Zustand store — the same boundary `runner-engine`
 * holds (see its types.ts). Everything that needs both worlds lives here, in
 * `apps/web`, so the engine stays independently testable and reusable.
 */

/** Splits a `Cookie` header value into individual cookie pairs. */
function parseCookieHeader(value: string): Array<{ name: string; value: string }> {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return { name: part, value: "" };
      return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
    });
}

function enabledRows(rows: KeyValueRow[]): KeyValueRow[] {
  return rows.filter((row) => row.enabled && row.key.trim() !== "");
}

/**
 * Builds the contract engine's request input from a *fully resolved* request.
 *
 * Spec §31 is explicit about the order: dataset → runtime → environment →
 * request resolution → request contract validation. The values passed in
 * here must already have had `{{variables}}` substituted and authorization
 * applied, because validating the literal text `{{userId}}` against an
 * integer schema would be a guaranteed false failure that says nothing about
 * the contract.
 */
export function buildContractRequestInput(
  contract: ContractModel,
  method: HttpMethod,
  resolvedUrl: string,
  headers: Record<string, string>,
  queryParams: KeyValueRow[],
  body: string | undefined,
): ContractRequestInput {
  const headerEntries = Object.entries(headers).map(([name, value]) => ({ name, value }));

  const cookieHeader = headerEntries.find((entry) => entry.name.toLowerCase() === "cookie");
  const cookies = cookieHeader ? parseCookieHeader(cookieHeader.value) : [];

  const contentTypeHeader = headerEntries.find((entry) => entry.name.toLowerCase() === "content-type");

  // The URL's own query string is authoritative for anything already baked
  // into it; the params rows cover what the builder appends.
  const urlQuery: Array<{ name: string; value: string }> = [];
  const questionMark = resolvedUrl.indexOf("?");
  if (questionMark !== -1) {
    const search = new URLSearchParams(resolvedUrl.slice(questionMark + 1).split("#")[0]);
    for (const [name, value] of search.entries()) urlQuery.push({ name, value });
  }

  const rowQuery = enabledRows(queryParams).map((row) => ({ name: row.key, value: row.value }));
  const seen = new Set(urlQuery.map((entry) => `${entry.name}=${entry.value}`));
  const query = [...urlQuery, ...rowQuery.filter((entry) => !seen.has(`${entry.name}=${entry.value}`))];

  return {
    method,
    path: extractRequestPath(resolvedUrl, contract.servers),
    query,
    headers: headerEntries,
    cookies,
    body,
    contentType: contentTypeHeader?.value,
  };
}

/** Flattens a collection into the neutral endpoint shape drift detection takes. */
export function collectionToDriftEndpoints(collection: Collection): DriftInputEndpoint[] {
  const endpoints: DriftInputEndpoint[] = [];

  function add(id: string, name: string, config: RequestConfig): void {
    endpoints.push({
      id,
      name,
      method: config.method,
      url: config.url,
      queryParameterNames: enabledRows(config.params).map((row) => row.key),
      hasBody: config.bodyMode !== "none" && config.bodyRawContent.trim() !== "",
    });
  }

  for (const item of collection.items) {
    if (isFolder(item)) {
      for (const request of item.items) add(request.id, request.name, request.request);
    } else if (isRequest(item)) {
      add(item.id, item.name, item.request);
    }
  }

  return endpoints;
}
