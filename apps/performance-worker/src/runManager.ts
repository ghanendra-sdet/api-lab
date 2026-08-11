import { Worker } from "node:worker_threads";
import {
  evaluateThresholds,
  thresholdsPassed,
  type PerfOutboundMessage,
  type PerfRunRequest,
  type PerfSnapshot,
  type PerfThreshold,
  type PerformanceReport,
  type PerfLoadModel,
  type PerfTargetKind,
} from "@api-lab/performance-engine";

/**
 * Reporting metadata the load generator has no business knowing. The Worker
 * receives only a load profile (URLs, methods, counts, timings); names,
 * environment labels, and thresholds stay in the control plane and are
 * applied when the final report is composed. That split is why a threshold
 * change can never alter generated traffic, and why the Worker's message
 * channel carries no human-facing strings at all.
 */
export interface RunMeta {
  targetName: string;
  targetKind: PerfTargetKind;
  environmentName: string | null;
  loadModel: PerfLoadModel;
  thresholds: PerfThreshold[];
}

type Listener = (message: PerfOutboundMessage) => void;

/** How long a Worker gets to finish after `terminate()` before we stop
 * waiting on it and report the run as cancelled anyway. */
const TERMINATE_GRACE_MS = 5_000;

export type RunState = "running" | "finished";

interface Run {
  id: string;
  state: RunState;
  worker: Worker | null;
  meta: RunMeta;
  request: PerfRunRequest;
  startedAt: number;
  listeners: Set<Listener>;
  /** Retained so a client that connects late, or reconnects, still gets the
   * outcome. In-memory only and evicted — never written to disk (spec §35). */
  report: PerformanceReport | null;
  lastSnapshot: PerfSnapshot | null;
  cancelRequested: boolean;
}

/** Bounded in-memory run history (spec §35): performance results are
 * deliberately transient. Nothing here is persisted, so restarting the
 * worker process discards every past result by design. */
const MAX_RETAINED_RUNS = 20;

export class RunManager {
  private readonly runs = new Map<string, Run>();
  private readonly workerUrl: URL;

  constructor(workerUrl: URL) {
    this.workerUrl = workerUrl;
  }

