import { describe, expect, it } from "vitest";
import { MetricsAggregator } from "./aggregate.ts";
import { MAX_STATUS_CODES_TRACKED, type PerfSample } from "./types.ts";

function sample(overrides: Partial<PerfSample> = {}): PerfSample {
  return { startOffsetMs: 0, durationMs: 100, status: 200, bytes: 10, errorKind: null, ...overrides };
}

describe("MetricsAggregator — counts and rates", () => {
  it("separates attempted, completed, successful and failed", () => {
    const agg = new MetricsAggregator();
    agg.recordAttempt();
    agg.recordAttempt();
    agg.recordAttempt();
    agg.record(sample());
    agg.record(sample({ status: 500, errorKind: "http5xx" }));
    // Third attempt is still in flight and deliberately not completed.

    const snap = agg.snapshot(1000, 3);
    expect(snap.attempted).toBe(3);
    expect(snap.completed).toBe(2);
    expect(snap.successful).toBe(1);
    expect(snap.failed).toBe(1);
    expect(snap.errorRate).toBe(0.5);
  });

  it("computes RPS from completed requests over elapsed seconds", () => {
    const agg = new MetricsAggregator();
    for (let i = 0; i < 20; i += 1) agg.record(sample());
    const snap = agg.snapshot(2000, 5);
    expect(snap.rps).toBe(10); // 20 completed / 2s
    expect(snap.successfulRps).toBe(10);
  });

  it("reports successful RPS separately from total RPS", () => {
    const agg = new MetricsAggregator();
    for (let i = 0; i < 6; i += 1) agg.record(sample());
    for (let i = 0; i < 4; i += 1) agg.record(sample({ status: 500, errorKind: "http5xx" }));
    const snap = agg.snapshot(1000, 1);
    expect(snap.rps).toBe(10);
    expect(snap.successfulRps).toBe(6);
  });

  it("computes byte throughput per elapsed second", () => {
    const agg = new MetricsAggregator();
    agg.record(sample({ bytes: 500 }));
    agg.record(sample({ bytes: 500 }));
    expect(agg.snapshot(2000, 1).throughputBytesPerSec).toBe(500);
  });

  it("returns zeroed rates before any time has elapsed instead of Infinity", () => {
    const agg = new MetricsAggregator();
    agg.record(sample());
    const snap = agg.snapshot(0, 1);
    expect(snap.rps).toBe(0);
    expect(snap.throughputBytesPerSec).toBe(0);
    expect(Number.isFinite(snap.rps)).toBe(true);
  });

  it("reports a zero error rate when nothing has completed", () => {
    expect(new MetricsAggregator().snapshot(1000, 0).errorRate).toBe(0);
  });
});

describe("MetricsAggregator — aborted attempts", () => {
  it("does not count a run-teardown abort as a failure", () => {
    const agg = new MetricsAggregator();
    for (let i = 0; i < 10; i += 1) {
      agg.recordAttempt();
      agg.record(sample());
    }
    agg.recordAttempt();
    agg.recordAborted();

    const snap = agg.snapshot(1000, 0);
    expect(snap.attempted).toBe(11);
    expect(snap.completed).toBe(10);
    expect(snap.aborted).toBe(1);
    expect(snap.failed).toBe(0);
    // A healthy run that ends at its deadline with a request in flight must
    // still report a 0% error rate.
    expect(snap.errorRate).toBe(0);
    expect(snap.errors.cancelled).toBe(1);
  });

  it("contributes no latency sample, status code or time-series entry", () => {
    const agg = new MetricsAggregator();
    agg.record(sample({ durationMs: 100, status: 200 }));
    agg.recordAborted();
    const snap = agg.snapshot(1000, 0);
    expect(snap.latency.count).toBe(1);
    expect(snap.statusDistribution).toEqual([{ status: 200, count: 1 }]);
    expect(snap.timeSeries[0]!.requests).toBe(1);
  });
});

describe("MetricsAggregator — latency", () => {
  it("computes percentiles across all recorded samples", () => {
    const agg = new MetricsAggregator();
    for (let i = 1; i <= 100; i += 1) agg.record(sample({ durationMs: i }));
    const { latency } = agg.snapshot(1000, 1);
    expect(latency.min).toBe(1);
    expect(latency.max).toBe(100);
    expect(latency.p50).toBe(50);
    expect(latency.p95).toBe(95);
    expect(latency.p99).toBe(99);
    expect(latency.avg).toBeCloseTo(50.5, 5);
  });

  it("flags latencySampled once the retention cap is exceeded", () => {
    const agg = new MetricsAggregator({ maxLatencySamples: 5, randomFn: () => 0.99 });
    for (let i = 0; i < 50; i += 1) agg.record(sample());
    expect(agg.snapshot(1000, 1).latencySampled).toBe(true);
  });
});

