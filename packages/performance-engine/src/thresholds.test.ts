import { describe, expect, it } from "vitest";
import { evaluateThreshold, evaluateThresholds, metricValue, thresholdsPassed } from "./thresholds.ts";
import { MetricsAggregator } from "./aggregate.ts";
import { createThreshold } from "./factory.ts";
import type { PerfSnapshot } from "./types.ts";

function snapshotWith(latencies: number[], failures: number, elapsedMs = 1000): PerfSnapshot {
  const agg = new MetricsAggregator();
  latencies.forEach((durationMs, index) => {
    const failing = index < failures;
    agg.record({
      startOffsetMs: 0,
      durationMs,
      status: failing ? 500 : 200,
      bytes: 0,
      errorKind: failing ? "http5xx" : null,
    });
  });
  return agg.snapshot(elapsedMs, 1);
}

describe("metricValue", () => {
  it("reports errorRate as a percentage, not a fraction", () => {
    const snapshot = snapshotWith([10, 10, 10, 10], 1);
    expect(snapshot.errorRate).toBe(0.25);
    expect(metricValue("errorRate", snapshot)).toBe(25);
  });

  it("maps every latency metric to the matching statistic", () => {
    const snapshot = snapshotWith(Array.from({ length: 100 }, (_, i) => i + 1), 0);
    expect(metricValue("p50", snapshot)).toBe(50);
    expect(metricValue("p90", snapshot)).toBe(90);
    expect(metricValue("p95", snapshot)).toBe(95);
    expect(metricValue("p99", snapshot)).toBe(99);
    expect(metricValue("min", snapshot)).toBe(1);
    expect(metricValue("max", snapshot)).toBe(100);
    expect(metricValue("avg", snapshot)).toBeCloseTo(50.5, 5);
  });

  it("reads rps from the snapshot's completed-request rate", () => {
    const snapshot = snapshotWith(new Array(200).fill(5), 0, 2000);
    expect(metricValue("rps", snapshot)).toBe(100);
  });
});

describe("evaluateThreshold", () => {
  const snapshot = snapshotWith(Array.from({ length: 100 }, (_, i) => i + 1), 0);

  it("passes a generous P95 threshold", () => {
    const result = evaluateThreshold(createThreshold("p95", "lt", 5000), snapshot);
    expect(result.actual).toBe(95);
    expect(result.passed).toBe(true);
  });

  it("fails an impossible P95 threshold", () => {
    expect(evaluateThreshold(createThreshold("p95", "lt", 1), snapshot).passed).toBe(false);
  });

  it("applies each comparator exactly", () => {
    expect(evaluateThreshold(createThreshold("p95", "lt", 95), snapshot).passed).toBe(false);
    expect(evaluateThreshold(createThreshold("p95", "lte", 95), snapshot).passed).toBe(true);
    expect(evaluateThreshold(createThreshold("p95", "gt", 95), snapshot).passed).toBe(false);
    expect(evaluateThreshold(createThreshold("p95", "gte", 95), snapshot).passed).toBe(true);
  });

  it("is deterministic across repeated evaluation", () => {
    const threshold = createThreshold("p99", "lt", 99);
    const first = evaluateThreshold(threshold, snapshot);
    for (let i = 0; i < 20; i += 1) {
      expect(evaluateThreshold(threshold, snapshot)).toEqual(first);
    }
  });
});

describe("evaluateThresholds / thresholdsPassed", () => {
  const snapshot = snapshotWith([100, 200, 300, 400], 0);

  it("ignores disabled thresholds", () => {
    const disabled = { ...createThreshold("p95", "lt", 1), enabled: false };
    expect(evaluateThresholds([disabled], snapshot)).toHaveLength(0);
    expect(thresholdsPassed(evaluateThresholds([disabled], snapshot))).toBe(true);
  });

  it("passes only when every enabled threshold passes", () => {
    const good = createThreshold("p95", "lt", 10_000);
    const bad = createThreshold("errorRate", "lt", -1);
    expect(thresholdsPassed(evaluateThresholds([good], snapshot))).toBe(true);
    expect(thresholdsPassed(evaluateThresholds([good, bad], snapshot))).toBe(false);
  });

  it("passes a run with no thresholds configured", () => {
    expect(thresholdsPassed(evaluateThresholds([], snapshot))).toBe(true);
  });
});
