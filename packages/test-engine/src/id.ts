let counter = 0;

export function createAssertionId(): string {
  counter += 1;
  return `assertion_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}
