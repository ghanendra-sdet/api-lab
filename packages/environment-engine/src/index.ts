export * from "./types";
export * from "./environment";
export * from "./variable";
export * from "./resolver";
export * from "./requestResolver";
export * from "./serialize";

import type { EnvironmentWorkspace } from "./types";

export function createEmptyEnvironmentWorkspace(): EnvironmentWorkspace {
  return { environments: [], activeEnvironmentId: null };
}
