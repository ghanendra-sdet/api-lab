import type { EnvironmentWorkspace, PersistedEnvironments } from "./types.ts";
import { ENVIRONMENT_FORMAT_VERSION } from "./types.ts";
import { environmentWorkspaceSchema } from "./schema.ts";

export function serializeEnvironments(data: EnvironmentWorkspace): PersistedEnvironments {
  return { version: ENVIRONMENT_FORMAT_VERSION, data };
}

export type DeserializeResult =
  | { ok: true; data: EnvironmentWorkspace }
  | { ok: false; reason: "invalid-envelope" | "unsupported-version" | "invalid-shape"; detail: string };

/**
 * Validates untrusted data (parsed JSON from localStorage) against the
 * environment schema before it's ever treated as real data. Never throws —
 * mirrors workspace-engine's deserializeWorkspace so the two persistence
 * boundaries fail exactly the same way.
 */
export function deserializeEnvironments(raw: unknown): DeserializeResult {
  if (typeof raw !== "object" || raw === null || !("version" in raw) || !("data" in raw)) {
    return { ok: false, reason: "invalid-envelope", detail: "Missing version or data field." };
  }

  const { version, data } = raw as { version: unknown; data: unknown };

  if (typeof version !== "number") {
    return { ok: false, reason: "invalid-envelope", detail: "version must be a number." };
  }

  if (version !== ENVIRONMENT_FORMAT_VERSION) {
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `Unsupported environment format version: ${version}.`,
    };
  }

  const parsed = environmentWorkspaceSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-shape", detail: parsed.error.message };
  }

  return { ok: true, data: parsed.data };
}
