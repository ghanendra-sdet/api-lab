import type {
  PersistedWorkspace,
  PersistedWorkspaceRegistry,
  Workspace,
  WorkspaceRegistry,
} from "./types.ts";
import { WORKSPACE_FORMAT_VERSION, WORKSPACE_REGISTRY_FORMAT_VERSION } from "./types.ts";
import { workspaceRegistrySchema, workspaceSchema } from "./schema.ts";

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

// ---------------------------------------------------------------------------
// Workspace registry (Phase 1 of Workspace Management) — the list of
// workspaces + which one is active. Separate versioned envelope from the
// workspace data itself, same defensive pattern as above.
// ---------------------------------------------------------------------------

export function serializeWorkspaceRegistry(registry: WorkspaceRegistry): PersistedWorkspaceRegistry {
  return { version: WORKSPACE_REGISTRY_FORMAT_VERSION, registry };
}

export type DeserializeRegistryResult =
  | { ok: true; registry: WorkspaceRegistry }
  | { ok: false; reason: "invalid-envelope" | "unsupported-version" | "invalid-shape"; detail: string };

export function deserializeWorkspaceRegistry(raw: unknown): DeserializeRegistryResult {
  if (typeof raw !== "object" || raw === null || !("version" in raw) || !("registry" in raw)) {
    return { ok: false, reason: "invalid-envelope", detail: "Missing version or registry field." };
  }

  const { version, registry } = raw as { version: unknown; registry: unknown };

  if (typeof version !== "number") {
    return { ok: false, reason: "invalid-envelope", detail: "version must be a number." };
  }

  if (version !== WORKSPACE_REGISTRY_FORMAT_VERSION) {
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `Unsupported workspace registry format version: ${version}.`,
    };
  }

  const parsed = workspaceRegistrySchema.safeParse(registry);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-shape", detail: parsed.error.message };
  }

  // Defensive: activeWorkspaceId must point at a real entry, and the list
  // must never be empty — both would otherwise leave the app with no valid
  // workspace to load. Fall back rather than reject the whole registry.
  if (parsed.data.workspaces.length === 0) {
    return { ok: false, reason: "invalid-shape", detail: "Workspace registry has no workspaces." };
  }
  if (!parsed.data.workspaces.some((w) => w.id === parsed.data.activeWorkspaceId)) {
    return {
      ok: true,
      registry: { ...parsed.data, activeWorkspaceId: parsed.data.workspaces[0]!.id },
    };
  }

  return { ok: true, registry: parsed.data };
}
