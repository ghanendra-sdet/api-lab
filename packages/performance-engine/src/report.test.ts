import { describe, expect, it } from "vitest";
import { formatReportSummary, reportToCsv, reportToJson } from "./report.ts";
import { MetricsAggregator } from "./aggregate.ts";
import { evaluateThresholds } from "./thresholds.ts";
import { createThreshold } from "./factory.ts";
import { persistedPerformanceConfigSchema } from "./schema.ts";
import { createDefaultPerformanceConfig } from "./factory.ts";
import { PERFORMANCE_CONFIG_FORMAT_VERSION, type PerformanceReport } from "./types.ts";

function buildReport(): PerformanceReport {
  const agg = new MetricsAggregator();
  for (let i = 1; i <= 100; i += 1) {
    const failing = i > 97;
    agg.recordAttempt();
    agg.record({
      startOffsetMs: i * 10,
      durationMs: i,
      status: failing ? 500 : 200,
      bytes: 50,
      errorKind: failing ? "http5xx" : null,
    });
  }
  const snapshot = agg.snapshot(1000, 10);
  const thresholdResults = evaluateThresholds([createThreshold("p95", "lt", 500)], snapshot);
  return {
    runId: "run-1",
    status: "passed",
    targetName: "Payment API",
    targetKind: "collection",
    environmentName: "Testing",
    loadModel: "concurrency",
    virtualUsers: 10,
    configuredDurationSeconds: 1,
    rampUpSeconds: 0,
    startedAt: Date.UTC(2026, 0, 1),
    durationMs: 1000,
    snapshot,
    thresholdResults,
  };
}

describe("reportToJson", () => {
  it("exports aggregate metrics, distribution, time series and thresholds", () => {
    const parsed = JSON.parse(reportToJson(buildReport()));
    expect(parsed.status).toBe("passed");
    expect(parsed.summary.completed).toBe(100);
    expect(parsed.summary.latencyMs.p95).toBe(95);
    expect(parsed.summary.errorRatePercent).toBe(3);
    expect(parsed.statusDistribution).toEqual([
      { status: 200, count: 97 },
      { status: 500, count: 3 },
    ]);
    expect(parsed.errors.http5xx).toBe(3);
    expect(Array.isArray(parsed.timeSeries)).toBe(true);
    expect(parsed.thresholds[0]).toMatchObject({ metric: "p95", expected: 500, passed: true });
  });

  it("labels total vs successful request rate separately", () => {
    const parsed = JSON.parse(reportToJson(buildReport()));
    expect(parsed.summary.requestsPerSecond).toBe(100);
    expect(parsed.summary.successfulRequestsPerSecond).toBe(97);
  });

  it("states that results are not distributed load-test results", () => {
    expect(reportToJson(buildReport())).toContain("not equivalent to distributed production load-test results");
  });

  it("exports no individual request records", () => {
    const parsed = JSON.parse(reportToJson(buildReport()));
    expect(parsed.requests).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("rawBody");
  });
});

describe("reportToCsv", () => {
  const csv = reportToCsv(buildReport());

  it("writes labelled sections", () => {
    expect(csv).toContain("Section,Metric,Value");
    expect(csv).toContain("Status code,Count");
    expect(csv).toContain("Error kind,Count");
    expect(csv).toContain("Second,Requests,Errors,Avg latency (ms),P95 latency (ms)");
    expect(csv).toContain("Threshold,Expected,Actual,Result");
  });

  it("includes the key summary metrics", () => {
    expect(csv).toContain("Summary,P95 latency (ms),95");
    expect(csv).toContain("Summary,Completed requests,100");
    expect(csv).toContain("Summary,Error rate (%),3");
  });

  it("marks threshold rows PASS/FAIL", () => {
    expect(csv).toContain("PASS");
  });

  it("escapes values containing commas or quotes", () => {
    const report = { ...buildReport(), targetName: 'Payments, "v2"' };
    expect(reportToCsv(report)).toContain('"Payments, ""v2"""');
  });
});

describe("formatReportSummary", () => {
  it("renders the compact report block", () => {
    const text = formatReportSummary(buildReport());
    expect(text).toContain("Performance Test Result");
    expect(text).toContain("Status: PASSED");
    expect(text).toContain("Virtual Users: 10");
    expect(text).toContain("P95: 95ms");
  });

  it("never renders a cancelled run as passed", () => {
    const cancelled = { ...buildReport(), status: "cancelled" as const };
    expect(formatReportSummary(cancelled)).toContain("Status: CANCELLED");
  });
});

describe("persisted configuration", () => {
  it("accepts a valid versioned envelope", () => {
    const result = persistedPerformanceConfigSchema.safeParse({
      version: PERFORMANCE_CONFIG_FORMAT_VERSION,
      config: createDefaultPerformanceConfig(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unversioned or corrupt envelope instead of trusting it", () => {
    expect(persistedPerformanceConfigSchema.safeParse({ config: createDefaultPerformanceConfig() }).success).toBe(false);
    expect(persistedPerformanceConfigSchema.safeParse({ version: 1, config: { virtualUsers: 5 } }).success).toBe(false);
    expect(persistedPerformanceConfigSchema.safeParse("not an object").success).toBe(false);
  });

  it("rejects an out-of-limits persisted configuration", () => {
    const config = { ...createDefaultPerformanceConfig(), virtualUsers: 10_000 };
    expect(persistedPerformanceConfigSchema.safeParse({ version: 1, config }).success).toBe(false);
  });
});
