import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MAX_DURATION_SECONDS,
  MAX_RAMP_UP_SECONDS,
  MAX_REQUESTS_PER_ITERATION,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_TARGET_RPS,
  MAX_THINK_TIME_MS,
  MAX_TOTAL_REQUESTS,
  MAX_VIRTUAL_USERS,
  PERF_COMPARATORS,
  PERF_LOAD_MODELS,
  PERF_METRICS,
  PERF_TARGET_KINDS,
  perfRequestSpecSchema,
  validateTargetUrl,
  type PerfOutboundMessage,
  type PerfRunRequest,
} from "@api-lab/performance-engine";
import { HTTP_METHODS } from "@api-lab/shared";
import { RunManager, type RunMeta } from "./runManager.ts";

export interface PerformanceServerOptions {
  workerUrl: URL;
  corsOrigin?: string | boolean;
  /** Concurrent runs allowed by this process. One is the sensible default:
   * two simultaneous load tests on one machine measure each other's
   * contention, not the system under test. */
  maxConcurrentRuns?: number;
}

/**
 * The run request accepted over HTTP. Validated here, independently of the
 * browser: this port is reachable by anything on the machine, so the
 * control plane never assumes the UI already enforced the safety limits
 * (spec §24, §37). Every bound in this schema mirrors a constant exported
 * by `@api-lab/performance-engine`, so the UI and the server can never
 * disagree about what is allowed.
 */
const startRunSchema = z.object({
  runId: z.string().min(1).max(128),
  requests: z.array(perfRequestSpecSchema).min(1).max(MAX_REQUESTS_PER_ITERATION),
  virtualUsers: z.number().int().min(1).max(MAX_VIRTUAL_USERS),
  durationSeconds: z.number().int().min(1).max(MAX_DURATION_SECONDS),
  rampUpSeconds: z.number().int().min(0).max(MAX_RAMP_UP_SECONDS),
  loadModel: z.enum(PERF_LOAD_MODELS),
  targetRps: z.number().int().min(1).max(MAX_TARGET_RPS),
  requestTimeoutMs: z.number().int().min(1).max(MAX_REQUEST_TIMEOUT_MS),
  thinkTimeMs: z.number().int().min(0).max(MAX_THINK_TIME_MS),
  meta: z.object({
    targetName: z.string().max(200),
    targetKind: z.enum(PERF_TARGET_KINDS),
    environmentName: z.string().max(200).nullable(),
    loadModel: z.enum(PERF_LOAD_MODELS),
    thresholds: z
      .array(
        z.object({
          id: z.string(),
          metric: z.enum(PERF_METRICS),
          comparator: z.enum(PERF_COMPARATORS),
          value: z.number().finite().min(0),
          enabled: z.boolean(),
        }),
      )
      .max(20),
  }),
});

