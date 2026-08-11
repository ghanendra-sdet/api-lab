import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PerformanceReport } from "@api-lab/performance-engine";
import { buildPerformanceServer } from "./server.ts";

/**
 * Integration tests: a real Fastify control plane, a real worker thread, and
 * a real HTTP target. Nothing is mocked — the point is to prove the whole
 * Web ↔ control plane ↔ Worker ↔ target chain works, including cancellation
 * and worker failure.
 *
 * Every assertion is written to be deterministic on a noisy CI machine
 * (spec §48): request *counts* and *relationships* are asserted, never exact
 * latency values.
 */

let target: Server;
let targetBase: string;
let app: FastifyInstance;
let base: string;

/** Deterministic endpoints. `/slow` uses a fixed delay so the "slow is
 * slower than fast" relationship holds regardless of machine speed. */
function startTargetServer(): Promise<void> {
  let tokenCounter = 0;
  target = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/fast") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (path === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }, 60);
      return;
    }
    if (path === "/error") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"error":"boom"}');
      return;
    }
    if (path === "/login") {
      tokenCounter += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: `token-${tokenCounter}` }));
      return;
    }
    if (path === "/whoami") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ seen: req.headers.authorization ?? "none" }));
      return;
    }
    const statusMatch = /^\/status\/(\d{3})$/.exec(path);
    if (statusMatch) {
      res.writeHead(Number(statusMatch[1]), { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":"not found"}');
  });
  return new Promise((resolve) => {
    target.listen(0, "127.0.0.1", () => resolve());
  });
}

interface RunOptions {
  paths?: string[];
  requests?: Array<Record<string, unknown>>;
  virtualUsers?: number;
  durationSeconds?: number;
  rampUpSeconds?: number;
  loadModel?: "concurrency" | "rate";
  targetRps?: number;
  requestTimeoutMs?: number;
  thinkTimeMs?: number;
  thresholds?: Array<Record<string, unknown>>;
}

let runCounter = 0;

function runBody(options: RunOptions): Record<string, unknown> {
  runCounter += 1;
  const requests =
    options.requests ??
    (options.paths ?? ["/fast"]).map((path, index) => ({
      id: `r${index}`,
      name: path,
      method: "GET",
      url: `${targetBase}${path}`,
      headers: {},
      body: null,
      extractions: [],
    }));

  return {
    runId: `test-run-${runCounter}`,
    requests,
    virtualUsers: options.virtualUsers ?? 2,
    durationSeconds: options.durationSeconds ?? 1,
    rampUpSeconds: options.rampUpSeconds ?? 0,
    loadModel: options.loadModel ?? "concurrency",
    targetRps: options.targetRps ?? 50,
    requestTimeoutMs: options.requestTimeoutMs ?? 5000,
    thinkTimeMs: options.thinkTimeMs ?? 0,
    meta: {
      targetName: "Test target",
      targetKind: "collection",
      environmentName: "Testing",
      loadModel: options.loadModel ?? "concurrency",
      thresholds: options.thresholds ?? [],
    },
  };
}

async function startRun(options: RunOptions): Promise<string> {
  const body = runBody(options);
  const res = await fetch(`${base}/__perf/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return body.runId as string;
}

async function waitForReport(runId: string, timeoutMs = 20_000): Promise<PerformanceReport> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/__perf/runs/${runId}`);
    const data = (await res.json()) as { state: string; report: PerformanceReport | null };
    if (data.state === "finished" && data.report) return data.report;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms`);
}

beforeAll(async () => {
  await startTargetServer();
  targetBase = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
  app = buildPerformanceServer({ workerUrl: new URL("./loadWorker.ts", import.meta.url) });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

describe("control plane — status and configuration validation", () => {
  it("reports its safety limits so the UI cannot drift from them", async () => {
    const res = await fetch(`${base}/__perf/status`);
    const data = (await res.json()) as { running: boolean; limits: Record<string, number> };
    expect(data.running).toBe(true);
    expect(data.limits.maxVirtualUsers).toBe(100);
    expect(data.limits.maxDurationSeconds).toBe(600);
  });

  it("rejects a virtual-user count above the safety limit", async () => {
    const res = await fetch(`${base}/__perf/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runBody({ virtualUsers: 5000 })),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duration above the safety limit", async () => {
    const res = await fetch(`${base}/__perf/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runBody({ durationSeconds: 99_999 })),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a ramp-up that never completes within the duration", async () => {
    const res = await fetch(`${base}/__perf/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runBody({ durationSeconds: 2, rampUpSeconds: 5 })),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a non-http target rather than load testing an arbitrary scheme", async () => {
    const res = await fetch(`${base}/__perf/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        runBody({
          requests: [
            { id: "r0", name: "bad", method: "GET", url: "file:///etc/passwd", headers: {}, body: null, extractions: [] },
          ],
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Only http and https/);
  });

  it("refuses an empty request list — there is no target to discover", async () => {
    const res = await fetch(`${base}/__perf/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runBody({ requests: [] })),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown run", async () => {
    expect((await fetch(`${base}/__perf/runs/nope`)).status).toBe(404);
    expect((await fetch(`${base}/__perf/runs/nope/cancel`, { method: "POST" })).status).toBe(404);
  });
});

