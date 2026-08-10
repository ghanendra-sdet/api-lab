let counter = 0;

/** Deterministic-enough id generator for UI-only rows/tabs in Milestone 1. */
export function createId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}
