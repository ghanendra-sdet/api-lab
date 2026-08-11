import type { PerfOutboundMessage, PerfRequestSpec, PerfThreshold, PerformanceReport } from "@api-lab/performance-engine";

/**
 * A thin client for the performance worker's HTTP API.
 *
 * The browser never generates load itself (see docs/ARCHITECTURE.md's
 * Milestone 10 section): it resolves the request configuration, hands a load
 * profile to `apps/performance-worker`, and then only *observes* — receiving
 * pre-aggregated metric batches over Server-Sent Events. No response body,
 * header set, or per-request record ever crosses this boundary.
 */

export interface PerfWorkerStatus {
  running: boolean;
  activeRuns: number;
  maxConcurrentRuns: number;
  uptimeMs: number;
  limits: {
    maxVirtualUsers: number;
    maxDurationSeconds: number;
    maxTotalRequests: number;
    maxRequestsPerIteration: number;
    maxTargetRps: number;
  };
}

export interface StartRunPayload {
  runId: string;
  requests: PerfRequestSpec[];
  virtualUsers: number;
  durationSeconds: number;
  rampUpSeconds: number;
  loadModel: "concurrency" | "rate";
  targetRps: number;
  requestTimeoutMs: number;
  thinkTimeMs: number;
  meta: {
    targetName: string;
    targetKind: "request" | "collection";
    environmentName: string | null;
    loadModel: "concurrency" | "rate";
    thresholds: PerfThreshold[];
  };
}

export class PerfWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerfWorkerError";
  }
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new PerfWorkerError(
      `Could not reach the performance worker at ${baseUrl}. Start it with \`npm run dev:performance-worker\`.`,
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new PerfWorkerError(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function getPerfStatus(baseUrl: string): Promise<PerfWorkerStatus> {
  return request(baseUrl, "/__perf/status");
}

export function startRun(baseUrl: string, payload: StartRunPayload): Promise<{ runId: string }> {
  return request(baseUrl, "/__perf/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function cancelRun(baseUrl: string, runId: string): Promise<{ cancelled: boolean }> {
  return request(baseUrl, `/__perf/runs/${runId}/cancel`, { method: "POST" });
}

export function getRun(baseUrl: string, runId: string): Promise<{ state: string; report: PerformanceReport | null }> {
  return request(baseUrl, `/__perf/runs/${runId}`);
}

export interface StreamHandlers {
  onMessage: (message: PerfOutboundMessage) => void;
  /** Called when the stream drops without a COMPLETE — i.e. the worker
   * process went away. The UI must surface this rather than spin forever. */
  onDisconnect: () => void;
}

/**
 * Subscribes to a run's live metric stream.
 *
 * `EventSource` is used rather than a hand-rolled fetch/ReadableStream
 * reader because it handles SSE framing and gives a real `error` event when
 * the connection drops — which is precisely the signal needed to detect a
 * dead worker (spec §28). Its one limitation (no custom headers) does not
 * matter here: the endpoint is unauthenticated localhost tooling.
 *
 * Returns a disposer. Calling it is always safe, including after COMPLETE.
 */
export function streamRun(baseUrl: string, runId: string, handlers: StreamHandlers): () => void {
  const source = new EventSource(`${baseUrl}/__perf/runs/${runId}/stream`);
  let finished = false;

  source.onmessage = (event: MessageEvent<string>) => {
    let message: PerfOutboundMessage;
    try {
      message = JSON.parse(event.data) as PerfOutboundMessage;
    } catch {
      // A malformed frame is dropped rather than allowed to kill the run's
      // UI — the next batch supersedes it a second later anyway.
      return;
    }
    if (message.type === "COMPLETE") {
      finished = true;
      handlers.onMessage(message);
      source.close();
      return;
    }
    handlers.onMessage(message);
  };

  source.onerror = () => {
    // The server closes the stream itself after COMPLETE, which surfaces as
    // an error event; that is a normal end-of-run, not a worker failure.
    source.close();
    if (!finished) handlers.onDisconnect();
  };

  return () => {
    finished = true;
    source.close();
  };
}
