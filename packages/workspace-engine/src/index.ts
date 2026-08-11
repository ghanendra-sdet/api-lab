export * from "./types";
export { isFolder, isRequest, getRequestsAtLocation } from "./internal";
export * from "./collection";
export * from "./folder";
export * from "./request";
export * from "./reorder";
export * from "./serialize";

import type { Workspace } from "./types";

export function createEmptyWorkspace(): Workspace {
  return { collections: [] };
}
