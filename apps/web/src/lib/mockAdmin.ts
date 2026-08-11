import type { MockRoute, RequestLogEntry } from "@api-lab/mock-engine";

/**
 * A thin fetch client for the mock server's admin HTTP API — the browser
 * cannot itself open a listening port (see docs/ARCHITECTURE.md's
 * Milestone 9 section), so "managing" the mock server from API Lab always
 * means talking to an already-running `apps/mock-server` process over
 * HTTP, never spawning or embedding it.
 */

export interface MockServerStatus {
  running: boolean;
  port: number | null;
  routes: number;
  uptimeMs: number;
}

export class MockAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockAdminError";
  }
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new MockAdminError(`Could not reach the mock server at ${baseUrl}. Is it running?`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new MockAdminError(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getStatus(baseUrl: string): Promise<MockServerStatus> {
  return request(baseUrl, "/__mock/status");
}

export function startServer(baseUrl: string): Promise<{ running: boolean }> {
  return request(baseUrl, "/__mock/lifecycle/start", { method: "POST" });
}

export function stopServer(baseUrl: string): Promise<{ running: boolean }> {
  return request(baseUrl, "/__mock/lifecycle/stop", { method: "POST" });
}

export function listRoutes(baseUrl: string): Promise<MockRoute[]> {
  return request(baseUrl, "/__mock/routes");
}

export function createRoute(baseUrl: string, route: Partial<MockRoute>): Promise<MockRoute> {
  return request(baseUrl, "/__mock/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(route),
  });
}

export function updateRoute(baseUrl: string, id: string, patch: Partial<MockRoute>): Promise<MockRoute> {
  return request(baseUrl, `/__mock/routes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function deleteRoute(baseUrl: string, id: string): Promise<void> {
  return request(baseUrl, `/__mock/routes/${id}`, { method: "DELETE" });
}

export function listLogs(baseUrl: string): Promise<RequestLogEntry[]> {
  return request(baseUrl, "/__mock/logs");
}
