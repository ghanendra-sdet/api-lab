export * from "./types.ts";
export { isFolder, isRequest, getRequestsAtLocation } from "./internal.ts";
export * from "./collection.ts";
export * from "./folder.ts";
export * from "./request.ts";
export * from "./reorder.ts";
export * from "./serialize.ts";
export * from "./dependencyGraph.ts";

import type { Workspace } from "./types.ts";

export function createEmptyWorkspace(): Workspace {
  return { collections: [] };
}