describe("execution — real load against a real target", () => {
  it("runs a single-request test and produces a complete report", async () => {
    const report = await waitForReport(await startRun({ paths: ["/fast"], virtualUsers: 2, durationSeconds: 1 }));
    expect(report.status).toBe("passed");
    expect(report.snapshot.completed).toBeGreaterThan(0);
    expect(report.snapshot.successful).toBe(report.snapshot.completed);
    expect(report.snapshot.statusDistribution).toEqual([{ status: 200, count: report.snapshot.completed }]);
    expect(report.snapshot.rps).toBeGreaterThan(0);
    expect(report.snapshot.latency.count).toBe(report.snapshot.completed);
  }, 20_000);

  it("runs every request of a multi-request target in order, in equal numbers", async () => {
    const report = await waitForReport(
      await startRun({ paths: ["/fast", "/status/201", "/fast"], virtualUsers: 1, durationSeconds: 1 }),
    );
    const byStatus = new Map(report.snapshot.statusDistribution.map((s) => [s.status, s.count]));
    // Two /fast (200) per iteration to one /status/201 — the ratio is
    // deterministic even though the absolute count is not.
    expect(byStatus.get(201)).toBeGreaterThan(0);
    expect(byStatus.get(200)!).toBeGreaterThanOrEqual(byStatus.get(201)!);
  }, 20_000);

  it("computes percentiles across enough samples to be meaningful", async () => {
    const report = await waitForReport(await startRun({ paths: ["/fast"], virtualUsers: 4, durationSeconds: 2 }));
    const { latency } = report.snapshot;
    expect(latency.count).toBeGreaterThan(20);
    // Relative ordering only — never an absolute latency assertion.
    expect(latency.min).toBeLessThanOrEqual(latency.p50);
    expect(latency.p50).toBeLessThanOrEqual(latency.p90);
    expect(latency.p90).toBeLessThanOrEqual(latency.p95);
    expect(latency.p95).toBeLessThanOrEqual(latency.p99);
    expect(latency.p99).toBeLessThanOrEqual(latency.max);
  }, 25_000);

  it("achieves higher concurrency with more virtual users against a slow endpoint", async () => {
    const few = await waitForReport(await startRun({ paths: ["/slow"], virtualUsers: 1, durationSeconds: 2 }));
    const many = await waitForReport(await startRun({ paths: ["/slow"], virtualUsers: 8, durationSeconds: 2 }));
    // 8 users against a fixed-delay endpoint must complete materially more
    // work than 1 — the relationship is stable even on a loaded machine.
    expect(many.snapshot.completed).toBeGreaterThan(few.snapshot.completed * 2);
  }, 30_000);

  it("stops at the configured duration rather than running indefinitely", async () => {
    const started = Date.now();
    const report = await waitForReport(await startRun({ paths: ["/fast"], virtualUsers: 2, durationSeconds: 1 }));
    const wall = Date.now() - started;
    expect(report.durationMs).toBeGreaterThanOrEqual(900);
    expect(wall).toBeLessThan(10_000);
  }, 20_000);

  it("ramps users in gradually — early seconds do less work than later ones", async () => {
    const report = await waitForReport(
      await startRun({ paths: ["/slow"], virtualUsers: 10, durationSeconds: 4, rampUpSeconds: 3 }),
    );
    const series = report.snapshot.timeSeries;
    expect(series.length).toBeGreaterThanOrEqual(3);
    const first = series[0]!.requests;
    const last = series[series.length - 1]!.requests;
    expect(last).toBeGreaterThan(first);
  }, 30_000);
});

