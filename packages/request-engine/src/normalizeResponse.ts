import type { ApiResponseResult } from "./types";

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function classifyBodyKind(contentType: string | null, text: string): ApiResponseResult["bodyKind"] {
  if (text.trim() === "") return "empty";
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("json")) return "json";
  if (type.includes("html")) return "html";
  return "text";
}

/**
 * Converts a raw fetch Response into the normalized model the UI consumes.
 * Response content is always treated as untrusted data: HTML responses are
 * classified as "html" only so the UI can label them — they are never
 * parsed as DOM or injected via dangerouslySetInnerHTML anywhere.
 */
export async function normalizeResponse(
  response: Response,
  duration: number,
): Promise<ApiResponseResult> {
  const headers = headersToRecord(response.headers);
  const rawBody = await response.text();
  const contentType = response.headers.get("content-type");
  const bodyKind = classifyBodyKind(contentType, rawBody);

  let body: unknown = rawBody;
  if (bodyKind === "json") {
    try {
      body = JSON.parse(rawBody);
    } catch {
      // Content-Type claimed JSON but the body doesn't parse — fall back to
      // showing it as text rather than failing the whole response.
      body = rawBody;
    }
  }

  const contentLengthHeader = response.headers.get("content-length");
  const size = contentLengthHeader
    ? Number(contentLengthHeader)
    : rawBody.length > 0
      ? new TextEncoder().encode(rawBody).length
      : 0;
  const sizeSource: ApiResponseResult["sizeSource"] = contentLengthHeader
    ? "content-length-header"
    : rawBody.length > 0
      ? "decoded-body-bytes"
      : "unknown";

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers,
    body: bodyKind === "empty" ? null : body,
    rawBody,
    bodyKind,
    duration,
    size,
    sizeSource,
    error: null,
  };
}

export function errorResponse(message: string, duration: number): ApiResponseResult {
  return {
    status: null,
    statusText: "",
    ok: false,
    headers: {},
    body: null,
    rawBody: "",
    bodyKind: "empty",
    duration,
    size: null,
    sizeSource: "unknown",
    error: message,
  };
}
