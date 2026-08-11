import { create } from "zustand";
import {
  PERFORMANCE_CONFIG_FORMAT_VERSION,
  createDefaultPerformanceConfig,
  createRunId,
  persistedPerformanceConfigSchema,
  type PerfRequestSpec,
  type PerfSnapshot,
  type PerformanceReport,
  type PerformanceTestConfig,
} from "@api-lab/performance-engine";
import {
  PerfWorkerError,
  cancelRun,
  getPerfStatus,
  startRun,
  streamRun,
  type PerfWorkerStatus,
} from "../lib/perfClient";

/**
 * Dedicated store for the Performance workspace — separate from
 * `useAppStore` for the same reason `useMockStore` is: everything here
 * coordinates with a remote process over HTTP/SSE rather than mutating local
 * workspace state (see docs/ARCHITECTURE.md's Milestone 9 and 10 sections).
 */

const BASE_URL_STORAGE_KEY = "api-lab-perf-worker-url";
const CONFIG_STORAGE_KEY = "api-lab-perf-config";
const DEFAULT_BASE_URL = "http://localhost:4020";

/** In-memory only, and small (spec §35). Performance history is deliberately
 * transient — a reload discards it rather than filling localStorage with
 * time series. */
const MAX_HISTORY = 5;

function loadBaseUrl(): string {
  try {
    return localStorage.getItem(BASE_URL_STORAGE_KEY) || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

/**
 * Loads the last-used configuration (spec §42). Corrupt or out-of-limits
 * stored data never crashes the page and is never trusted: it is logged and
 * replaced with defaults, exactly like every other persisted format in this
 * repo.
 */
export function loadPersistedConfig(): PerformanceTestConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return createDefaultPerformanceConfig();
    const parsed = persistedPerformanceConfigSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      console.warn("[api-lab] Ignoring invalid stored performance configuration:", parsed.error.message);
      return createDefaultPerformanceConfig();
    }
    return parsed.data.config;
  } catch (err) {
    console.warn("[api-lab] Failed to read the stored performance configuration:", err);
    return createDefaultPerformanceConfig();
  }
}

function persistConfig(config: PerformanceTestConfig): void {
  try {
    localStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({ version: PERFORMANCE_CONFIG_FORMAT_VERSION, config }),
    );
  } catch {
    // Storage being unavailable (private mode, quota) must never block a run.
  }
}

export type PerfRunStatus = "idle" | "starting" | "running" | "finished";

export interface PerfLiveState {
  elapsedMs: number;
  activeUsers: number;
  attempted: number;
  completed: number;
  failed: number;
}

const EMPTY_LIVE: PerfLiveState = { elapsedMs: 0, activeUsers: 0, attempted: 0, completed: 0, failed: 0 };

interface PerfStoreState {
  baseUrl: string;
  workerStatus: PerfWorkerStatus | null;
  workerError: string | null;

  config: PerformanceTestConfig;
  runStatus: PerfRunStatus;
  runId: string | null;
  live: PerfLiveState;
  /** The most recent aggregated batch — drives the live charts and P95. */
  snapshot: PerfSnapshot | null;
  report: PerformanceReport | null;
  runError: string | null;
  history: PerformanceReport[];

  setBaseUrl: (url: string) => void;
  setConfig: (patch: Partial<PerformanceTestConfig>) => void;
  refreshWorker: () => Promise<void>;
  start: (specs: PerfRequestSpec[], meta: { targetName: string; environmentName: string | null }) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
}

let disposeStream: (() => void) | null = null;

function describeError(err: unknown): string {
  if (err instanceof PerfWorkerError) return err.message;
  return "Unexpected error talking to the performance worker.";
}

export const usePerfStore = create<PerfStoreState>((set, get) => ({
  baseUrl: loadBaseUrl(),
  workerStatus: null,
  workerError: null,

  config: loadPersistedConfig(),
  runStatus: "idle",
  runId: null,
  live: EMPTY_LIVE,
  snapshot: null,
  report: null,
  runError: null,
  history: [],

  setBaseUrl: (url) => {
    try {
      localStorage.setItem(BASE_URL_STORAGE_KEY, url);
    } catch {
      // Non-fatal — the in-memory value below still updates.
    }
    set({ baseUrl: url, workerStatus: null, workerError: null });
  },

  setConfig: (patch) => {
    const config = { ...get().config, ...patch };
    persistConfig(config);
    set({ config });
  },

  refreshWorker: async () => {
    try {
      const workerStatus = await getPerfStatus(get().baseUrl);
      set({ workerStatus, workerError: null });
    } catch (err) {
      set({ workerStatus: null, workerError: describeError(err) });
    }
  },

  start: async (specs, meta) => {
    const { baseUrl, config } = get();
    const runId = createRunId();

    set({
      runStatus: "starting",
      runId,
      live: EMPTY_LIVE,
      snapshot: null,
      report: null,
      runError: null,
    });

    try {
      await startRun(baseUrl, {
        runId,
        requests: specs,
        virtualUsers: config.virtualUsers,
        durationSeconds: config.durationSeconds,
        rampUpSeconds: config.rampUpSeconds,
        loadModel: config.loadModel,
        targetRps: config.targetRps,
        requestTimeoutMs: config.requestTimeoutMs,
        thinkTimeMs: config.thinkTimeMs,
        meta: {
          targetName: meta.targetName,
          targetKind: config.targetKind,
          environmentName: meta.environmentName,
          loadModel: config.loadModel,
          thresholds: config.thresholds,
        },
      });
    } catch (err) {
      set({ runStatus: "idle", runId: null, runError: describeError(err) });
      return;
    }

    set({ runStatus: "running" });

    disposeStream?.();
    disposeStream = streamRun(baseUrl, runId, {
      onMessage: (message) => {
        // Ignore anything from a previous run whose stream is still closing.
        if (get().runId !== message.runId) return;

        switch (message.type) {
          case "START":
            return;
          case "PROGRESS":
            set({
              live: {
                elapsedMs: message.elapsedMs,
                activeUsers: message.activeUsers,
                attempted: message.attempted,
                completed: message.completed,
                failed: message.failed,
              },
            });
            return;
          case "METRICS":
            // Metrics arrive pre-aggregated at 1Hz, so React re-renders once
            // a second no matter how many thousands of requests were issued
            // in between (spec §22).
            set({
              snapshot: message.snapshot,
              live: {
                elapsedMs: message.snapshot.elapsedMs,
                activeUsers: message.snapshot.activeUsers,
                attempted: message.snapshot.attempted,
                completed: message.snapshot.completed,
                failed: message.snapshot.failed,
              },
            });
            return;
          case "ERROR":
            set({ runError: message.message });
            return;
          case "COMPLETE":
            set((state) => ({
              runStatus: "finished",
              report: message.report,
              snapshot: message.report.snapshot,
              history: [message.report, ...state.history].slice(0, MAX_HISTORY),
            }));
            return;
        }
      },
      onDisconnect: () => {
        if (get().runStatus !== "running") return;
        set({
          runStatus: "finished",
          runError: "Performance worker stopped unexpectedly. The run was ended and no further metrics were received.",
        });
      },
    });
  },

  stop: async () => {
    const { baseUrl, runId } = get();
    if (!runId) return;
    try {
      await cancelRun(baseUrl, runId);
    } catch (err) {
      set({ runError: describeError(err) });
    }
  },

  reset: () => {
    disposeStream?.();
    disposeStream = null;
    set({ runStatus: "idle", runId: null, live: EMPTY_LIVE, snapshot: null, report: null, runError: null });
  },
}));
