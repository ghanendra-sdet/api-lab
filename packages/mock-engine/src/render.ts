import { MAX_RESPONSE_BODY_BYTES } from "./types.ts";
import type { MockRequestContext, MockScenario } from "./types.ts";

/**
 * A deliberately constrained template mechanism — never `eval`/`new
 * Function`/arbitrary expression evaluation (see spec §16-17). Only a
 * fixed, safe set of built-ins can be referenced; anything else is left as
 * literal `{{...}}` text rather than guessed at, mirroring
 * environment-engine's "never silently produce a wrong value" policy.
 */
const TEMPLATE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function resolveToken(token: string, context: MockRequestContext): string | undefined {
  if (token === "timestamp") return context.timestamp;
  if (token === "requestId") return context.requestId;

  const pathMatch = /^path\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(token);
  if (pathMatch) return context.path[pathMatch[1]!];

  const queryMatch = /^query\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(token);
  if (queryMatch) return context.query[queryMatch[1]!];

  const headerMatch = /^header\.([A-Za-z_][A-Za-z0-9_-]*)$/.exec(token);
  if (headerMatch) return context.header[headerMatch[1]!.toLowerCase()];

  return undefined;
}

export function renderTemplate(input: string, context: MockRequestContext): string {
  return input.replace(TEMPLATE, (whole, token: string) => {
    const value = resolveToken(token, context);
    return value !== undefined ? value : whole;
  });
}

export interface RenderedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
}

export function renderScenarioResponse(scenario: MockScenario, context: MockRequestContext): RenderedResponse {
  const headers: Record<string, string> = {};
  for (const h of scenario.headers) {
    if (!h.enabled || !h.key) continue;
    headers[h.key] = renderTemplate(h.value, context);
  }

  let body = renderTemplate(scenario.body, context);
  let bodyTruncated = false;
  if (Buffer.byteLength(body, "utf-8") > MAX_RESPONSE_BODY_BYTES) {
    body = body.slice(0, MAX_RESPONSE_BODY_BYTES);
    bodyTruncated = true;
  }

  return { status: scenario.status, headers, body, bodyTruncated };
}

export function selectActiveScenario(route: { scenarios: MockScenario[]; activeScenarioId: string }): MockScenario | undefined {
  return (
    route.scenarios.find((s) => s.id === route.activeScenarioId && s.enabled) ??
    route.scenarios.find((s) => s.enabled)
  );
}
