import type { HttpMethod } from "@api-lab/shared";
import { createRouteId, createScenarioId } from "./id.ts";
import type { MockRoute, MockScenario, StatusPreset } from "./types.ts";

export function createScenarioFromPreset(preset: StatusPreset, overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    id: createScenarioId(),
    name: preset.name,
    status: preset.status,
    headers: [{ id: createScenarioId(), key: "Content-Type", value: "application/json", enabled: true }],
    bodyFormat: "json",
    body: preset.defaultBody,
    delayMs: 0,
    enabled: true,
    ...overrides,
  };
}

export function createDefaultRoute(method: HttpMethod = "GET", path = "/"): MockRoute {
  const now = new Date().toISOString();
  const scenario = createScenarioFromPreset({ status: 200, name: "200 Success", defaultBody: '{\n  "message": "OK"\n}' });
  return {
    id: createRouteId(),
    method,
    path,
    enabled: true,
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    createdAt: now,
    updatedAt: now,
  };
}
