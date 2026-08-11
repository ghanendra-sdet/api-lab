import type { HttpMethod } from "@api-lab/shared";
import type { Extraction } from "@api-lab/runner-engine";

/**
 * Framework-independent performance-testing primitives: configuration,
 * safety limits, metric samples, aggregation output, thresholds, and the
 * Web ↔ worker wire protocol.
 *
 * This package must run unchanged in BOTH environments:
 *   - the browser (bundled by Vite into `apps/web`), and
 *   - a Node worker thread (`apps/performance-worker`, type-stripped by
 *     Node with no build step).
 *
 * That dual-target requirement is why there is no React, no DOM API, no
 * `node:` import, and no `enum` anywhere in this package, and why every
 * internal relative import carries an explicit `.ts` extension (Node's ESM
 * resolver never infers extensions — see docs/ARCHITECTURE.md's Milestone 9
 * and 10 sections).
 */

// ---------------------------------------------------------------------------
// Safety limits (spec §24, §25)
// ---------------------------------------------------------------------------

/**
 * These are browser/local execution safety limits, NOT production load
 * testing limits. API Lab generates load from a single local Node process;
 * it is not distributed load-generation infrastructure. The limits exist so
 * a mistyped "10000 users" can never turn the tool into an accidental
 * denial-of-service client or exhaust local memory. They can be raised when
 * a dedicated remote/distributed worker architecture exists — see
 * docs/ARCHITECTURE.md's Milestone 10 "Known limitations".
 */
export const MAX_VIRTUAL_USERS = 100;
export const MAX_DURATION_SECONDS = 600; // 10 minutes
export const MAX_RAMP_UP_SECONDS = 300;
export const MAX_TOTAL_REQUESTS = 200_000;
export const MAX_TARGET_RPS = 5_000;
export const MAX_REQUEST_TIMEOUT_MS = 120_000;
export const MAX_THINK_TIME_MS = 60_000;
/** Requests per virtual-user iteration (i.e. collection size for a run). */
export const MAX_REQUESTS_PER_ITERATION = 50;
/** Latency samples retained for exact percentile computation. Beyond this,
 * reservoir sampling keeps memory bounded — see `LatencySamples`. */
export const MAX_LATENCY_SAMPLES = 100_000;
/** One time-series point per second; 600 covers the maximum duration. */
export const MAX_TIME_SERIES_POINTS = 600;
/** Distinct status codes tracked. Bounded so a pathological server cannot
 * grow the distribution map without limit. */
export const MAX_STATUS_CODES_TRACKED = 64;

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Configuration (spec §7, §8, §42)
// ---------------------------------------------------------------------------

/**
 * Load models. Concurrency and rate are deliberately separate concepts and
 * are never relabelled as each other (spec §41):
 *   - "concurrency" (closed model): N virtual users each run the target in
 *     a loop as fast as the system under test allows. Concurrency is fixed;
 *     the resulting RPS is an *output*.
 *   - "rate" (open model): virtual users are paced by a shared scheduler
 *     that releases work at a target requests-per-second. RPS is the
 *     *input*; achieved RPS is still capped by the configured concurrency.
 */
export const PERF_LOAD_MODELS = ["concurrency", "rate"] as const;
export type PerfLoadModel = (typeof PERF_LOAD_MODELS)[number];

export const PERF_TARGET_KINDS = ["request", "collection"] as const;
export type PerfTargetKind = (typeof PERF_TARGET_KINDS)[number];

export const PERF_METRICS = ["p50", "p90", "p95", "p99", "avg", "min", "max", "errorRate", "rps"] as const;
export type PerfMetric = (typeof PERF_METRICS)[number];

export const PERF_COMPARATORS = ["lt", "lte", "gt", "gte"] as const;
export type PerfComparator = (typeof PERF_COMPARATORS)[number];

/**
 * A performance threshold targets an *aggregate* metric of the whole run —
 * deliberately a separate model from `@api-lab/test-engine`'s per-response
 * `Assertion` (spec §32). "P95 < 500ms" is not expressible as, and must not
 * be confused with, "this one response was under 500ms".
 */
export interface PerfThreshold {
  id: string;
  metric: PerfMetric;
  comparator: PerfComparator;
  value: number;
  enabled: boolean;
}

export interface PerfThresholdResult {
  threshold: PerfThreshold;
  actual: number;
  passed: boolean;
}

/**
 * The persisted performance-test configuration. Contains ids, numbers, and
 * threshold rules only — never a resolved URL, never a credential, never
 * execution state (spec §42). Resolution of `{{variables}}` and
 * authorization happens at execution time, in memory, and is discarded.
 */
export interface PerformanceTestConfig {
  targetKind: PerfTargetKind;
  /** Saved-request id, or collection id, depending on `targetKind`. */
  targetId: string | null;
  environmentId: string | null;
  virtualUsers: number;
  durationSeconds: number;
  rampUpSeconds: number;
  loadModel: PerfLoadModel;
  /** Only meaningful when `loadModel === "rate"`. */
  targetRps: number;
  requestTimeoutMs: number;
  /** Pause between a virtual user's iterations (spec §9). */
  thinkTimeMs: number;
  thresholds: PerfThreshold[];
}

export const PERFORMANCE_CONFIG_FORMAT_VERSION = 1;

export interface PersistedPerformanceConfig {
  version: number;
  config: PerformanceTestConfig;
}

// ---------------------------------------------------------------------------
// Samples and metrics (spec §16, §20)
// ---------------------------------------------------------------------------

/**
 * Error classification (spec §20). A single "failed" count is not useful —
 * 25 HTTP 500s, 3 refused connections, and 7 timeouts are three completely
 * different findings.
 */
