import { MAX_LATENCY_SAMPLES, emptyLatencyStats, type LatencyStats } from "./types.ts";

/**
 * Percentile algorithm: **nearest-rank on the ascending-sorted sample set**
 * (spec §17). For a sorted array of n values and percentile p (0 < p ≤ 100):
 *
 *     rank  = ceil(p / 100 × n)          // 1-based
 *     value = sorted[clamp(rank, 1, n) − 1]
 *
 * This is the classic, unambiguous definition: it always returns an actual
 * observed measurement rather than an interpolated value that was never
 * recorded, and it is fully deterministic — the same sample set always
 * yields the same percentile, with no floating-point interpolation and no
 * bucketing error.
 *
 * The alternative — a fixed-width or exponential latency histogram (HDR
 * style) — was deliberately not used: it trades exactness for constant
 * memory, and at API Lab's bounded scale (≤ 200,000 requests, ≤ 100,000
 * retained samples) exact sorting is affordable and honest. When the sample
 * cap IS exceeded, `LatencySamples` switches to reservoir sampling and the
 * report says so explicitly (`snapshot.latencySampled`) rather than quietly
 * presenting an estimate as exact.
 */
export function percentile(sortedAscending: readonly number[], p: number): number {
  const n = sortedAscending.length;
  if (n === 0) return 0;
  if (p <= 0) return sortedAscending[0]!;
  if (p >= 100) return sortedAscending[n - 1]!;
  const rank = Math.ceil((p / 100) * n);
  const index = Math.min(Math.max(rank, 1), n) - 1;
  return sortedAscending[index]!;
}

/** Computes min/max/avg and the P50/P90/P95/P99 set from an unsorted list.
 * Does not mutate the input. */
export function computeLatencyStats(values: readonly number[]): LatencyStats {
  if (values.length === 0) return emptyLatencyStats();
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: sum / sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

/**
 * A bounded latency sample buffer (spec §24 — memory protection).
 *
 * Up to `capacity` samples are retained in full, so percentiles are exact.
 * Past that point it switches to **Algorithm R reservoir sampling**, which
 * keeps a uniformly-random, fixed-size sample of the whole population: the
 * k-th sample (k > capacity) replaces a uniformly-chosen existing slot with
 * probability capacity/k. Memory stays constant no matter how long the run
 * is, and percentiles remain statistically representative — but they become
 * estimates, which `sampled` reports honestly.
 *
 * `randomFn` is injectable purely so tests can make the sampling branch
 * deterministic; production always uses `Math.random`.
 */
export class LatencySamples {
  private readonly capacity: number;
  private readonly values: number[] = [];
  private seen = 0;
  private readonly randomFn: () => number;

  constructor(capacity: number = MAX_LATENCY_SAMPLES, randomFn: () => number = Math.random) {
    this.capacity = Math.max(1, capacity);
    this.randomFn = randomFn;
  }

  add(value: number): void {
    this.seen += 1;
    if (this.values.length < this.capacity) {
      this.values.push(value);
      return;
    }
    const index = Math.floor(this.randomFn() * this.seen);
    if (index < this.capacity) this.values[index] = value;
  }

  /** True once samples were dropped, i.e. percentiles are estimates. */
  get sampled(): boolean {
    return this.seen > this.capacity;
  }

  get totalSeen(): number {
    return this.seen;
  }

  stats(): LatencyStats {
    return computeLatencyStats(this.values);
  }
}
