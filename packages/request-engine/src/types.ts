import type { AuthType, BodyMode, BodyRawFormat, HttpMethod, KeyValueRow } from "@api-lab/shared";

/**
 * The request domain model. Deliberately does not yet include collection/
 * environment/auth-execution fields beyond what Milestone 2 needs — those
 * arrive with their own milestones (Milestone 3+, 5).
 */
export interface ApiRequestConfig {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  queryParams: KeyValueRow[];
  headers: KeyValueRow[];
  authType: AuthType;
  bodyMode: BodyMode;
  bodyRawFormat: BodyRawFormat;
  bodyRawContent: string;
}

export interface BuiltRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface ValidationError {
  field: "url" | "body";
  message: string;
}

export interface ApiResponseResult {
  status: number | null;
  statusText: string;
  ok: boolean;
  headers: Record<string, string>;
  /** Body parsed for display: a JSON value when the response is JSON, otherwise the raw text. */
  body: unknown;
  /** The unparsed response text, always available for the Raw view. */
  rawBody: string;
  /** Best-effort content-type family, used to pick a rendering strategy. */
  bodyKind: "json" | "text" | "html" | "empty";
  /** Wall-clock request duration in milliseconds. */
  duration: number;
  /** Best-effort size in bytes. See ApiResponseResult.sizeSource. */
  size: number | null;
  /**
   * Where `size` came from — the browser cannot reliably report exact
   * wire-level size (compression, chunked transfer), so this states the
   * measurement's real precision instead of implying exactness.
   */
  sizeSource: "content-length-header" | "decoded-body-bytes" | "unknown";
  error: string | null;
}

export interface RequestExecutorOptions {
  signal?: AbortSignal;
}

/**
 * Transport abstraction. BrowserFetchExecutor is the only implementation in
 * Milestone 2 — MockExecutor, PerformanceExecutor, and ServerExecutor plug
 * into the same interface in later milestones without changing call sites.
 */
export interface RequestExecutor {
  execute(request: BuiltRequest, options?: RequestExecutorOptions): Promise<ApiResponseResult>;
}
