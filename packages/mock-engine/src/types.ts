import type { HttpMethod } from "@api-lab/shared";

/** Resource limits — see docs/SECURITY.md's Mock Server section for the reasoning. */
export const MAX_DELAY_MS = 30_000;
export const MAX_RESPONSE_BODY_BYTES = 1_000_000; // 1MB
export const MAX_REQUEST_BODY_BYTES = 1_000_000; // 1MB
export const MAX_LOG_ENTRIES = 200;
export const MAX_ROUTES = 500;

export const MOCK_BODY_FORMATS = ["json", "text"] as const;
export type MockBodyFormat = (typeof MOCK_BODY_FORMATS)[number];

/** A single response variant for a route. Only one scenario is "active" at
 * a time per route (`MockRoute.activeScenarioId`); switching which one is
 * active changes the live server's behavior immediately — no restart. */
export interface MockScenario {
  id: string;
  name: string;
  status: number;
  headers: Array<{ id: string; key: string; value: string; enabled: boolean }>;
  bodyFormat: MockBodyFormat;
  body: string;
  /** Artificial response delay in ms, clamped to [0, MAX_DELAY_MS]. */
  delayMs: number;
  enabled: boolean;
}

/**
 * A mock endpoint. `path` uses a deterministic `:param` segment syntax
 * (e.g. `/users/:id`) — never a user-supplied regular expression (see
 * docs/SECURITY.md: unbounded/attacker-crafted regex is a ReDoS risk this
 * engine specifically avoids by construction, not by review).
 */
export interface MockRoute {
  id: string;
  method: HttpMethod;
  path: string;
  enabled: boolean;
  scenarios: MockScenario[];
  activeScenarioId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  matched: boolean;
}

/** A safe, deterministic context response templates may read from — never
 * arbitrary browser/environment variables (see docs/SECURITY.md). */
export interface MockRequestContext {
  path: Record<string, string>;
  query: Record<string, string>;
  header: Record<string, string>;
  timestamp: string;
  requestId: string;
}

export interface StatusPreset {
  status: number;
  name: string;
  defaultBody: string;
}

/** Presets are convenience starting points, not hardcoded routes — the
 * user can freely edit status/headers/body after picking one (see spec §13). */
export const STATUS_PRESETS: StatusPreset[] = [
  { status: 200, name: "200 Success", defaultBody: '{\n  "message": "OK"\n}' },
  { status: 201, name: "201 Created", defaultBody: '{\n  "id": 1\n}' },
  { status: 202, name: "202 Accepted", defaultBody: '{\n  "message": "Accepted"\n}' },
  { status: 204, name: "204 No Content", defaultBody: "" },
  { status: 400, name: "400 Bad Request", defaultBody: '{\n  "error": "Bad Request"\n}' },
  { status: 401, name: "401 Unauthorized", defaultBody: '{\n  "error": "Unauthorized"\n}' },
  { status: 403, name: "403 Forbidden", defaultBody: '{\n  "error": "Forbidden"\n}' },
  { status: 404, name: "404 Not Found", defaultBody: '{\n  "error": "Not Found"\n}' },
  { status: 409, name: "409 Conflict", defaultBody: '{\n  "error": "Conflict"\n}' },
  { status: 422, name: "422 Validation Error", defaultBody: '{\n  "error": "Validation Error"\n}' },
  { status: 429, name: "429 Rate Limited", defaultBody: '{\n  "error": "Too Many Requests"\n}' },
  { status: 500, name: "500 Server Error", defaultBody: '{\n  "error": "Internal Server Error"\n}' },
  { status: 502, name: "502 Bad Gateway", defaultBody: '{\n  "error": "Bad Gateway"\n}' },
  { status: 503, name: "503 Service Unavailable", defaultBody: '{\n  "error": "Service Unavailable"\n}' },
  { status: 504, name: "504 Gateway Timeout", defaultBody: '{\n  "error": "Gateway Timeout"\n}' },
];
