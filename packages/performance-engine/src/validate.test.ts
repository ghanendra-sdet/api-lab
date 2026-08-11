import { describe, expect, it } from "vitest";
import {
  isLocalTarget,
  requiresProductionWarning,
  validatePerformanceConfig,
  validateRequestCount,
  validateTargetUrl,
  validateTotalRequestBudget,
} from "./validate.ts";
import { createDefaultPerformanceConfig, createThreshold } from "./factory.ts";
import { MAX_DURATION_SECONDS, MAX_REQUESTS_PER_ITERATION, MAX_VIRTUAL_USERS } from "./types.ts";

function config(overrides: Partial<ReturnType<typeof createDefaultPerformanceConfig>> = {}) {
  return { ...createDefaultPerformanceConfig(), targetId: "req-1", ...overrides };
}

function fields(errors: ReturnType<typeof validatePerformanceConfig>): string[] {
  return errors.map((e) => e.field);
}

describe("validatePerformanceConfig — virtual users", () => {
  it("accepts a sane default configuration", () => {
    expect(validatePerformanceConfig(config())).toEqual([]);
  });

  it("rejects zero, negative, fractional and over-limit user counts", () => {
    expect(fields(validatePerformanceConfig(config({ virtualUsers: 0 })))).toContain("virtualUsers");
    expect(fields(validatePerformanceConfig(config({ virtualUsers: -5 })))).toContain("virtualUsers");
    expect(fields(validatePerformanceConfig(config({ virtualUsers: 2.5 })))).toContain("virtualUsers");
    expect(fields(validatePerformanceConfig(config({ virtualUsers: MAX_VIRTUAL_USERS + 1 })))).toContain("virtualUsers");
  });

  it("accepts exactly the maximum virtual users", () => {
    expect(validatePerformanceConfig(config({ virtualUsers: MAX_VIRTUAL_USERS }))).toEqual([]);
  });
});

describe("validatePerformanceConfig — duration and ramp-up", () => {
  it("rejects invalid durations", () => {
    expect(fields(validatePerformanceConfig(config({ durationSeconds: 0 })))).toContain("durationSeconds");
    expect(fields(validatePerformanceConfig(config({ durationSeconds: 1.5 })))).toContain("durationSeconds");
    expect(fields(validatePerformanceConfig(config({ durationSeconds: MAX_DURATION_SECONDS + 1 })))).toContain(
      "durationSeconds",
    );
  });

  it("allows a zero ramp-up", () => {
    expect(validatePerformanceConfig(config({ rampUpSeconds: 0 }))).toEqual([]);
  });

  it("rejects a ramp-up that never completes within the duration", () => {
    const errors = validatePerformanceConfig(config({ durationSeconds: 10, rampUpSeconds: 10 }));
    expect(fields(errors)).toContain("rampUpSeconds");
    expect(errors[0]!.message).toMatch(/shorter than the total duration/);
  });

  it("rejects a negative ramp-up", () => {
    expect(fields(validatePerformanceConfig(config({ rampUpSeconds: -1 })))).toContain("rampUpSeconds");
  });
});

describe("validatePerformanceConfig — rate mode", () => {
  it("ignores targetRps in concurrency mode", () => {
    expect(validatePerformanceConfig(config({ loadModel: "concurrency", targetRps: 0 }))).toEqual([]);
  });

  it("validates targetRps in rate mode", () => {
    expect(fields(validatePerformanceConfig(config({ loadModel: "rate", targetRps: 0 })))).toContain("targetRps");
    expect(fields(validatePerformanceConfig(config({ loadModel: "rate", targetRps: 999_999 })))).toContain("targetRps");
    expect(validatePerformanceConfig(config({ loadModel: "rate", targetRps: 50 }))).toEqual([]);
  });
});

describe("validatePerformanceConfig — misc", () => {
  it("requires a target", () => {
    expect(fields(validatePerformanceConfig(config({ targetId: null })))).toContain("target");
  });

  it("rejects invalid timeouts and think time", () => {
    expect(fields(validatePerformanceConfig(config({ requestTimeoutMs: 0 })))).toContain("requestTimeoutMs");
    expect(fields(validatePerformanceConfig(config({ thinkTimeMs: -1 })))).toContain("thinkTimeMs");
  });

  it("rejects an invalid threshold value", () => {
    expect(fields(validatePerformanceConfig(config({ thresholds: [createThreshold("p95", "lt", -1)] })))).toContain(
      "thresholds",
    );
    expect(fields(validatePerformanceConfig(config({ thresholds: [createThreshold("errorRate", "lt", 500)] })))).toContain(
      "thresholds",
    );
  });

  it("reports every problem at once rather than only the first", () => {
    const errors = validatePerformanceConfig(config({ virtualUsers: 0, durationSeconds: 0, targetId: null }));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("request-count and budget limits", () => {
  it("rejects an empty target", () => {
    expect(validateRequestCount(0)?.field).toBe("requests");
  });

  it("rejects a target with too many requests", () => {
    expect(validateRequestCount(MAX_REQUESTS_PER_ITERATION + 1)?.field).toBe("requests");
    expect(validateRequestCount(MAX_REQUESTS_PER_ITERATION)).toBeNull();
  });

  it("rejects a rate configuration that would exceed the total request budget", () => {
    const budget = validateTotalRequestBudget(
      config({ loadModel: "rate", targetRps: 5000, durationSeconds: 600 }),
      10,
    );
    expect(budget?.field).toBe("targetRps");
  });

  it("does not budget-check concurrency mode, where the worker enforces at runtime", () => {
    expect(validateTotalRequestBudget(config({ loadModel: "concurrency" }), 10)).toBeNull();
  });
});

describe("target safety", () => {
  it("accepts http and https targets", () => {
    expect(validateTargetUrl("http://localhost:4010/health")).toBeNull();
    expect(validateTargetUrl("https://staging.example.com/api")).toBeNull();
  });

  it("rejects non-http schemes and unparseable URLs", () => {
    expect(validateTargetUrl("file:///etc/passwd")).toMatch(/Only http and https/);
    expect(validateTargetUrl("ftp://example.com")).toMatch(/Only http and https/);
    expect(validateTargetUrl("/relative/path")).toMatch(/not a valid absolute URL/);
    expect(validateTargetUrl("")).toMatch(/not a valid absolute URL/);
  });

  it("recognises local targets so local mock testing is not nagged", () => {
    expect(isLocalTarget("http://localhost:4010/x")).toBe(true);
    expect(isLocalTarget("http://127.0.0.1:4010/x")).toBe(true);
    expect(isLocalTarget("https://staging.example.com/x")).toBe(false);
  });

  it("requires a production warning as soon as any target leaves the machine", () => {
    expect(requiresProductionWarning(["http://localhost:4010/a", "http://localhost:4010/b"])).toBe(false);
    expect(requiresProductionWarning(["http://localhost:4010/a", "https://api.example.com/b"])).toBe(true);
  });
});
