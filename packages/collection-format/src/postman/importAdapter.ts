import { HTTP_METHODS, type BodyRawFormat, type HttpMethod, type KeyValueRow } from "@api-lab/shared";
import type { AuthConfig } from "@api-lab/auth-engine";
import type { RequestConfig } from "@api-lab/workspace-engine";
import { emptyRequestConfig, row } from "../internal";
import type { NormalizedCollectionImport, NormalizedEnvironmentImport, NormalizedItem, NormalizedRequest } from "../types";
import type { PostmanAuth, PostmanBody, PostmanCollection, PostmanEnvironment, PostmanItem, PostmanUrl } from "./schema";

const SUPPORTED_METHODS = new Set<string>(HTTP_METHODS);

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
}

function mapMethod(raw: string | undefined, warnings: string[]): HttpMethod {
  const method = (raw ?? "GET").toUpperCase();
  if (SUPPORTED_METHODS.has(method)) return method as HttpMethod;
  warnings.push(`Method "${method}" is not supported by API Lab's request engine yet; imported as GET.`);
  return "GET";
}

function mapUrl(url: PostmanUrl | undefined): {
  url: string;
  query: KeyValueRow[];
} {
  if (typeof url === "string") return { url, query: [] };
  if (!url) return { url: "", query: [] };
  const query = (url.query ?? [])
    .filter((q) => q.key)
    .map((q) => row(q.key ?? "", toStringValue(q.value), !q.disabled));
  if (url.raw) return { url: url.raw, query };
  const host = Array.isArray(url.host) ? url.host.join(".") : (url.host ?? "");
  const path = Array.isArray(url.path) ? url.path.join("/") : (url.path ?? "");
  const reconstructed = [host, path].filter(Boolean).join("/");
  return { url: reconstructed, query };
}

const RAW_LANGUAGE_TO_FORMAT: Record<string, BodyRawFormat> = {
  json: "JSON",
  text: "Text",
  xml: "XML",
  html: "HTML",
};

function mapBody(
  body: PostmanBody | undefined,
  warnings: string[],
): Pick<RequestConfig, "bodyMode" | "bodyRawFormat" | "bodyRawContent"> {
  if (!body || !body.mode || body.mode === "none") {
    return { bodyMode: "none", bodyRawFormat: "JSON", bodyRawContent: "" };
  }

  if (body.mode === "raw") {
    const language = body.options?.raw?.language ?? "json";
    return {
      bodyMode: "raw",
      bodyRawFormat: RAW_LANGUAGE_TO_FORMAT[language] ?? "Text",
      bodyRawContent: body.raw ?? "",
    };
  }

  if (body.mode === "urlencoded" || body.mode === "formdata") {
    // Milestone 2 deliberately does not execute form-data/x-www-form-urlencoded
    // bodies yet. Preserve the data as readable text rather than discarding
    // it, and warn clearly that it won't be sent until that support exists.
    const rows = body.mode === "urlencoded" ? (body.urlencoded ?? []) : (body.formdata ?? []);
    const preserved = rows
      .filter((r) => r.key)
      .map((r) => `${r.key}=${toStringValue(r.value)}`)
      .join("\n");
    warnings.push(
      `"${body.mode}" body preserved as text but not currently executable (form-data/urlencoded sending is a deferred API Lab capability).`,
    );
    return { bodyMode: "raw", bodyRawFormat: "Text", bodyRawContent: preserved };
  }

  warnings.push(`Body mode "${body.mode}" is not supported; body was not imported.`);
  return { bodyMode: "none", bodyRawFormat: "JSON", bodyRawContent: "" };
}

function findParam(list: unknown, key: string): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const match = list.find((p) => p && typeof p === "object" && (p as { key?: string }).key === key);
  return match ? toStringValue((match as { value?: unknown }).value) : undefined;
}

