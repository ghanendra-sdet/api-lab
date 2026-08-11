import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERFORMANCE_CONFIG_FORMAT_VERSION, createDefaultPerformanceConfig } from "@api-lab/performance-engine";
import { loadPersistedConfig, usePerfStore } from "./usePerfStore";

const CONFIG_KEY = "api-lab-perf-config";

describe("performance configuration persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    usePerfStore.setState({ config: createDefaultPerformanceConfig() });
  });

  it("starts from a safe local-first default", () => {
    const config = loadPersistedConfig();
    expect(config.virtualUsers).toBe(10);
    expect(config.durationSeconds).toBe(30);
    expect(config.rampUpSeconds).toBe(5);
    expect(config.loadModel).toBe("concurrency");
    expect(config.thresholds.map((t) => t.metric)).toEqual(["p95", "errorRate"]);
  });

  it("persists a changed configuration in a versioned envelope", () => {
    usePerfStore.getState().setConfig({ virtualUsers: 25, durationSeconds: 12 });
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY)!) as { version: number; config: { virtualUsers: number } };
    expect(stored.version).toBe(PERFORMANCE_CONFIG_FORMAT_VERSION);
    expect(stored.config.virtualUsers).toBe(25);
    expect(loadPersistedConfig().durationSeconds).toBe(12);
  });

  it("never persists execution state or results", () => {
    usePerfStore.getState().setConfig({ virtualUsers: 3 });
    const stored = localStorage.getItem(CONFIG_KEY)!;
    expect(stored).not.toContain("snapshot");
    expect(stored).not.toContain("report");
    expect(stored).not.toContain("runId");
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual(["config", "version"]);
  });

  it("recovers from a corrupt stored configuration instead of crashing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(CONFIG_KEY, "{not json");
    expect(loadPersistedConfig().virtualUsers).toBe(10);
    warn.mockRestore();
  });

  it("rejects a stored configuration that exceeds the safety limits", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ version: 1, config: { ...createDefaultPerformanceConfig(), virtualUsers: 100_000 } }),
    );
    // A tampered or hand-edited value can never raise the limits.
    expect(loadPersistedConfig().virtualUsers).toBe(10);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores an envelope with no version rather than trusting it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ config: createDefaultPerformanceConfig() }));
    expect(loadPersistedConfig().virtualUsers).toBe(10);
    warn.mockRestore();
  });
});

describe("performance run state", () => {
  beforeEach(() => {
    usePerfStore.getState().reset();
  });

  it("starts idle with no report and no history", () => {
    const state = usePerfStore.getState();
    expect(state.runStatus).toBe("idle");
    expect(state.report).toBeNull();
    expect(state.snapshot).toBeNull();
  });

  it("clears live metrics and errors on reset", () => {
    usePerfStore.setState({
      runStatus: "finished",
      runError: "boom",
      live: { elapsedMs: 500, activeUsers: 3, attempted: 10, completed: 8, failed: 2 },
    });
    usePerfStore.getState().reset();
    const state = usePerfStore.getState();
    expect(state.runStatus).toBe("idle");
    expect(state.runError).toBeNull();
    expect(state.live.completed).toBe(0);
  });
});
