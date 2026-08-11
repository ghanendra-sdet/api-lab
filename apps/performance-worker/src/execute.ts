import { extractAll } from "@api-lab/runner-engine";
import { classifyStatus, classifyTransportError, type PerfRequestSpec, type PerfSample } from "@api-lab/performance-engine";
import type { ApiResponseResult } from "@api-lab/request-engine";

export interface ExecuteOptions {
  timeoutMs: number;
  /** Aborted when the whole run is cancelled. */
  runSignal: AbortSignal;
  /** Milliseconds since the run started, recorded on the resulting sample. */
  startOffsetMs: number;
}

export interface ExecuteOutcome {
  sample: PerfSample;
  /** Runtime variables extracted from this response, for this virtual user
   * only. Empty unless the request actually declares extractions. */
  extracted: Record<string, string>;
}

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

/**
 * Executes exactly one request and reduces it to a `PerfSample` — a handful
 * of numbers.
 *
 * ## Timing source (spec §19)
 *
 * `performance.now()` is read immediately before `fetch()` is called and
 * again after the response body has been fully drained; the difference is
 * the recorded latency. This is a monotonic high-resolution clock inside the
 * load-generating worker thread, so it is unaffected by wall-clock
 * adjustments, and it contains no UI, rendering, or state-management time —
 * the browser is not involved in generating or measuring this request at
 * all.
 *
 * Latency therefore covers: connection acquisition (including TLS and DNS
 * on a cold connection), request write, server processing, and full response
 * body download. It excludes only the aggregation arithmetic that happens
 * after the measurement is taken.
 *
 * ## Body handling (spec §23)
 *
 * The response body is always drained — a load test that leaves bodies
 * unread measures the wrong thing and leaks sockets — but it is only
 * *parsed* when the request declares extractions, and it is never retained
 * beyond this function. What leaves here is a byte count, not content.
 */
export async function executeOnce(spec: PerfRequestSpec, options: ExecuteOptions): Promise<ExecuteOutcome> {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  const onRunAbort = () => controller.abort();
  if (options.runSignal.aborted) controller.abort();
  else options.runSignal.addEventListener("abort", onRunAbort, { once: true });

  const start = performance.now();
  try {
    const response = await fetch(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: METHODS_WITHOUT_BODY.has(spec.method) ? undefined : (spec.body ?? undefined),
      signal: controller.signal,
      // Redirects are followed so a 3xx-fronted endpoint measures the real
      // user-visible latency rather than the redirect hop alone.
      redirect: "follow",
    });

    const text = await response.text();
    const durationMs = performance.now() - start;
    const bytes = Buffer.byteLength(text, "utf8");

    const extracted = spec.extractions.some((e) => e.enabled)
      ? extractAll(spec.extractions, toResponseResult(response, text, durationMs, bytes)).variables
      : {};

    return {
      sample: {
        startOffsetMs: options.startOffsetMs,
        durationMs,
        status: response.status,
        bytes,
        errorKind: classifyStatus(response.status),
      },
      extracted,
    };
  } catch (err) {
    const durationMs = performance.now() - start;
    return {
      sample: {
        startOffsetMs: options.startOffsetMs,
        durationMs,
        status: null,
        bytes: 0,
        errorKind: classifyTransportError(err, {
          timedOut,
          cancelled: !timedOut && options.runSignal.aborted,
        }),
      },
      extracted: {},
    };
  } finally {
    clearTimeout(timer);
    options.runSignal.removeEventListener("abort", onRunAbort);
  }
}

/**
 * Adapts a raw `Response` + already-read text into the shape
 * `@api-lab/runner-engine`'s extractor expects. Built only when extraction
 * is actually needed, and discarded immediately afterwards — reusing the
 * existing extractor (rather than writing a second JSON-path implementation
 * for performance runs) is what guarantees a chained `{{token}}` resolves
 * identically in a performance test and in the Collection Runner.
 */
function toResponseResult(response: Response, text: string, durationMs: number, bytes: number): ApiResponseResult {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const isJson = contentType.includes("json") && text.trim() !== "";
  let body: unknown = text;
  if (isJson) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers,
    body: text.trim() === "" ? null : body,
    rawBody: text,
    bodyKind: text.trim() === "" ? "empty" : isJson ? "json" : "text",
    duration: durationMs,
    size: bytes,
    sizeSource: "decoded-body-bytes",
    error: null,
  };
}