  get activeCount(): number {
    let count = 0;
    for (const run of this.runs.values()) if (run.state === "running") count += 1;
    return count;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  report(id: string): PerformanceReport | null {
    return this.runs.get(id)?.report ?? null;
  }

  subscribe(id: string, listener: Listener): () => void {
    const run = this.runs.get(id);
    if (!run) return () => {};
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  private emit(run: Run, message: PerfOutboundMessage): void {
    for (const listener of run.listeners) {
      try {
        listener(message);
      } catch {
        // A broken SSE connection must never take down the run that is
        // feeding it — the run keeps going and simply loses that subscriber.
      }
    }
  }

  start(request: PerfRunRequest, meta: RunMeta): void {
    const worker = new Worker(this.workerUrl, { workerData: request });
    const run: Run = {
      id: request.runId,
      state: "running",
      worker,
      meta,
      request,
      startedAt: Date.now(),
      listeners: new Set(),
      report: null,
      lastSnapshot: null,
      cancelRequested: false,
    };
    this.runs.set(request.runId, run);
    this.evictOldRuns();

    worker.on("message", (raw: unknown) => this.handleWorkerMessage(run, raw));

    // A thrown error inside the Worker: generation is over, but the control
    // plane survives and reports it as a failed run (spec §28).
    worker.on("error", (err: Error) => {
      this.finishWithError(run, `Performance worker stopped unexpectedly: ${err.message}`);
    });

    // A non-zero exit that never produced a FINISHED message means the
    // Worker died (OOM, hard crash, external kill) rather than completing.
    worker.on("exit", (code: number) => {
      if (run.state === "finished") return;
      this.finishWithError(
        run,
        code === 0
          ? "Performance worker stopped unexpectedly before reporting a result."
          : `Performance worker stopped unexpectedly (exit code ${code}).`,
      );
    });
  }

  private handleWorkerMessage(run: Run, raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return;
    const message = raw as { type?: string };

    switch (message.type) {
      case "START":
        this.emit(run, { type: "START", runId: run.id, startedAt: run.startedAt });
        return;

      case "PROGRESS": {
        const progress = raw as { elapsedMs: number; activeUsers: number; attempted: number; completed: number; failed: number };
        this.emit(run, { type: "PROGRESS", runId: run.id, ...progress });
        return;
      }

      case "METRICS": {
        const { snapshot } = raw as { snapshot: PerfSnapshot };
        run.lastSnapshot = snapshot;
        this.emit(run, { type: "METRICS", runId: run.id, snapshot });
        return;
      }

      case "FINISHED": {
        const finished = raw as { reason: "completed" | "cancelled"; snapshot: PerfSnapshot; durationMs: number };
        this.finish(run, finished.reason, finished.snapshot, finished.durationMs);
        return;
      }

      case "FATAL": {
        const { message: text } = raw as { message: string };
        this.finishWithError(run, text);
        return;
      }

      default:
        return;
    }
  }

  /**
   * Composes the final report. Threshold evaluation only decides
   * passed/failed for a run that actually *ran to completion* — a cancelled
   * or crashed run keeps its own status regardless of how the numbers look,
   * so cancellation is never dressed up as success (spec §27).
   */
  private finish(run: Run, reason: "completed" | "cancelled", snapshot: PerfSnapshot, durationMs: number): void {
    if (run.state === "finished") return;
    const thresholdResults = evaluateThresholds(run.meta.thresholds, snapshot);
    const status = reason === "cancelled" ? "cancelled" : thresholdsPassed(thresholdResults) ? "passed" : "failed";

    run.state = "finished";
    run.lastSnapshot = snapshot;
    run.report = {
      runId: run.id,
      status,
      targetName: run.meta.targetName,
      targetKind: run.meta.targetKind,
      environmentName: run.meta.environmentName,
      loadModel: run.meta.loadModel,
      virtualUsers: run.request.virtualUsers,
      configuredDurationSeconds: run.request.durationSeconds,
      rampUpSeconds: run.request.rampUpSeconds,
      startedAt: run.startedAt,
      durationMs,
      snapshot,
      thresholdResults,
    };
    this.emit(run, { type: "COMPLETE", runId: run.id, report: run.report });
    void run.worker?.terminate();
    run.worker = null;
  }

  private finishWithError(run: Run, message: string): void {
    if (run.state === "finished") return;
    run.state = "finished";
    // Whatever was measured before the crash is still reported — partial
    // metrics are more useful than none, as long as the status says "error".
    // A crash before ANY metrics arrived still produces a report (with a
    // zeroed snapshot): a client polling for an outcome must always get one,
    // otherwise a worker that dies on startup leaves the UI spinning
    // forever, which is exactly the hang spec §28 forbids.
    const snapshot = run.lastSnapshot ?? emptySnapshot();
    run.report = {
      runId: run.id,
      status: "error",
      targetName: run.meta.targetName,
      targetKind: run.meta.targetKind,
      environmentName: run.meta.environmentName,
      loadModel: run.meta.loadModel,
      virtualUsers: run.request.virtualUsers,
      configuredDurationSeconds: run.request.durationSeconds,
      rampUpSeconds: run.request.rampUpSeconds,
      startedAt: run.startedAt,
      durationMs: snapshot.elapsedMs,
      snapshot,
      thresholdResults: [],
      errorMessage: message,
    };
    this.emit(run, { type: "ERROR", runId: run.id, message });
    this.emit(run, { type: "COMPLETE", runId: run.id, report: run.report });
    void run.worker?.terminate();
    run.worker = null;
  }

  /**
   * Cancellation (spec §27). Signals the Worker so it can stop scheduling
   * new work, abort in-flight requests, and flush a final snapshot — that
   * cooperative path produces a real `cancelled` report with usable metrics.
   * The grace timer is the backstop: if the Worker is wedged and never
   * answers, it is terminated hard and the run is still reported as
   * cancelled rather than hanging forever.
   */
  cancel(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || run.state !== "running" || run.cancelRequested) return false;
    run.cancelRequested = true;
    run.worker?.postMessage({ type: "CANCEL", runId: id });

    setTimeout(() => {
      if (run.state === "running") {
        this.finish(run, "cancelled", run.lastSnapshot ?? emptySnapshot(), run.lastSnapshot?.elapsedMs ?? 0);
      }
    }, TERMINATE_GRACE_MS).unref?.();

    return true;
  }

  /** Stops every run — used on process shutdown so no orphaned Worker keeps
   * generating traffic after the control plane goes away. */
  async shutdown(): Promise<void> {
    const terminations: Array<Promise<unknown>> = [];
    for (const run of this.runs.values()) {
      if (run.worker) terminations.push(run.worker.terminate());
      run.state = "finished";
      run.worker = null;
    }
    await Promise.all(terminations);
  }

  private evictOldRuns(): void {
    if (this.runs.size <= MAX_RETAINED_RUNS) return;
    for (const [id, run] of this.runs) {
      if (this.runs.size <= MAX_RETAINED_RUNS) break;
      if (run.state === "finished") this.runs.delete(id);
    }
  }
}

function emptySnapshot(): PerfSnapshot {
  return {
    elapsedMs: 0,
    activeUsers: 0,
    attempted: 0,
    completed: 0,
    aborted: 0,
    successful: 0,
    failed: 0,
    errorRate: 0,
    rps: 0,
    successfulRps: 0,
    throughputBytesPerSec: 0,
    latency: { count: 0, min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 },
    statusDistribution: [],
    errors: { http4xx: 0, http5xx: 0, timeout: 0, network: 0, connection: 0, cancelled: 0, client: 0 },
    timeSeries: [],
    latencySampled: false,
    requestLimitReached: false,
  };
}
