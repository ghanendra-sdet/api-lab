import type { ApiResponseResult, BuiltRequest, RequestExecutor, RequestExecutorOptions } from "../types";
import { normalizeResponse, errorResponse } from "../normalizeResponse";

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

function friendlyErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "Request was cancelled.";
  }
  if (err instanceof TypeError) {
    // fetch() rejects with a generic TypeError for network failures, DNS
    // failures, connection refusal, and CORS rejections alike — the browser
    // does not expose which one occurred, by design (see docs/SECURITY.md /
    // docs/ARCHITECTURE.md known limitations).
    return "Unable to complete the request. Check the URL, network connection, and browser access policy (CORS).";
  }
  return "Request failed for an unknown reason.";
}

/**
 * The only RequestExecutor implementation in Milestone 2. Sends real HTTP
 * requests via the browser's native fetch. MockExecutor, PerformanceExecutor,
 * and ServerExecutor implement the same interface in later milestones.
 */
export class BrowserFetchExecutor implements RequestExecutor {
  async execute(
    request: BuiltRequest,
    options: RequestExecutorOptions = {},
  ): Promise<ApiResponseResult> {
    const start = performance.now();
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: METHODS_WITHOUT_BODY.has(request.method) ? undefined : request.body,
        signal: options.signal,
      });
      const duration = performance.now() - start;
      return await normalizeResponse(response, duration);
    } catch (err) {
      const duration = performance.now() - start;
      return errorResponse(friendlyErrorMessage(err), duration);
    }
  }
}
