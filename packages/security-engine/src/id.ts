let counter = 0;

function createId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createNegativeTestId(): string {
  return createId("negtest");
}

export function createSecurityRunId(): string {
  return createId("secrun");
}
