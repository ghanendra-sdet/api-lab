import { LatencySamples, computeLatencyStats, percentile } from "./percentile.ts";
import {
  MAX_LATENCY_SAMPLES,
  MAX_STATUS_CODES_TRACKED,
  MAX_TIME_SERIES_POINTS,
  emptyErrorBreakdown,
  type PerfErrorBreakdown,
  type PerfSample,
  type PerfSnapshot,
  type PerfStatusCount,
  type PerfTimePoint,
} from "./types.ts";

/** Per-second latency samples are themselves bounded — a 5,000 RPS second
 * must not retain 5,000 numbers per bucket for the whole run. */
const MAX_SAMPLES_PER_BUCKET = 2_000;

interface Bucket {
  requests: number;
  errors: number;
  latencySum: number;
  latencies: number[];
}

/**
 * Streaming metrics aggregation (spec §16, §23). Records one number-only
 * `PerfSample` per request attempt and never retains a response body,
 * header set, or URL — memory is bounded by construction, not by policy.
 *
 * Everything here is pure arithmetic over primitives, so the exact same
 * aggregator runs inside the Node worker thread (authoritative) and inside
 * unit tests, with no I/O and no clock of its own: elapsed time is always
 * passed in by the caller, which keeps snapshots deterministic and testable.
 */
export class MetricsAggregator {
  private attempted = 0;
  private completed = 0;
  private successful = 0;
  private failed = 0;
  private aborted = 0;
  private bytes = 0;
  private latencySum = 0;
  private readonly latency: LatencySamples;
  private readonly statuses = new Map<number, number>();
  private readonly errors: PerfErrorBreakdown = emptyErrorBreakdown();
  private readonly buckets = new Map<number, Bucket>();
  private statusOverflow = false;
  requestLimitReached = false;

  constructor(options: { maxLatencySamples?: number; randomFn?: () => number } = {}) {
    this.latency = new LatencySamples(options.maxLatencySamples ?? MAX_LATENCY_SAMPLES, options.randomFn);
  }

  /** Counts a request as issued. Called before the request is awaited, so
   * `attempted − completed` is exactly the number of in-flight requests. */
  recordAttempt(): void {
    this.attempted += 1;
  }

  get attemptedCount(): number {
    return this.attempted;
  }

  /** Cheap counters for the high-frequency PROGRESS message, which must not
   * pay for sorting the latency sample set the way `snapshot()` does. */
  get completedCount(): number {
    return this.completed;
  }

  get failedCount(): number {
    return this.failed;
  }

  /**
   * Records an attempt that was cut short by the run ending rather than by
   * the system under test. It contributes no latency sample, no status code,
   * and no time-series entry — including a truncated duration would drag the
   * measured percentiles downward and misrepresent the endpoint.
   */
  recordAborted(): void {
    this.aborted += 1;
    this.errors.cancelled += 1;
  }

  record(sample: PerfSample): void {
    this.completed += 1;
    this.bytes += sample.bytes;
    this.latencySum += sample.durationMs;
    this.latency.add(sample.durationMs);

    if (sample.errorKind === null) {
      this.successful += 1;
    } else {
      this.failed += 1;
      this.errors[sample.errorKind] += 1;
    }

    if (sample.status !== null) {
      const existing = this.statuses.get(sample.status);
      if (existing !== undefined) {
        this.statuses.set(sample.status, existing + 1);
      } else if (this.statuses.size < MAX_STATUS_CODES_TRACKED) {
        this.statuses.set(sample.status, 1);
      } else {
        // Bounded: a server returning thousands of distinct codes cannot
        // grow this map without limit. Surfaced as a "client" oddity rather
        // than silently discarded.
        this.statusOverflow = true;
      }
    }

    const second = Math.floor(sample.startOffsetMs / 1000);
    let bucket = this.buckets.get(second);
    if (!bucket) {
      if (this.buckets.size >= MAX_TIME_SERIES_POINTS) return;
      bucket = { requests: 0, errors: 0, latencySum: 0, latencies: [] };
      this.buckets.set(second, bucket);
    }
    bucket.requests += 1;
    if (sample.errorKind !== null) bucket.errors += 1;
    bucket.latencySum += sample.durationMs;
    if (bucket.latencies.length < MAX_SAMPLES_PER_BUCKET) bucket.latencies.push(sample.durationMs);
  }

  get statusCodeOverflow(): boolean {
    return this.statusOverflow;
  }

  statusDistribution(): PerfStatusCount[] {
    return [...this.statuses.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status - b.status);
  }

  timeSeries(): PerfTimePoint[] {
    return [...this.buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([second, bucket]) => {
        const sorted = [...bucket.latencies].sort((a, b) => a - b);
        return {
          second,
          requests: bucket.requests,
          errors: bucket.errors,
          avgLatencyMs: bucket.requests === 0 ? 0 : bucket.latencySum / bucket.requests,
          p95LatencyMs: percentile(sorted, 95),
        };
      });
  }

  /**
   * Builds the aggregate view. `elapsedMs` is supplied by the caller (the
   * worker's run loop) rather than read from a clock here — see the class
   * comment. Rates use elapsed *wall-clock* seconds of the run, so they are
   * directly comparable across runs of different durations.
   */
  snapshot(elapsedMs: number, activeUsers: number): PerfSnapshot {
    const elapsedSeconds = elapsedMs > 0 ? elapsedMs / 1000 : 0;
    const stats = this.latency.stats();
    return {
      elapsedMs,
      activeUsers,
      attempted: this.attempted,
      completed: this.completed,
      aborted: this.aborted,
      successful: this.successful,
      failed: this.failed,
      errorRate: this.completed === 0 ? 0 : this.failed / this.completed,
      rps: elapsedSeconds === 0 ? 0 : this.completed / elapsedSeconds,
      successfulRps: elapsedSeconds === 0 ? 0 : this.successful / elapsedSeconds,
      throughputBytesPerSec: elapsedSeconds === 0 ? 0 : this.bytes / elapsedSeconds,
      latency: stats,
      statusDistribution: this.statusDistribution(),
      errors: { ...this.errors },
      timeSeries: this.timeSeries(),
      latencySampled: this.latency.sampled,
      requestLimitReached: this.requestLimitReached,
    };
  }
}

/** Re-exported so callers can compute stats over an ad-hoc list without
 * constructing an aggregator (used by the time-series chart tooltips). */
export { computeLatencyStats };