function mapAuth(auth: PostmanAuth | undefined, warnings: string[]): AuthConfig {
  if (!auth || auth.type === "noauth") return { type: "none" };

  switch (auth.type) {
    case "apikey": {
      const key = findParam(auth.apikey, "key") ?? "";
      const value = findParam(auth.apikey, "value") ?? "";
      const inLocation = findParam(auth.apikey, "in");
      return { type: "apiKey", key, value, addTo: inLocation === "query" ? "query" : "header" };
    }
    case "basic": {
      const username = findParam(auth.basic, "username") ?? "";
      const password = findParam(auth.basic, "password") ?? "";
      return { type: "basic", username, password };
    }
    case "bearer": {
      const token = findParam(auth.bearer, "token") ?? "";
      return { type: "bearer", token };
    }
    default:
      warnings.push(`Authentication type "${auth.type}" is not supported by API Lab yet; imported as No Auth.`);
      return { type: "none" };
  }
}

function countScripts(item: PostmanItem): number {
  return (item.event ?? []).filter((e) => e.script?.exec && (Array.isArray(e.script.exec) ? e.script.exec.length > 0 : e.script.exec.length > 0)).length;
}

function adaptRequestItem(item: PostmanItem): NormalizedRequest {
  const warnings: string[] = [];
  const pmRequest = item.request ?? {};
  const method = mapMethod(pmRequest.method, warnings);
  const { url, query } = mapUrl(pmRequest.url);
  const headers = (pmRequest.header ?? [])
    .filter((h) => h.key)
    .map((h) => row(h.key ?? "", toStringValue(h.value), !h.disabled));
  const body = mapBody(pmRequest.body, warnings);
  const auth = mapAuth(pmRequest.auth, warnings);

  const scriptCount = countScripts(item);
  if (scriptCount > 0) {
    warnings.push(
      `${scriptCount} script${scriptCount > 1 ? "s" : ""} on this request ${scriptCount > 1 ? "were" : "was"} not imported — script execution is a future API Lab milestone and imported scripts are never executed.`,
    );
  }

  const request = emptyRequestConfig({ method, url, params: query, headers, auth, ...body });
  return { type: "request", name: item.name ?? "Untitled Request", request, warnings };
}

function adaptItems(items: PostmanItem[], collectionWarnings: string[]): NormalizedItem[] {
  const result: NormalizedItem[] = [];
  for (const item of items) {
    if (item.item) {
      // Postman folders can nest arbitrarily; API Lab folders are one level
      // deep (see docs/ARCHITECTURE.md, Milestone 3). A nested sub-folder's
      // requests are flattened into the parent folder with a warning,
      // rather than silently dropped or crashing on deep recursion.
      const nestedRequests: NormalizedRequest[] = [];
      const flatten = (nodes: PostmanItem[]) => {
        for (const node of nodes) {
          if (node.item) {
            collectionWarnings.push(
              `Folder "${node.name ?? "Untitled"}" is nested more than one level deep; its requests were flattened into "${item.name ?? "Untitled Folder"}" (API Lab folders are one level deep).`,
            );
            flatten(node.item);
          } else {
            nestedRequests.push(adaptRequestItem(node));
          }
        }
      };
      flatten(item.item);
      result.push({ type: "folder", name: item.name ?? "Untitled Folder", items: nestedRequests });
    } else {
      result.push(adaptRequestItem(item));
    }
  }
  return result;
}

export function adaptPostmanCollection(collection: PostmanCollection): NormalizedCollectionImport {
  const warnings: string[] = [];
  const items = adaptItems(collection.item, warnings);

  const collectionScripts = (collection.event ?? []).length;
  if (collectionScripts > 0) {
    warnings.push(
      `${collectionScripts} collection-level script${collectionScripts > 1 ? "s" : ""} not imported — script execution is a future milestone.`,
    );
  }

  return {
    kind: "collection",
    name: collection.info.name,
    items,
    warnings: [...warnings, ...items.flatMap((i) => (i.type === "request" ? i.warnings : i.items.flatMap((r) => r.warnings)))],
    sourceFormat: "postman-collection",
  };
}

export function adaptPostmanEnvironment(environment: PostmanEnvironment): NormalizedEnvironmentImport {
  const variables = environment.values.map((v) => ({
    key: v.key,
    value: toStringValue(v.value),
    enabled: v.enabled ?? true,
    // Postman marks a value's `type` as "secret" for masked variables —
    // the closest concept to API Lab's `secret` flag (see Milestone 4).
    secret: v.type === "secret",
  }));
  return {
    kind: "environment",
    name: environment.name ?? "Imported Environment",
    variables,
    warnings: [],
    sourceFormat: "postman-environment",
  };
}
