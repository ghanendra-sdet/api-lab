import { describe, expect, it } from "vitest";
import { renderScenarioResponse, renderTemplate, selectActiveScenario } from "./render";
import { createScenarioFromPreset } from "./factory";
import type { MockRequestContext } from "./types";

function context(overrides: Partial<MockRequestContext> = {}): MockRequestContext {
  return {
    path: { id: "123" },
    query: { page: "2" },
    header: { "x-request-id": "abc" },
    timestamp: "2024-01-01T00:00:00.000Z",
    requestId: "req-1",
    ...overrides,
  };
}

describe("renderTemplate", () => {
  it("substitutes path, query, header, timestamp, and requestId built-ins", () => {
    const input = "{{path.id}} {{query.page}} {{header.x-request-id}} {{timestamp}} {{requestId}}";
    expect(renderTemplate(input, context())).toBe("123 2 abc 2024-01-01T00:00:00.000Z req-1");
  });

  it("leaves an unknown token as literal text rather than guessing", () => {
    expect(renderTemplate("{{path.missing}}", context())).toBe("{{path.missing}}");
    expect(renderTemplate("{{totally.unknown}}", context())).toBe("{{totally.unknown}}");
  });

  it("never evaluates the input as code", () => {
    const input = '{{path.id}}"; console.log(1); //';
    expect(renderTemplate(input, context())).toBe('123"; console.log(1); //');
  });
});

describe("renderScenarioResponse", () => {
  it("renders headers and body with template substitution", () => {
    const scenario = createScenarioFromPreset({ status: 200, name: "OK", defaultBody: '{"id": "{{path.id}}"}' });
    scenario.headers.push({ id: "h1", key: "X-Request-Id", value: "{{requestId}}", enabled: true });
    const rendered = renderScenarioResponse(scenario, context());
    expect(rendered.status).toBe(200);
    expect(rendered.body).toBe('{"id": "123"}');
    expect(rendered.headers["X-Request-Id"]).toBe("req-1");
  });

  it("skips disabled headers", () => {
    const scenario = createScenarioFromPreset({ status: 200, name: "OK", defaultBody: "{}" });
    scenario.headers.push({ id: "h1", key: "X-Disabled", value: "nope", enabled: false });
    const rendered = renderScenarioResponse(scenario, context());
    expect(rendered.headers["X-Disabled"]).toBeUndefined();
  });

  it("truncates an oversized body rather than allowing an unbounded response", () => {
    const scenario = createScenarioFromPreset({ status: 200, name: "OK", defaultBody: "x".repeat(2_000_000) });
    const rendered = renderScenarioResponse(scenario, context());
    expect(rendered.bodyTruncated).toBe(true);
    expect(rendered.body.length).toBeLessThan(2_000_000);
  });
});

describe("selectActiveScenario", () => {
  it("returns the scenario matching activeScenarioId when enabled", () => {
    const a = createScenarioFromPreset({ status: 200, name: "A", defaultBody: "{}" });
    const b = createScenarioFromPreset({ status: 500, name: "B", defaultBody: "{}" });
    const route = { scenarios: [a, b], activeScenarioId: b.id };
    expect(selectActiveScenario(route)?.id).toBe(b.id);
  });

  it("falls back to the first enabled scenario if the active one is disabled", () => {
    const a = createScenarioFromPreset({ status: 200, name: "A", defaultBody: "{}" });
    const b = createScenarioFromPreset({ status: 500, name: "B", defaultBody: "{}" }, { enabled: false });
    const route = { scenarios: [a, b], activeScenarioId: b.id };
    expect(selectActiveScenario(route)?.id).toBe(a.id);
  });
});
