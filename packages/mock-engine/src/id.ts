let counter = 0;

function createId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createRouteId(): string {
  return createId("route");
}

export function createScenarioId(): string {
  return createId("scenario");
}

export function createLogId(): string {
  return createId("log");
}