export const PERF_ERROR_KINDS = [
  "http4xx",
  "http5xx",
  "timeout",
  "network",
  "connection",
  "cancelled",
  "client",
] as const;
export type PerfErrorKind = (typeof PERF_ERROR_KINDS)[number];

export type PerfErrorBreakdown = Record<PerfErrorKind, number>;

export function emptyErrorBreakdown(): PerfErrorBreakdown {
  return { http4xx: 0, http5xx: 0, timeout: 0, network: 0, connection: 0, cancelled: 0, client: 0 };
}

/**
 * One completed (or failed) request attempt. Deliberately carries NO
 * response body and no headers — performance runs measure, they do not
 * collect (spec §23). `bytes` is a byte count, not content.
 */
export interface PerfSample {
  /** Milliseconds since the run started, at the moment the request was issued. */
  startOffsetMs: number;
  /** completion − start, in milliseconds. See `docs/ARCHITECTURE.md` for the timing source. */
  durationMs: number;
  status: number | null;
  bytes: number;
  /** `null` means the attempt succeeded (a 2xx/3xx response was received). */
  errorKind: PerfErrorKind | null;
}

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export function emptyLatencyStats(): LatencyStats {
  return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
}

export interface PerfTimePoint {
  /** Whole seconds elapsed since the run started. */
  second: number;
  requests: number;
  errors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface PerfStatusCount {
  status: number;
  count: number;
}

/**
 * A complete aggregated view of the run so far. This is the only metric
 * payload that ever crosses the worker → UI channel (spec §26: never send
 * response bodies through the message channel).
 */
export interface PerfSnapshot {
  elapsedMs: number;
  activeUsers: number;
  /** Requests issued (attempted), including ones still in flight. */
  attempted: number;
  /** Requests that produced a result — a response OR a definite failure. */
  completed: number;
  /**
   * Requests that were still in flight when the run ended (deadline reached
   * or user cancellation) and were therefore aborted without an outcome.
   *
   * These are deliberately NOT counted as failures: a run that ends cleanly
   * at its configured duration always has a few requests mid-flight, and
   * counting them as errors would report a non-zero error rate for a
   * perfectly healthy system. They are reported separately, and included in
   * `errors.cancelled`, so nothing is hidden.
   */
  aborted: number;
  /** Completed requests with a non-error outcome (status < 400). */
  successful: number;
  failed: number;
  /** failed / completed, in [0, 1]. 0 when nothing has completed. */
  errorRate: number;
  /** Completed requests per elapsed second (spec §18). */
  rps: number;
  /** Successful requests per elapsed second — reported separately and
   * never presented as total throughput (spec §18). */
  successfulRps: number;
  /** Response bytes received per elapsed second. */
  throughputBytesPerSec: number;
  latency: LatencyStats;
  statusDistribution: PerfStatusCount[];
  errors: PerfErrorBreakdown;
  timeSeries: PerfTimePoint[];
  /** True once the latency sample buffer started reservoir-sampling, i.e.
   * percentiles became estimates rather than exact. Surfaced honestly in
   * the report rather than silently approximating (spec §17). */
  latencySampled: boolean;
  /** True if the run stopped because MAX_TOTAL_REQUESTS was reached. */
  requestLimitReached: boolean;
}

// ---------------------------------------------------------------------------
// Report (spec §33)
// ---------------------------------------------------------------------------

export const PERF_RUN_STATUSES = ["passed", "failed", "cancelled", "error"] as const;
export type PerfRunStatus = (typeof PERF_RUN_STATUSES)[number];

export interface PerformanceReport {
  runId: string;
  /** "cancelled" is never reported as "passed" (spec §27). */
  status: PerfRunStatus;
  targetName: string;
  targetKind: PerfTargetKind;
  environmentName: string | null;
  loadModel: PerfLoadModel;
  virtualUsers: number;
  configuredDurationSeconds: number;
  rampUpSeconds: number;
  startedAt: number;
  durationMs: number;
  snapshot: PerfSnapshot;
  thresholdResults: PerfThresholdResult[];
  /** Present when `status === "error"`. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Wire protocol (spec §26)
// ---------------------------------------------------------------------------

/**
 * One request in the load profile, as handed to the worker. Environment and
 * dataset variables are ALREADY resolved by the browser at execution time;
 * only runtime (chained) `{{variables}}` remain as literal placeholders,
 * because their values only exist per virtual user, inside the worker
 * (spec §12, §15).
 */
export interface PerfRequestSpec {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  extractions: Extraction[];
}

/** The START payload: everything the worker needs, and nothing it doesn't. */
export interface PerfRunRequest {
  runId: string;
  requests: PerfRequestSpec[];
  virtualUsers: number;
  durationSeconds: number;
  rampUpSeconds: number;
  loadModel: PerfLoadModel;
  targetRps: number;
  requestTimeoutMs: number;
  thinkTimeMs: number;
  maxTotalRequests: number;
}

/** Worker → control plane → browser. */
export type PerfOutboundMessage =
  | { type: "START"; runId: string; startedAt: number }
  /** Cheap, high-frequency liveness counters — no percentiles, no arrays. */
  | {
      type: "PROGRESS";
      runId: string;
      elapsedMs: number;
      activeUsers: number;
      attempted: number;
      completed: number;
      failed: number;
    }
  /** Periodic full aggregate batch. Never per-request (spec §22). */
  | { type: "METRICS"; runId: string; snapshot: PerfSnapshot }
  | { type: "ERROR"; runId: string; message: string }
  | { type: "COMPLETE"; runId: string; report: PerformanceReport };

/** Browser → control plane → worker. */
export type PerfInboundMessage = { type: "CANCEL"; runId: string };
