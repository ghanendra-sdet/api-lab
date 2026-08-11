import { parentPort, workerData } from "node:worker_threads";
import { MetricsAggregator, type PerfRunRequest, type PerfSnapshot } from "@api-lab/performance-engine";
import { substituteRuntimeVariables } from "@api-lab/performance-engine";
import { executeOnce } from "./execute.ts";

/**
 * The load generator. Runs inside a Node `worker_threads` Worker, one
 * Worker per performance run, spawned by `runManager.ts`.
 *
 * Why a worker thread and not just the control-plane event loop: the
 * control plane must stay responsive while the run is saturating the
 * machine — it has to answer `/cancel` promptly and keep the SSE stream
 * flowing. Isolating generation also makes cancellation and failure real
 * rather than cooperative: `worker.terminate()` is a hard stop, and a crash
 * in generation kills only the Worker, leaving the control plane alive to
 * report "Performance worker stopped unexpectedly" (spec §28) instead of
 * dropping the client's connection with no explanation.
 *
 * Messages out: START, PROGRESS, METRICS, FINISHED. Never a response body,
 * never a header set, never a URL (spec §26).
 */

/** Worker-internal terminal message. The control plane turns this into the
 * public COMPLETE message after evaluating thresholds. */
export interface FinishedMessage {
  type: "FINISHED";
  reason: "completed" | "cancelled";
  snapshot: PerfSnapshot;
  durationMs: number;
}

const PROGRESS_INTERVAL_MS = 250;
const METRICS_INTERVAL_MS = 1000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Open-model request pacer for `loadModel: "rate"` (spec §40).
 *
 * Slots are handed out at a fixed interval derived from the target rate,
 * ramping linearly during ramp-up. The critical property is the clamp in
 * `acquire()`: if the system under test is slower than the configured rate,
 * `nextSlot` is pulled forward to "now" rather than accumulating an
 * ever-growing debt of overdue slots. Without that clamp, a slow endpoint
 * would build an unbounded backlog and then release a thundering herd the
 * moment it recovered — which measures the load generator, not the server.
 *
 * The honest limitation: achieved rate is still bounded by the configured
 * virtual users. With 10 VUs against a 100ms endpoint, no pacer can exceed
 * ~100 req/s no matter what target is set. The report always shows the
 * *achieved* RPS, never the configured one.
 */
class Pacer {
  private nextSlot: number;
  private readonly targetRps: number;
  private readonly rampMs: number;
  private readonly t0: number;

  constructor(targetRps: number, rampMs: number, t0: number) {
    this.targetRps = targetRps;
    this.rampMs = rampMs;
    this.t0 = t0;
    this.nextSlot = t0;
  }

  private currentRate(now: number): number {
    if (this.rampMs <= 0) return this.targetRps;
    const progress = Math.min(1, (now - this.t0) / this.rampMs);
    return Math.max(1, this.targetRps * progress);
  }

  async acquire(signal: AbortSignal): Promise<void> {
    const now = performance.now();
    if (this.nextSlot < now) this.nextSlot = now;
    const wait = this.nextSlot - now;
    this.nextSlot += 1000 / this.currentRate(this.nextSlot);
    if (wait > 0) await sleep(wait, signal);
  }
}

function post(message: unknown): void {
  parentPort?.postMessage(message);
}

