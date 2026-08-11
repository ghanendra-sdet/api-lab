import type { PerfErrorKind } from "./types.ts";

/**
 * Classifies an HTTP status into an error kind, or `null` when the response
 * is a success. 1xx/2xx/3xx are treated as successful outcomes — a redirect
 * that `fetch` did not follow is not a load-generation failure.
 */
export function classifyStatus(status: number): PerfErrorKind | null {
  if (status >= 500) return "http5xx";
  if (status >= 400) return "http4xx";
  return null;
}

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"]);

function errorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const record = err as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string") return record.code;
  if (record.cause !== undefined && record.cause !== err) return errorCode(record.cause);
  return null;
}

function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string") {
    return (err as { name: string }).name;
  }
  return "";
}

/**
 * Classifies a thrown transport error (spec §20). Deterministic and
 * exhaustive: every thrown value maps to exactly one kind, defaulting to
 * "client" (a bug or unexpected condition inside the load generator) rather
 * than being silently folded into "network".
 *
 * `timedOut` is passed explicitly by the caller because an abort raised by
 * our own timeout controller and an abort raised by user cancellation are
 * indistinguishable from the error object alone — they are the same
 * `AbortError`, but they mean completely different things in a report.
 */
export function classifyTransportError(err: unknown, options: { timedOut: boolean; cancelled: boolean }): PerfErrorKind {
  if (options.timedOut) return "timeout";
  if (options.cancelled) return "cancelled";

  const name = errorName(err);
  if (name === "AbortError" || name === "TimeoutError") return "timeout";

  const code = errorCode(err);
  if (code !== null) {
    if (TIMEOUT_CODES.has(code)) return "timeout";
    if (CONNECTION_CODES.has(code)) return "connection";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ERR_INVALID_URL") return "network";
  }

  if (err instanceof TypeError) return "network";
  return "client";
}

/** Human-readable labels for the report and UI. */
export const ERROR_KIND_LABELS: Record<PerfErrorKind, string> = {
  http4xx: "HTTP 4xx",
  http5xx: "HTTP 5xx",
  timeout: "Timeouts",
  network: "Network errors",
  connection: "Connection failures",
  cancelled: "Cancelled",
  client: "Client errors",
};
