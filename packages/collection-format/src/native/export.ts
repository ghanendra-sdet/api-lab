import type { EnvironmentWorkspace } from "@api-lab/environment-engine";
import type { Workspace } from "@api-lab/workspace-engine";
import { NATIVE_FORMAT_VERSION, type NativeExport } from "./schema.ts";

/**
 * The native format preserves the API Lab domain model directly — unlike
 * the Postman exporter, nothing here is translated into another system's
 * shape, so this is the most complete/lossless export API Lab can produce.
 * Deterministic: a given workspace+environments state always serializes to
 * the same JSON (no timestamps or random values are added by the export
 * itself — createdAt/updatedAt are the data's own, already-stable fields).
 */
export function exportNativeWorkspace(workspace: Workspace, environments: EnvironmentWorkspace): NativeExport {
  return {
    format: "api-lab",
    version: NATIVE_FORMAT_VERSION,
    workspace,
    environments,
  };
}
