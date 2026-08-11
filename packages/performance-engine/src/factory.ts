import { DEFAULT_REQUEST_TIMEOUT_MS, type PerfMetric, type PerfThreshold, type PerformanceTestConfig } from "./types.ts";

let counter = 0;

/** Ids are only ever used to key React lists and correlate threshold rows —
 * never as a security token, so a monotonic local counter is sufficient and
 * keeps this package free of any crypto/Node dependency. */
export function createThresholdId(): string {
  counter += 1;
  return `thr-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function createRunId(): string {
  counter += 1;
  return `run-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function createThreshold(metric: PerfMetric, comparator: PerfThreshold["comparator"], value: number): PerfThreshold {
  return { id: createThresholdId(), metric, comparator, value, enabled: true };
}

/**
 * The default configuration: a small, safe, local-first load profile. Ten
 * virtual users for thirty seconds with a five-second ramp is a
 * functional-performance check, not a stress test — matching the spec's
 * example form and API Lab's positioning (see docs/ARCHITECTURE.md).
 */
export function createDefaultPerformanceConfig(): PerformanceTestConfig {
  return {
    targetKind: "request",
    targetId: null,
    environmentId: null,
    virtualUsers: 10,
    durationSeconds: 30,
    rampUpSeconds: 5,
    loadModel: "concurrency",
    targetRps: 50,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    thinkTimeMs: 0,
    thresholds: [createThreshold("p95", "lt", 500), createThreshold("errorRate", "lt", 1)],
  };
}
