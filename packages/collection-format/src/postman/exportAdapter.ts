import type { AuthConfig } from "@api-lab/auth-engine";
import type { Collection, CollectionItem, RequestConfig } from "@api-lab/workspace-engine";
import { isFolder } from "@api-lab/workspace-engine";

/**
 * Exports an API Lab Collection as a Postman Collection v2.1 document.
 * Deterministic: no timestamps, no random IDs — the same Collection always
 * produces byte-identical JSON, which keeps round-trip tests and git diffs
 * meaningful. Only fields API Lab actually supports are ever emitted; there
 * is nothing to omit for "not implemented" since every exported field maps
 * to something the collection genuinely has.
 */
export function exportPostmanCollection(collection: Collection): unknown {
  return {
    info: {
      name: collection.name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: collection.items.map(exportItem),
  };
}

function exportItem(item: CollectionItem): unknown {
  if (isFolder(item)) {
    return { name: item.name, item: item.items.map(exportItem) };
  }
  return exportRequestItem(item.name, item.request);
}

function exportRequestItem(name: string, request: RequestConfig): unknown {
  return {
    name,
    request: {
      method: request.method,
      header: request.headers
        .filter((h) => h.key)
        .map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
      url: {
        raw: appendQueryString(request.url, request.params),
        query: request.params
          .filter((p) => p.key)
          .map((p) => ({ key: p.key, value: p.value, disabled: !p.enabled })),
      },
      body: exportBody(request),
      auth: exportAuth(request.auth),
    },
  };
}

function appendQueryString(url: string, params: RequestConfig["params"]): string {
  const enabled = params.filter((p) => p.enabled && p.key);
  if (enabled.length === 0) return url;
  const qs = enabled.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
}

function exportBody(request: RequestConfig): unknown {
  if (request.bodyMode !== "raw" || request.bodyRawContent === "") return { mode: "raw", raw: "" };
  const language = request.bodyRawFormat.toLowerCase();
  return {
    mode: "raw",
    raw: request.bodyRawContent,
    options: { raw: { language: language === "text" ? "text" : language } },
  };
}

function exportAuth(auth: AuthConfig): unknown {
  switch (auth.type) {
    case "none":
      return { type: "noauth" };
    case "apiKey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: auth.key, type: "string" },
          { key: "value", value: auth.value, type: "string" },
          { key: "in", value: auth.addTo, type: "string" },
        ],
      };
    case "basic":
      return {
        type: "basic",
        basic: [
          { key: "username", value: auth.username, type: "string" },
          { key: "password", value: auth.password, type: "string" },
        ],
      };
    case "bearer":
    case "jwt":
      return { type: "bearer", bearer: [{ key: "token", value: auth.token, type: "string" }] };
    case "oauth2":
      // Not exported as a functional Postman oauth2 block — API Lab never
      // executed this auth type, so there is nothing real to export.
      return { type: "noauth" };
  }
}
