import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { HTTP_METHODS, type HttpMethod } from "@api-lab/shared";
import {
  MAX_REQUEST_BODY_BYTES,
  createRouteId,
  createScenarioId,
  isValidMockPath,
  matchRoute,
  mockRouteSchema,
  renderScenarioResponse,
  selectActiveScenario,
  type MockRequestContext,
  type MockRoute,
} from "@api-lab/mock-engine";
import { RouteStore } from "./store.ts";
import { RequestLog } from "./logs.ts";
import { registerSecurityFixtures } from "./securityFixtures.ts";

export interface MockServerOptions {
  dataFile: string;
  /** CORS origin policy — see docs/SECURITY.md's Mock Server CORS section.
   * Defaults to reflecting the request origin with no credentials support,
   * which is safe (not `Access-Control-Allow-Origin: *` with credentials). */
  corsOrigin?: string | boolean;
}

const HEADER_DENYLIST = new Set(["authorization", "cookie"]);

function flattenQuery(query: unknown): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!query || typeof query !== "object") return result;
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      result[key] = String(value[0] ?? "");
    } else if (value !== undefined) {
      result[key] = String(value);
    }
  }
  return result;
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildMockServer(options: MockServerOptions): FastifyInstance {
  const store = new RouteStore(options.dataFile);
  const log = new RequestLog();
  let serving = true;
  const startedAt = Date.now();

  const app = Fastify({ bodyLimit: MAX_REQUEST_BODY_BYTES, logger: false });

  // CORS is applied by hand (a plain onRequest hook) rather than via a
  // plugin — API Lab's browser requests only ever need simple, credential-
  // free cross-origin access, and reflecting the request origin with
  // `credentials: false` is a safe default (see docs/SECURITY.md's Mock
  // Server CORS section): never `Access-Control-Allow-Origin: *` combined
  // with credentialed requests, which is the actual CORS footgun.
  const corsOrigin = options.corsOrigin ?? true;
  app.addHook("onRequest", async (request, reply) => {
    const originHeader = request.headers.origin;
    const allowOrigin = corsOrigin === true ? (originHeader ?? "*") : String(corsOrigin);
    reply.header("Access-Control-Allow-Origin", allowOrigin);
    reply.header("Access-Control-Allow-Methods", [...HTTP_METHODS].join(", "));
    reply.header("Access-Control-Allow-Headers", "*");
    // Without this, browser fetch() can only read the small CORS-safelisted
    // header set — a configured custom mock header (or the request logging
    // UI reading it back) would silently appear missing, not just unmasked.
    reply.header("Access-Control-Expose-Headers", "*");
    reply.header("Vary", "Origin");
  });

  // ---- Admin API (prefixed /__mock, never matched as a mock route itself) ----

  app.get("/__mock/status", async () => ({
    running: serving,
    port: (app.server.address() as { port?: number } | null)?.port ?? null,
    routes: store.list().length,
    uptimeMs: Date.now() - startedAt,
  }));

  app.post("/__mock/lifecycle/start", async () => {
    serving = true;
    return { running: serving };
  });

  app.post("/__mock/lifecycle/stop", async () => {
    serving = false;
    return { running: serving };
  });

  app.get("/__mock/routes", async () => store.list());

  app.post("/__mock/routes", async (request, reply) => {
    const body = request.body as Partial<MockRoute> | undefined;
    if (!body || !body.method || !body.path) {
      return reply.status(400).send({ error: "method and path are required" });
    }
    if (!HTTP_METHODS.includes(body.method as HttpMethod)) {
      return reply.status(400).send({ error: `Unsupported method: ${String(body.method)}` });
    }
    if (!isValidMockPath(body.path)) {
      return reply.status(400).send({ error: "Invalid path — use literal segments and :param placeholders only" });
    }
    const now = new Date().toISOString();
    const candidate: MockRoute = {
      id: createRouteId(),
      method: body.method as HttpMethod,
      path: body.path,
      enabled: body.enabled ?? true,
      scenarios: body.scenarios?.length
        ? body.scenarios
        : [
            {
              id: createScenarioId(),
              name: "200 Success",
              status: 200,
              headers: [{ id: createScenarioId(), key: "Content-Type", value: "application/json", enabled: true }],
              bodyFormat: "json",
              body: '{\n  "message": "OK"\n}',
              delayMs: 0,
              enabled: true,
            },
          ],
      activeScenarioId: body.activeScenarioId ?? "",
      createdAt: now,
      updatedAt: now,
    };
    if (!candidate.activeScenarioId) candidate.activeScenarioId = candidate.scenarios[0]!.id;

    const parsed = mockRouteSchema.safeParse(candidate);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const result = store.create(parsed.data);
    if (!result.ok) return reply.status(400).send({ error: result.error });
    return reply.status(201).send(result.route);
  });

  app.put<{ Params: { id: string } }>("/__mock/routes/:id", async (request, reply) => {
    const existing = store.get(request.params.id);
    if (!existing) return reply.status(404).send({ error: "Route not found" });

    const patch = request.body as Partial<MockRoute>;
    if (patch.path !== undefined && !isValidMockPath(patch.path)) {
      return reply.status(400).send({ error: "Invalid path — use literal segments and :param placeholders only" });
    }
    const merged = { ...existing, ...patch };
    const parsed = mockRouteSchema.safeParse(merged);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });

    const updated = store.update(request.params.id, parsed.data);
    return reply.send(updated);
  });

  app.delete<{ Params: { id: string } }>("/__mock/routes/:id", async (request, reply) => {
    const removed = store.remove(request.params.id);
    if (!removed) return reply.status(404).send({ error: "Route not found" });
    return reply.status(204).send();
  });

  app.get("/__mock/logs", async () => log.list());
  app.delete("/__mock/logs", async () => {
    log.clear();
    return { ok: true };
  });

  // ---- Security fixtures (Milestone 12) ----
  //
  // Registered before the catch-all so Fastify's router prefers these exact
  // paths. Namespaced under /__security for the same reason the admin API
  // uses /__mock: a user's own mock route must never be shadowed by a
  // built-in fixture. See securityFixtures.ts for why these are canned
  // responses rather than a genuinely vulnerable application.
  registerSecurityFixtures(app);

  // ---- Mock traffic — everything else, matched against the active routes ----

  app.route({
    method: [...HTTP_METHODS],
    url: "/*",
    handler: async (request, reply) => {
      const start = Date.now();
      const path = request.url.split("?")[0]!;
      const method = request.method as HttpMethod;

      if (!serving) {
        const duration = Date.now() - start;
        log.add({ timestamp: new Date().toISOString(), method, path, status: 503, durationMs: duration, matched: false });
        return reply.status(503).send({ error: "Mock server stopped" });
      }

      const match = matchRoute(store.list(), method, path);
      if (!match) {
        // An unmatched OPTIONS request is treated as an ordinary CORS
        // preflight, not a 404 — @fastify/cors's onRequest hook has
        // already set the Access-Control-* headers on this response; a
        // real browser cross-origin request must see 2xx here regardless
        // of whether the user configured an explicit OPTIONS mock route.
        if (method === "OPTIONS") {
          const duration = Date.now() - start;
          log.add({ timestamp: new Date().toISOString(), method, path, status: 204, durationMs: duration, matched: false });
          return reply.status(204).send();
        }
        const duration = Date.now() - start;
        log.add({ timestamp: new Date().toISOString(), method, path, status: 404, durationMs: duration, matched: false });
        return reply.status(404).send({ error: "Mock route not found" });
      }

      const scenario = selectActiveScenario(match.route);
      if (!scenario) {
        const duration = Date.now() - start;
        log.add({ timestamp: new Date().toISOString(), method, path, status: 404, durationMs: duration, matched: false });
        return reply.status(404).send({ error: "Mock route has no active scenario" });
      }

      const context: MockRequestContext = {
        path: match.params,
        query: flattenQuery(request.query),
        header: flattenHeaders(request.headers as Record<string, string | string[] | undefined>),
        timestamp: new Date().toISOString(),
        requestId: randomUUID(),
      };

      if (scenario.delayMs > 0) await sleep(scenario.delayMs);

      const rendered = renderScenarioResponse(scenario, context);
      for (const [key, value] of Object.entries(rendered.headers)) {
        reply.header(key, value);
      }
      if (!rendered.headers["Content-Type"] && !rendered.headers["content-type"]) {
        reply.header("Content-Type", scenario.bodyFormat === "json" ? "application/json" : "text/plain");
      }

      const duration = Date.now() - start;
      log.add({ timestamp: new Date().toISOString(), method, path, status: rendered.status, durationMs: duration, matched: true });

      return reply.status(rendered.status).send(rendered.body);
    },
  });

  return app;
}

// Never log the request body or an Authorization/Cookie header anywhere in
// this file — HEADER_DENYLIST documents the two headers request inspection
// (a future UI feature) must always mask, even though nothing here reads
// them into a log today.
export { HEADER_DENYLIST };
