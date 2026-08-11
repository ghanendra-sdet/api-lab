import type { PerfMetric, PerfSnapshot, PerfThreshold, PerfThresholdResult } from "./types.ts";

/**
 * Resolves the actual observed value for a threshold's metric. Latency
 * metrics are milliseconds; `errorRate` is a **percentage** (0–100) because
 * that is how it is written in a threshold ("Error rate < 1%"), while the
 * snapshot stores it as a 0–1 fraction. Converting here — in one place —
 * keeps the UI, the report, and the evaluator from disagreeing about units.
 */
export function metricValue(metric: PerfMetric, snapshot: PerfSnapshot): number {
  switch (metric) {
    case "p50":
      return snapshot.latency.p50;
    case "p90":
      return snapshot.latency.p90;
    case "p95":
      return snapshot.latency.p95;
    case "p99":
      return snapshot.latency.p99;
    case "avg":
      return snapshot.latency.avg;
    case "min":
      return snapshot.latency.min;
    case "max":
      return snapshot.latency.max;
    case "errorRate":
      return snapshot.errorRate * 100;
    case "rps":
      return snapshot.rps;
  }
}

export const METRIC_LABELS: Record<PerfMetric, string> = {
  p50: "P50 latency",
  p90: "P90 latency",
  p95: "P95 latency",
  p99: "P99 latency",
  avg: "Average latency",
  min: "Min latency",
  max: "Max latency",
  errorRate: "Error rate",
  rps: "Requests/sec",
};

export const METRIC_UNITS: Record<PerfMetric, string> = {
  p50: "ms",
  p90: "ms",
  p95: "ms",
  p99: "ms",
  avg: "ms",
  min: "ms",
  max: "ms",
  errorRate: "%",
  rps: "req/s",
};

export const COMPARATOR_LABELS = { lt: "<", lte: "≤", gt: ">", gte: "≥" } as const;

/**
 * Deterministic threshold evaluation (spec §31/§32): pure comparison of an
 * aggregate metric against a fixed number. No tolerance, no fuzz, no clock.
 */
export function evaluateThreshold(threshold: PerfThreshold, snapshot: PerfSnapshot): PerfThresholdResult {
  const actual = metricValue(threshold.metric, snapshot);
  let passed: boolean;
  switch (threshold.comparator) {
    case "lt":
      passed = actual < threshold.value;
      break;
    case "lte":
      passed = actual <= threshold.value;
      break;
    case "gt":
      passed = actual > threshold.value;
      break;
    case "gte":
      passed = actual >= threshold.value;
      break;
  }
  return { threshold, actual, passed };
}

export function evaluateThresholds(thresholds: PerfThreshold[], snapshot: PerfSnapshot): PerfThresholdResult[] {
  return thresholds.filter((t) => t.enabled).map((t) => evaluateThreshold(t, snapshot));
}

/**
 * A run PASSES only when every enabled threshold passes. A run with no
 * thresholds configured passes — there was nothing to violate. Cancellation
 * and worker failure are decided by the caller and never reach here, so a
 * cancelled run can never be reported as passed (spec §27).
 */
export function thresholdsPassed(results: PerfThresholdResult[]): boolean {
  return results.every((r) => r.passed);
}