export function buildPerformanceServer(options: PerformanceServerOptions): FastifyInstance {
  const manager = new RunManager(options.workerUrl);
  const maxConcurrentRuns = options.maxConcurrentRuns ?? 1;
  const startedAt = Date.now();

  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });

  // Same hand-rolled, credential-free CORS policy as apps/mock-server —
  // reflecting the request origin without `Access-Control-Allow-Credentials`
  // (see docs/SECURITY.md). The browser UI is the only intended client.
  const corsOrigin = options.corsOrigin ?? true;
  app.addHook("onRequest", async (request, reply) => {
    const originHeader = request.headers.origin;
    reply.header("Access-Control-Allow-Origin", corsOrigin === true ? (originHeader ?? "*") : String(corsOrigin));
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "*");
    reply.header("Vary", "Origin");
  });

  app.options("/*", async (_request, reply) => reply.status(204).send());

  app.get("/__perf/status", async () => ({
    running: true,
    activeRuns: manager.activeCount,
    maxConcurrentRuns,
    uptimeMs: Date.now() - startedAt,
    limits: {
      maxVirtualUsers: MAX_VIRTUAL_USERS,
      maxDurationSeconds: MAX_DURATION_SECONDS,
      maxTotalRequests: MAX_TOTAL_REQUESTS,
      maxRequestsPerIteration: MAX_REQUESTS_PER_ITERATION,
      maxTargetRps: MAX_TARGET_RPS,
    },
  }));

  app.post("/__perf/runs", async (request, reply) => {
    const parsed = startRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid run request." });
    }
    const body = parsed.data;

    if (manager.activeCount >= maxConcurrentRuns) {
      return reply.status(409).send({
        error: "A performance run is already in progress. Stop it before starting another.",
      });
    }
    if (manager.get(body.runId)) {
      return reply.status(409).send({ error: "That run id has already been used." });
    }

    // Target safety (spec §37, §38): every URL must be an explicit,
    // absolute http(s) target supplied by the caller. There is no discovery,
    // no scanning, and no expansion of hosts, ports, or ranges anywhere in
    // this process — a run only ever touches exactly these URLs.
    for (const spec of body.requests) {
      const urlError = validateTargetUrl(spec.url);
      if (urlError) return reply.status(400).send({ error: urlError });
      if (!HTTP_METHODS.includes(spec.method as (typeof HTTP_METHODS)[number])) {
        return reply.status(400).send({ error: `Unsupported HTTP method: ${spec.method}` });
      }
    }

    if (body.rampUpSeconds >= body.durationSeconds) {
      return reply.status(400).send({ error: "Ramp-up must be shorter than the total duration." });
    }

    const runRequest: PerfRunRequest = {
      runId: body.runId,
      requests: body.requests as PerfRunRequest["requests"],
      virtualUsers: body.virtualUsers,
      durationSeconds: body.durationSeconds,
      rampUpSeconds: body.rampUpSeconds,
      loadModel: body.loadModel,
      targetRps: body.targetRps,
      requestTimeoutMs: body.requestTimeoutMs,
      thinkTimeMs: body.thinkTimeMs,
      maxTotalRequests: MAX_TOTAL_REQUESTS,
    };

    const meta: RunMeta = {
      targetName: body.meta.targetName,
      targetKind: body.meta.targetKind,
      environmentName: body.meta.environmentName,
      loadModel: body.meta.loadModel,
      thresholds: body.meta.thresholds,
    };

    manager.start(runRequest, meta);
    return reply.status(201).send({ runId: body.runId });
  });

  /**
   * Live metrics stream (spec §22, §26). Server-Sent Events rather than a
   * WebSocket: the channel is strictly one-way (worker → UI), SSE
   * reconnects on its own, and it needs no extra dependency — Fastify can
   * write the stream directly. Cancellation travels the other way as an
   * ordinary POST, so no bidirectional transport is required at all.
   */
  app.get<{ Params: { id: string } }>("/__perf/runs/:id/stream", (request, reply) => {
    const run = manager.get(request.params.id);
    if (!run) {
      void reply.status(404).send({ error: "Run not found" });
      return;
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": reply.getHeader("Access-Control-Allow-Origin")?.toString() ?? "*",
      "X-Accel-Buffering": "no",
    });

    const send = (message: PerfOutboundMessage) => {
      reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);
      if (message.type === "COMPLETE") reply.raw.end();
    };

    // A client that subscribes after the run already finished still gets the
    // outcome immediately instead of waiting for an event that will never
    // come — this is what makes the UI robust to a slow first render.
    if (run.state === "finished") {
      if (run.report) send({ type: "COMPLETE", runId: run.id, report: run.report });
      else reply.raw.end();
      return;
    }

    const unsubscribe = manager.subscribe(request.params.id, send);
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.post<{ Params: { id: string } }>("/__perf/runs/:id/cancel", async (request, reply) => {
    const run = manager.get(request.params.id);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    const cancelled = manager.cancel(request.params.id);
    return reply.send({ cancelled, status: run.state });
  });

  app.get<{ Params: { id: string } }>("/__perf/runs/:id", async (request, reply) => {
    const run = manager.get(request.params.id);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    return reply.send({ runId: run.id, state: run.state, report: run.report });
  });

  app.addHook("onClose", async () => {
    await manager.shutdown();
  });

  return app;
}

/** Exposed for the integration tests, which drive a manager directly
 * without going through HTTP. */
export { RunManager };
