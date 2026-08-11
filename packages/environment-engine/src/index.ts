export * from "./types.ts";
export * from "./environment.ts";
export * from "./variable.ts";
export * from "./resolver.ts";
export * from "./requestResolver.ts";
export * from "./serialize.ts";

import type { EnvironmentWorkspace } from "./types.ts";

export function createEmptyEnvironmentWorkspace(): EnvironmentWorkspace {
  return { environments: [], activeEnvironmentId: null };
}
