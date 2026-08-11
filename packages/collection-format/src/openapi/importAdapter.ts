import { HTTP_METHODS, type HttpMethod } from "@api-lab/shared";
import type { AuthConfig } from "@api-lab/auth-engine";
import { emptyRequestConfig, row } from "../internal";
import type { NormalizedCollectionImport, NormalizedFolder, NormalizedItem, NormalizedRequest } from "../types";
import { HTTP_METHOD_KEYS, operationSchema, type OpenApiDocument, type OpenApiOperation, type OpenApiSecurityScheme } from "./schema";

const SUPPORTED_METHODS = new Set<string>(HTTP_METHODS);

function pickBaseUrl(doc: OpenApiDocument): string {
  return doc.servers?.[0]?.url ?? "";
}

/**
 * `{userId}` (OpenAPI path-parameter syntax) becomes `{{userId}}` (API Lab
 * variable syntax) — a deliberate, documented mapping, not an accident of
 * find-and-replace. It's semantically defensible specifically for *path*
 * parameters because they must have a value before the request can be
 * sent at all, exactly like a variable; it is NOT applied to query/header
 * parameters, which become ordinary (initially empty) KeyValueRow entries
 * instead, since those don't share that "must resolve or the URL is
 * malformed" property. See docs/ARCHITECTURE.md's Milestone 6 section.
 */
function pathToUrlTemplate(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function exampleToString(mediaType: { example?: unknown; examples?: Record<string, { value?: unknown }> } | undefined): string {
  if (!mediaType) return "";
  if (mediaType.example !== undefined) return JSON.stringify(mediaType.example, null, 2);
  const firstExample = mediaType.examples ? Object.values(mediaType.examples)[0] : undefined;
  if (firstExample?.value !== undefined) return JSON.stringify(firstExample.value, null, 2);
  return "";
}

function mapSecurity(
  operation: OpenApiOperation,
  doc: OpenApiDocument,
  warnings: string[],
): AuthConfig {
  const requirement = operation.security ?? doc.security;
  if (!requirement || requirement.length === 0) return { type: "none" };

  const schemeName = Object.keys(requirement[0] ?? {})[0];
  if (!schemeName) return { type: "none" };

  const scheme: OpenApiSecurityScheme | undefined = doc.components?.securitySchemes?.[schemeName];
  if (!scheme) return { type: "none" };

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return { type: "bearer", token: "{{token}}" };
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return { type: "basic", username: "{{username}}", password: "{{password}}" };
  }
  if (scheme.type === "apiKey") {
    return {
      type: "apiKey",
      key: scheme.name ?? "X-API-Key",
      value: "{{apiKey}}",
      addTo: scheme.in === "query" ? "query" : "header",
    };
  }

  warnings.push(`Security scheme "${schemeName}" (${scheme.type}) is not supported by API Lab yet; imported as No Auth.`);
  return { type: "none" };
}

function adaptOperation(
  method: string,
  path: string,
  operation: OpenApiOperation,
  doc: OpenApiDocument,
  pathLevelParams: NonNullable<OpenApiOperation["parameters"]>,
): NormalizedRequest {
  const warnings: string[] = [];
  const upperMethod = method.toUpperCase();

  let httpMethod: HttpMethod = "GET";
  if (SUPPORTED_METHODS.has(upperMethod)) {
    httpMethod = upperMethod as HttpMethod;
  } else {
    warnings.push(`Method "${upperMethod}" is not supported by API Lab's request engine yet; imported as GET.`);
  }

  const allParams = [...pathLevelParams, ...(operation.parameters ?? [])];
  const query = allParams
    .filter((p) => p.in === "query")
    .map((p) => row(p.name, p.example !== undefined ? String(p.example) : "", p.required ?? false));
  const headers = allParams
    .filter((p) => p.in === "header")
    .map((p) => row(p.name, p.example !== undefined ? String(p.example) : "", p.required ?? false));

  const url = pickBaseUrl(doc) + pathToUrlTemplate(path);

  const jsonBody = operation.requestBody?.content?.["application/json"];
  const bodyContent = exampleToString(jsonBody);
  const hasBody = Boolean(operation.requestBody?.content && Object.keys(operation.requestBody.content).length > 0);
  if (hasBody && !jsonBody) {
    const contentTypes = Object.keys(operation.requestBody?.content ?? {});
    warnings.push(`Request body content type(s) "${contentTypes.join(", ")}" preserved only if JSON; no JSON body was found to import.`);
  }

  const auth = mapSecurity(operation, doc, warnings);

  const request = emptyRequestConfig({
    method: httpMethod,
    url,
    params: query,
    headers,
    auth,
    bodyMode: bodyContent ? "raw" : "none",
    bodyRawFormat: "JSON",
    bodyRawContent: bodyContent,
  });

  const name = operation.summary || operation.operationId || `${upperMethod} ${path}`;
  return { type: "request", name, request, warnings };
}

export function adaptOpenApiDocument(doc: OpenApiDocument): NormalizedCollectionImport {
  const warnings: string[] = [];
  const folders = new Map<string, NormalizedFolder>();
  const untagged: NormalizedRequest[] = [];

  for (const [path, pathItemRaw] of Object.entries(doc.paths ?? {})) {
    const pathItem = pathItemRaw as Record<string, unknown>;
    const pathLevelParams = (pathItem.parameters as OpenApiOperation["parameters"]) ?? [];

    for (const methodKey of HTTP_METHOD_KEYS) {
      const rawOperation = pathItem[methodKey];
      if (!rawOperation) continue;

      const parsedOperation = operationSchema.safeParse(rawOperation);
      if (!parsedOperation.success) {
        warnings.push(`Operation "${methodKey.toUpperCase()} ${path}" has an unrecognized shape and was skipped.`);
        continue;
      }

      const normalizedRequest = adaptOperation(methodKey, path, parsedOperation.data, doc, pathLevelParams);
      const tag = parsedOperation.data.tags?.[0];
      if (tag) {
        const folder = folders.get(tag) ?? { type: "folder" as const, name: tag, items: [] };
        folder.items.push(normalizedRequest);
        folders.set(tag, folder);
      } else {
        untagged.push(normalizedRequest);
      }
    }
  }

  const items: NormalizedItem[] = [...folders.values(), ...untagged];
  const allRequestWarnings = items.flatMap((i) => (i.type === "request" ? i.warnings : i.items.flatMap((r) => r.warnings)));

  return {
    kind: "collection",
    name: doc.info.title || "Imported OpenAPI",
    items,
    warnings: [...warnings, ...allRequestWarnings],
    sourceFormat: "openapi",
  };
}