describe("MetricsAggregator — status distribution and errors", () => {
  it("aggregates a status distribution sorted by status code", () => {
    const agg = new MetricsAggregator();
    for (let i = 0; i < 9820; i += 1) agg.record(sample({ status: 200 }));
    for (let i = 0; i < 100; i += 1) agg.record(sample({ status: 201 }));
    for (let i = 0; i < 20; i += 1) agg.record(sample({ status: 400, errorKind: "http4xx" }));
    for (let i = 0; i < 50; i += 1) agg.record(sample({ status: 500, errorKind: "http5xx" }));

    expect(agg.snapshot(1000, 1).statusDistribution).toEqual([
      { status: 200, count: 9820 },
      { status: 201, count: 100 },
      { status: 400, count: 20 },
      { status: 500, count: 50 },
    ]);
  });

  it("bounds the number of distinct status codes tracked", () => {
    const agg = new MetricsAggregator();
    for (let i = 0; i < MAX_STATUS_CODES_TRACKED + 25; i += 1) agg.record(sample({ status: 200 + i }));
    expect(agg.snapshot(1000, 1).statusDistribution.length).toBe(MAX_STATUS_CODES_TRACKED);
    expect(agg.statusCodeOverflow).toBe(true);
  });

  it("classifies failures into distinct error kinds rather than one total", () => {
    const agg = new MetricsAggregator();
    for (let i = 0; i < 25; i += 1) agg.record(sample({ status: 500, errorKind: "http5xx" }));
    for (let i = 0; i < 3; i += 1) agg.record(sample({ status: null, errorKind: "network" }));
    for (let i = 0; i < 7; i += 1) agg.record(sample({ status: null, errorKind: "timeout" }));

    const { errors } = agg.snapshot(1000, 1);
    expect(errors.http5xx).toBe(25);
    expect(errors.network).toBe(3);
    expect(errors.timeout).toBe(7);
    expect(errors.http4xx).toBe(0);
    expect(errors.cancelled).toBe(0);
  });

  it("does not record a status code for transport failures", () => {
    const agg = new MetricsAggregator();
    agg.record(sample({ status: null, errorKind: "connection" }));
    expect(agg.snapshot(1000, 1).statusDistribution).toEqual([]);
  });
});

describe("MetricsAggregator — time series", () => {
  it("buckets samples into whole seconds by request start time", () => {
    const agg = new MetricsAggregator();
    agg.record(sample({ startOffsetMs: 0, durationMs: 10 }));
    agg.record(sample({ startOffsetMs: 500, durationMs: 30 }));
    agg.record(sample({ startOffsetMs: 1200, durationMs: 100, status: 500, errorKind: "http5xx" }));
    agg.record(sample({ startOffsetMs: 2900, durationMs: 60 }));

    const series = agg.snapshot(3000, 1).timeSeries;
    expect(series.map((p) => p.second)).toEqual([0, 1, 2]);
    expect(series[0]!.requests).toBe(2);
    expect(series[0]!.avgLatencyMs).toBe(20);
    expect(series[0]!.errors).toBe(0);
    expect(series[1]!.requests).toBe(1);
    expect(series[1]!.errors).toBe(1);
    expect(series[2]!.p95LatencyMs).toBe(60);
  });

  it("keeps buckets ordered by second even when samples arrive out of order", () => {
    const agg = new MetricsAggregator();
    agg.record(sample({ startOffsetMs: 5000 }));
    agg.record(sample({ startOffsetMs: 1000 }));
    agg.record(sample({ startOffsetMs: 3000 }));
    expect(agg.snapshot(6000, 1).timeSeries.map((p) => p.second)).toEqual([1, 3, 5]);
  });

  it("never retains a response body — a sample carries only numbers", () => {
    const agg = new MetricsAggregator();
    agg.record(sample({ bytes: 1_000_000 }));
    const serialized = JSON.stringify(agg.snapshot(1000, 1));
    expect(serialized).not.toContain("body");
    expect(serialized.length).toBeLessThan(2000);
  });
});