async function run(request: PerfRunRequest): Promise<void> {
  const controller = new AbortController();
  let cancelled = false;

  parentPort?.on("message", (message: unknown) => {
    if (typeof message === "object" && message !== null && (message as { type?: string }).type === "CANCEL") {
      cancelled = true;
      controller.abort();
    }
  });

  const aggregator = new MetricsAggregator();
  const t0 = performance.now();
  const durationMs = request.durationSeconds * 1000;
  const rampMs = request.rampUpSeconds * 1000;
  const pacer = request.loadModel === "rate" ? new Pacer(request.targetRps, rampMs, t0) : null;

  let activeUsers = 0;
  const elapsed = () => performance.now() - t0;

  post({ type: "START", startedAt: Date.now() });

  // Ending the run is a deadline, not a per-request check: the timer aborts
  // the shared signal so in-flight requests are cut short rather than the
  // run overrunning by up to one full request timeout (spec §8).
  const deadline = setTimeout(() => controller.abort(), durationMs);

  let lastMetricsAt = 0;
  const reporter = setInterval(() => {
    const now = elapsed();
    const snapshotDue = now - lastMetricsAt >= METRICS_INTERVAL_MS;
    if (snapshotDue) {
      lastMetricsAt = now;
      // The full aggregate (percentiles, distribution, time series) is
      // batched at 1Hz. PROGRESS below is the cheap 4Hz liveness signal.
      // Neither is ever emitted per request (spec §22).
      post({ type: "METRICS", snapshot: aggregator.snapshot(now, activeUsers) });
    } else {
      post({
        type: "PROGRESS",
        elapsedMs: now,
        activeUsers,
        attempted: aggregator.attemptedCount,
        completed: aggregator.completedCount,
        failed: aggregator.failedCount,
      });
    }
  }, PROGRESS_INTERVAL_MS);

  /**
   * One virtual user (spec §9).
   *
   * Selected behaviour: a virtual user **loops the target** — it runs the
   * whole request sequence in order, then (after an optional think time)
   * starts again, until the duration expires or the run is cancelled. This
   * is the closed-model behaviour every load-testing tool uses, and it is
   * the only one that produces a meaningful sustained-throughput figure; a
   * run-once model would just measure N parallel requests and finish.
   *
   * Isolation (spec §14, §15): `runtime` is created fresh here, inside the
   * per-iteration loop, so it is scoped to one virtual user AND one
   * iteration. There is no shared mutable variable map anywhere in this
   * function, which is what structurally prevents VU 1's extracted token
   * from ever reaching VU 2's request.
   */
  async function virtualUser(index: number): Promise<void> {
    const startDelay = request.virtualUsers > 1 ? (rampMs * index) / request.virtualUsers : 0;
    await sleep(startDelay, controller.signal);
    if (controller.signal.aborted) return;

    activeUsers += 1;
    try {
      while (!controller.signal.aborted) {
        const runtime: Record<string, string> = Object.create(null) as Record<string, string>;

        for (const template of request.requests) {
          if (controller.signal.aborted) return;

          if (aggregator.attemptedCount >= request.maxTotalRequests) {
            aggregator.requestLimitReached = true;
            controller.abort();
            return;
          }

          if (pacer) {
            await pacer.acquire(controller.signal);
            if (controller.signal.aborted) return;
          }

          const spec = substituteRuntimeVariables(template, runtime);
          const startOffsetMs = elapsed();
          aggregator.recordAttempt();

          const { sample, extracted } = await executeOnce(spec, {
            timeoutMs: request.requestTimeoutMs,
            runSignal: controller.signal,
            startOffsetMs,
          });

          // A request cut short because the run ended (deadline or user
          // cancellation) is recorded as an aborted attempt, never as a
          // success and never as a server-side failure — see
          // MetricsAggregator.recordAborted.
          if (sample.errorKind === "cancelled") aggregator.recordAborted();
          else aggregator.record(sample);

          for (const [key, value] of Object.entries(extracted)) runtime[key] = value;
        }

        if (request.thinkTimeMs > 0) await sleep(request.thinkTimeMs, controller.signal);
      }
    } finally {
      activeUsers -= 1;
    }
  }

  const users = Array.from({ length: request.virtualUsers }, (_, index) => virtualUser(index));
  await Promise.all(users);

  clearTimeout(deadline);
  clearInterval(reporter);

  const finalElapsed = elapsed();
  const finished: FinishedMessage = {
    type: "FINISHED",
    reason: cancelled ? "cancelled" : "completed",
    snapshot: aggregator.snapshot(finalElapsed, 0),
    durationMs: finalElapsed,
  };
  post(finished);
}

// `workerData` is the validated PerfRunRequest handed over by runManager —
// it has already passed the engine's schema and limit checks in the control
// plane, which never trusts its HTTP caller.
run(workerData as PerfRunRequest).catch((err: unknown) => {
  post({ type: "FATAL", message: err instanceof Error ? err.message : "Load generation failed unexpectedly." });
});