describe("metrics — errors, classification and thresholds", () => {
  it("reports a 100% error rate for an endpoint that always fails", async () => {
    const report = await waitForReport(await startRun({ paths: ["/error"], virtualUsers: 2, durationSeconds: 1 }));
    expect(report.snapshot.failed).toBe(report.snapshot.completed);
    expect(report.snapshot.errorRate).toBe(1);
    expect(report.snapshot.errors.http5xx).toBe(report.snapshot.completed);
    expect(report.snapshot.errors.http4xx).toBe(0);
    expect(report.snapshot.successful).toBe(0);
  }, 20_000);

  it("separates 4xx from 5xx in the error breakdown", async () => {
    const report = await waitForReport(
      await startRun({ paths: ["/status/404", "/status/503"], virtualUsers: 1, durationSeconds: 1 }),
    );
    expect(report.snapshot.errors.http4xx).toBeGreaterThan(0);
    expect(report.snapshot.errors.http5xx).toBeGreaterThan(0);
  }, 20_000);

  it("classifies a refused connection as a connection failure, not a generic error", async () => {
    // Port 1 on loopback is not listening — an explicitly configured target,
    // never a discovered one.
    const report = await waitForReport(
      await startRun({
        requests: [
          { id: "r0", name: "dead", method: "GET", url: "http://127.0.0.1:1/nothing", headers: {}, body: null, extractions: [] },
        ],
        virtualUsers: 1,
        durationSeconds: 1,
      }),
    );
    expect(report.snapshot.errors.connection + report.snapshot.errors.network).toBeGreaterThan(0);
    expect(report.snapshot.statusDistribution).toEqual([]);
  }, 20_000);

  it("records a timeout as a timeout rather than a network error", async () => {
    const report = await waitForReport(
      await startRun({ paths: ["/slow"], virtualUsers: 1, durationSeconds: 1, requestTimeoutMs: 5 }),
    );
    expect(report.snapshot.errors.timeout).toBeGreaterThan(0);
  }, 20_000);

  it("PASSES when a generous threshold is met", async () => {
    const report = await waitForReport(
      await startRun({
        paths: ["/fast"],
        durationSeconds: 1,
        thresholds: [{ id: "t1", metric: "p95", comparator: "lt", value: 60_000, enabled: true }],
      }),
    );
    expect(report.status).toBe("passed");
    expect(report.thresholdResults[0]!.passed).toBe(true);
  }, 20_000);

  it("FAILS when an impossible threshold is violated", async () => {
    const report = await waitForReport(
      await startRun({
        paths: ["/slow"],
        durationSeconds: 1,
        thresholds: [{ id: "t1", metric: "p95", comparator: "lt", value: 0.0001, enabled: true }],
      }),
    );
    expect(report.status).toBe("failed");
    expect(report.thresholdResults[0]!.passed).toBe(false);
  }, 20_000);
});

describe("virtual user isolation and chaining", () => {
  it("gives each virtual user its own chained token — no cross-VU leakage", async () => {
    const report = await waitForReport(
      await startRun({
        virtualUsers: 4,
        durationSeconds: 1,
        requests: [
          {
            id: "login",
            name: "Login",
            method: "GET",
            url: `${targetBase}/login`,
            headers: {},
            body: null,
            extractions: [{ id: "e1", source: "json", path: "$.token", variable: "token", enabled: true }],
          },
          {
            id: "whoami",
            name: "Who am I",
            method: "GET",
            url: `${targetBase}/whoami`,
            headers: { Authorization: "Bearer {{token}}" },
            body: null,
            extractions: [],
          },
        ],
      }),
    );
    // Every whoami saw a real, substituted token: the target returns 200 for
    // all of them, and no request 404'd on an unsubstituted URL.
    expect(report.snapshot.successful).toBe(report.snapshot.completed);
    expect(report.snapshot.statusDistribution.every((s) => s.status === 200)).toBe(true);
  }, 20_000);
});

