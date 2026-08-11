import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMockServer } from "./server.ts";

// Real integration tests: an actual Fastify server bound to a real TCP
// port, exercised with the real global `fetch` — never `.inject()` and
// never a mocked transport (per the milestone's own explicit requirement).

let baseUrl: string;
let dataDir: string;
let close: () => Promise<void>;

async function startServer() {
  dataDir = mkdtempSync(join(tmpdir(), "mock-server-test-"));
  const app = buildMockServer({ dataFile: join(dataDir, "routes.json") });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  close = () => app.close();
}

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await close();
  rmSync(dataDir, { recursive: true, force: true });
});

afterEach(async () => {
  const routes: Array<{ id: string }> = await (await fetch(`${baseUrl}/__mock/routes`)).json();
  for (const route of routes) {
    await fetch(`${baseUrl}/__mock/routes/${route.id}`, { method: "DELETE" });
  }
  await fetch(`${baseUrl}/__mock/logs`, { method: "DELETE" });
  await fetch(`${baseUrl}/__mock/lifecycle/start`, { method: "POST" });
});

async function createRoute(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/__mock/routes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return res.json();
}

describe("mock server — admin API + real HTTP mock traffic", () => {
  it("reports status", async () => {
    const res = await fetch(`${baseUrl}/__mock/status`);
    const body = await res.json();
    expect(body.running).toBe(true);
    expect(typeof body.port).toBe("number");
  });

  it("registers a route and serves a real GET request against it", async () => {
    await createRoute({ method: "GET", path: "/users" });
    const res = await fetch(`${baseUrl}/users`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "OK" });
  });

  it("matches every supported HTTP method", async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      await createRoute({ method, path: `/m-${method.toLowerCase()}` });
      const res = await fetch(`${baseUrl}/m-${method.toLowerCase()}`, { method });
      expect(res.status, method).toBe(200);
    }
  });

  it("extracts path parameters and distinguishes /users/1 from /users/2", async () => {
    await createRoute({
      method: "GET",
      path: "/users/:id",
      scenarios: [
        {
          id: "s1",
          name: "Echo",
          status: 200,
          headers: [{ id: "h1", key: "Content-Type", value: "application/json", enabled: true }],
          bodyFormat: "json",
          body: '{"id": "{{path.id}}"}',
          delayMs: 0,
          enabled: true,
        },
      ],
      activeScenarioId: "s1",
    });
    const a = await (await fetch(`${baseUrl}/users/1`)).json();
    const b = await (await fetch(`${baseUrl}/users/2`)).json();
    expect(a).toEqual({ id: "1" });
    expect(b).toEqual({ id: "2" });
  });

  it("can inspect query parameters via template substitution", async () => {
    await createRoute({
      method: "GET",
      path: "/search",
      scenarios: [
        {
          id: "s1",
          name: "Echo",
          status: 200,
          headers: [{ id: "h1", key: "Content-Type", value: "application/json", enabled: true }],
          bodyFormat: "json",
          body: '{"page": "{{query.page}}"}',
          delayMs: 0,
          enabled: true,
        },
      ],
      activeScenarioId: "s1",
    });
    const body = await (await fetch(`${baseUrl}/search?page=2`)).json();
    expect(body).toEqual({ page: "2" });
  });

  it("returns configured status and custom headers", async () => {
    const route = await createRoute({
      method: "GET",
      path: "/created",
      scenarios: [
        {
          id: "s1",
          name: "Created",
          status: 201,
          headers: [{ id: "h1", key: "X-Request-Id", value: "mock-123", enabled: true }],
          bodyFormat: "json",
          body: "{}",
          delayMs: 0,
          enabled: true,
        },
      ],
      activeScenarioId: "s1",
    });
    const res = await fetch(`${baseUrl}/created`);
    expect(res.status).toBe(201);
    expect(res.headers.get("x-request-id")).toBe("mock-123");
    expect(route.path).toBe("/created");
    // A custom header is only useful to a real browser client if it's also
    // exposed via CORS — fetch() hides non-safelisted response headers
    // otherwise (regression: this was missing initially).
    expect(res.headers.get("access-control-expose-headers")).toBeTruthy();
  });

  it("switches the active scenario without a restart", async () => {
    const route = await createRoute({
      method: "GET",
      path: "/toggle",
      scenarios: [
        { id: "ok", name: "OK", status: 200, headers: [], bodyFormat: "json", body: "{}", delayMs: 0, enabled: true },
        { id: "bad", name: "Unauthorized", status: 401, headers: [], bodyFormat: "json", body: "{}", delayMs: 0, enabled: true },
      ],
      activeScenarioId: "ok",
    });

    expect((await fetch(`${baseUrl}/toggle`)).status).toBe(200);

    await fetch(`${baseUrl}/__mock/routes/${route.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeScenarioId: "bad" }),
    });

    expect((await fetch(`${baseUrl}/toggle`)).status).toBe(401);
  });

  it("respects a configured delay (approximately, no fragile exact timing)", async () => {
    await createRoute({
      method: "GET",
      path: "/slow",
      scenarios: [
        { id: "s1", name: "Slow", status: 200, headers: [], bodyFormat: "json", body: "{}", delayMs: 150, enabled: true },
      ],
      activeScenarioId: "s1",
    });
    const start = Date.now();
    await fetch(`${baseUrl}/slow`);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(120);
  });

  it("returns a deterministic 404 for an unmatched route without crashing", async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Mock route not found");
    const stillUp = await fetch(`${baseUrl}/__mock/status`);
    expect(stillUp.status).toBe(200);
  });

  it("disabled routes do not match", async () => {
    const route = await createRoute({ method: "GET", path: "/disabled-me" });
    expect((await fetch(`${baseUrl}/disabled-me`)).status).toBe(200);

    await fetch(`${baseUrl}/__mock/routes/${route.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    expect((await fetch(`${baseUrl}/disabled-me`)).status).toBe(404);
  });

  it("prefers a static route over a parameterized one on conflict", async () => {
    await createRoute({
      method: "GET",
      path: "/users/:id",
      scenarios: [{ id: "s1", name: "Param", status: 200, headers: [], bodyFormat: "json", body: '{"kind":"param"}', delayMs: 0, enabled: true }],
      activeScenarioId: "s1",
    });
    await createRoute({
      method: "GET",
      path: "/users/list",
      scenarios: [{ id: "s1", name: "Static", status: 200, headers: [], bodyFormat: "json", body: '{"kind":"static"}', delayMs: 0, enabled: true }],
      activeScenarioId: "s1",
    });
    const body = await (await fetch(`${baseUrl}/users/list`)).json();
    expect(body.kind).toBe("static");
  });

  it("records request logs with method/path/status/duration and never the Authorization header", async () => {
    await createRoute({ method: "GET", path: "/logged" });
    await fetch(`${baseUrl}/logged`, { headers: { Authorization: "Bearer super-secret" } });

    const logs = await (await fetch(`${baseUrl}/__mock/logs`)).json();
    expect(logs[0]).toMatchObject({ method: "GET", path: "/logged", status: 200, matched: true });
    expect(JSON.stringify(logs)).not.toContain("super-secret");
  });

  it("stopping the server makes it respond 503 instead of serving mocks, and starting it resumes", async () => {
    await createRoute({ method: "GET", path: "/lifecycle" });
    await fetch(`${baseUrl}/__mock/lifecycle/stop`, { method: "POST" });

    const stoppedRes = await fetch(`${baseUrl}/lifecycle`);
    expect(stoppedRes.status).toBe(503);

    await fetch(`${baseUrl}/__mock/lifecycle/start`, { method: "POST" });
    const resumedRes = await fetch(`${baseUrl}/lifecycle`);
    expect(resumedRes.status).toBe(200);
  });

  it("rejects an unsafe/invalid path at creation time", async () => {
    const res = await fetch(`${baseUrl}/__mock/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "GET", path: "/users/(.*)" }),
    });
    expect(res.status).toBe(400);
  });

  it("real CORS preflight (OPTIONS) succeeds even without a configured OPTIONS mock route", async () => {
    const res = await fetch(`${baseUrl}/anything`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});
