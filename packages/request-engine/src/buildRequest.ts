import { buildUrl } from "./buildUrl";
import { buildHeaders, hasHeader } from "./buildHeaders";
import { buildBody } from "./buildBody";
import type { ApiRequestConfig, BuiltRequest } from "./types";

/**
 * Combines the URL, header, and body builders into the final request the
 * executor sends. Only adds a Content-Type header when the user hasn't
 * already set one — user-provided headers are never overridden.
 */
export function buildRequest(config: ApiRequestConfig): BuiltRequest {
  const url = buildUrl(config.url, config.queryParams);
  const headers = buildHeaders(config.headers);
  const { body, contentType } = buildBody(config.bodyMode, config.bodyRawFormat, config.bodyRawContent);

  if (contentType && !hasHeader(headers, "Content-Type")) {
    headers["Content-Type"] = contentType;
  }

  return { url, method: config.method, headers, body };
}