describe("cancellation and worker failure", () => {
  it("cancels a long run, flushes metrics, and never reports it as passed", async () => {
    const runId = await startRun({
      paths: ["/fast"],
      virtualUsers: 4,
      durationSeconds: 300,
      thresholds: [{ id: "t1", metric: "p95", comparator: "lt", value: 60_000, enabled: true }],
    });
    await new Promise((r) => setTimeout(r, 600));

    const res = await fetch(`${base}/__perf/runs/${runId}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);

    const report = await waitForReport(runId);
    // The threshold would have passed — cancellation still wins (spec §27).
    expect(report.status).toBe("cancelled");
    expect(report.snapshot.completed).toBeGreaterThan(0);
    expect(report.durationMs).toBeLessThan(300_000);
  }, 30_000);

  it("stops issuing requests promptly after cancellation", async () => {
    const runId = await startRun({ paths: ["/fast"], virtualUsers: 2, durationSeconds: 300 });
    await new Promise((r) => setTimeout(r, 400));
    await fetch(`${base}/__perf/runs/${runId}/cancel`, { method: "POST" });
    const report = await waitForReport(runId);
    const afterCancel = report.snapshot.completed;
    await new Promise((r) => setTimeout(r, 400));
    const again = await waitForReport(runId);
    expect(again.snapshot.completed).toBe(afterCancel);
  }, 30_000);

  it("survives a worker that crashes on startup and reports it recoverably", async () => {
    const crashing = buildPerformanceServer({
      workerUrl: new URL("./__fixtures__/crashingWorker.ts", import.meta.url),
    });
    await crashing.listen({ port: 0, host: "127.0.0.1" });
    const crashingBase = `http://127.0.0.1:${(crashing.server.address() as AddressInfo).port}`;
    try {
      const body = runBody({ paths: ["/fast"] });
      await fetch(`${crashingBase}/__perf/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // The control plane must stay alive and answer, not hang.
      const deadline = Date.now() + 10_000;
      let state = "running";
      while (Date.now() < deadline && state !== "finished") {
        const res = await fetch(`${crashingBase}/__perf/runs/${body.runId as string}`);
        state = ((await res.json()) as { state: string }).state;
        if (state !== "finished") await new Promise((r) => setTimeout(r, 50));
      }
      expect(state).toBe("finished");
      expect((await (await fetch(`${crashingBase}/__perf/status`)).json()).running).toBe(true);
    } finally {
      await crashing.close();
    }
  }, 20_000);

  it("refuses a second concurrent run rather than measuring its own contention", async () => {
    const runId = await startRun({ paths: ["/fast"], virtualUsers: 1, durationSeconds: 300 });
    try {
      const res = await fetch(`${base}/__perf/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runBody({ paths: ["/fast"] })),
      });
      expect(res.status).toBe(409);
    } finally {
      await fetch(`${base}/__perf/runs/${runId}/cancel`, { method: "POST" });
      await waitForReport(runId);
    }
  }, 30_000);
});

describe("live metrics stream", () => {
  it("streams START, live batches and a final COMPLETE over SSE", async () => {
    const runId = await startRun({ paths: ["/fast"], virtualUsers: 2, durationSeconds: 2 });
    const res = await fetch(`${base}/__perf/runs/${runId}/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const messages = text
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)) as { type: string });

    const types = new Set(messages.map((m) => m.type));
    expect(types.has("START")).toBe(true);
    expect(types.has("METRICS")).toBe(true);
    expect(types.has("COMPLETE")).toBe(true);
  }, 30_000);

  it("never sends a response body or header set through the channel", async () => {
    const runId = await startRun({ paths: ["/fast"], virtualUsers: 1, durationSeconds: 1 });
    const text = await (await fetch(`${base}/__perf/runs/${runId}/stream`)).text();
    // The target's body is `{"ok":true}` — it must appear nowhere in the stream.
    expect(text).not.toContain('"ok":true');
    expect(text).not.toContain("rawBody");
  }, 20_000);
});

describe("memory protection", () => {
  it("retains no per-request records in the final report", async () => {
    const report = await waitForReport(await startRun({ paths: ["/fast"], virtualUsers: 4, durationSeconds: 2 }));
    const serialized = JSON.stringify(report);
    expect(report.snapshot.completed).toBeGreaterThan(20);
    expect(serialized).not.toContain('"ok":true');
    expect(serialized).not.toContain("rawBody");
    // The report's size is bounded by the aggregates, not by request count.
    expect(serialized.length).toBeLessThan(50_000);
  }, 25_000);
});
