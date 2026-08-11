import { describe, expect, it } from "vitest";
import { LatencySamples, computeLatencyStats, percentile } from "./percentile.ts";

/**
 * Percentiles are validated against a hand-computed dataset, not against
 * another implementation — the point is to pin the *documented* algorithm
 * (nearest-rank), so an accidental switch to interpolation is caught.
 */
describe("percentile — nearest rank", () => {
  // 1..100, so the nearest-rank percentile p is exactly the value p.
  const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it("returns the exact rank value for a 1..100 dataset", () => {
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile(oneToHundred, 90)).toBe(90);
    expect(percentile(oneToHundred, 95)).toBe(95);
    expect(percentile(oneToHundred, 99)).toBe(99);
  });

  it("always returns an actually-observed value, never an interpolation", () => {
    // n=4: ranks are ceil(p/100*4). p50 -> rank 2 -> 20. An interpolating
    // implementation would return 25 here, which is a value never measured.
    const values = [10, 20, 30, 40];
    expect(percentile(values, 50)).toBe(20);
    expect(percentile(values, 75)).toBe(30);
    expect(percentile(values, 90)).toBe(40);
  });

  it("handles single-element and empty datasets", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 99)).toBe(7);
  });

  it("clamps out-of-range percentiles to the dataset bounds", () => {
    expect(percentile(oneToHundred, 0)).toBe(1);
    expect(percentile(oneToHundred, -5)).toBe(1);
    expect(percentile(oneToHundred, 100)).toBe(100);
    expect(percentile(oneToHundred, 150)).toBe(100);
  });

  it("is deterministic — the same input always yields the same output", () => {
    const first = percentile(oneToHundred, 95);
    for (let i = 0; i < 50; i += 1) expect(percentile(oneToHundred, 95)).toBe(first);
  });
});

describe("computeLatencyStats", () => {
  it("computes min/max/avg and percentiles from unsorted input", () => {
    const stats = computeLatencyStats([30, 10, 50, 20, 40]);
    expect(stats.count).toBe(5);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(50);
    expect(stats.avg).toBe(30);
    expect(stats.p50).toBe(30); // ceil(0.5*5)=3 -> sorted[2]
    expect(stats.p90).toBe(50); // ceil(0.9*5)=5 -> sorted[4]
  });

  it("does not mutate the caller's array", () => {
    const input = [3, 1, 2];
    computeLatencyStats(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("returns zeroed stats for an empty dataset rather than NaN", () => {
    const stats = computeLatencyStats([]);
    expect(stats).toEqual({ count: 0, min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 });
  });
});

describe("LatencySamples — bounded memory", () => {
  it("retains every sample and reports exact percentiles below capacity", () => {
    const samples = new LatencySamples(100);
    for (let i = 1; i <= 100; i += 1) samples.add(i);
    expect(samples.sampled).toBe(false);
    expect(samples.stats().p95).toBe(95);
    expect(samples.stats().count).toBe(100);
  });

  it("caps retained samples and flags the result as an estimate", () => {
    const samples = new LatencySamples(10, () => 0.99);
    for (let i = 1; i <= 1000; i += 1) samples.add(i);
    expect(samples.totalSeen).toBe(1000);
    expect(samples.sampled).toBe(true);
    // Memory is bounded regardless of how many samples arrived.
    expect(samples.stats().count).toBe(10);
  });

  it("replaces reservoir slots when the random draw falls inside capacity", () => {
    // randomFn 0 always selects index 0, so the newest value wins that slot.
    const samples = new LatencySamples(3, () => 0);
    samples.add(1);
    samples.add(2);
    samples.add(3);
    samples.add(999);
    const stats = samples.stats();
    expect(stats.count).toBe(3);
    expect(stats.max).toBe(999);
  });
});
