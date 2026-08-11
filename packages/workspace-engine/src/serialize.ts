import type { PersistedWorkspace, Workspace } from "./types";
import { WORKSPACE_FORMAT_VERSION } from "./types";
import { workspaceSchema } from "./schema";

export function serializeWorkspace(workspace: Workspace): PersistedWorkspace {
  return { version: WORKSPACE_FORMAT_VERSION, workspace };
}

export type DeserializeResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; reason: "invalid-envelope" | "unsupported-version" | "invalid-shape"; detail: string };

/**
 * Validates untrusted data (parsed JSON from localStorage) against the
 * workspace schema before it's ever treated as real data. Never throws —
 * every failure mode returns a typed result so the caller can recover
 * gracefully instead of crashing app startup.
 */
export function deserializeWorkspace(raw: unknown): DeserializeResult {
  if (typeof raw !== "object" || raw === null || !("version" in raw) || !("workspace" in raw)) {
    return { ok: false, reason: "invalid-envelope", detail: "Missing version or workspace field." };
  }

  const { version, workspace } = raw as { version: unknown; workspace: unknown };

  if (typeof version !== "number") {
    return { ok: false, reason: "invalid-envelope", detail: "version must be a number." };
  }

  if (version !== WORKSPACE_FORMAT_VERSION) {
    // No migrations exist yet (this is the first format version) — a
    // mismatch means either a future format this build doesn't understand,
    // or corrupted data. Both are unsafe to trust.
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `Unsupported workspace format version: ${version}.`,
    };
  }

  const parsed = workspaceSchema.safeParse(workspace);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-shape", detail: parsed.error.message };
  }

  return { ok: true, workspace: parsed.data };
}
