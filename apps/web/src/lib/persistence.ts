import {
  deserializeWorkspace,
  deserializeWorkspaceRegistry,
  serializeWorkspace,
  serializeWorkspaceRegistry,
  type Workspace,
  type WorkspaceRegistry,
} from "@api-lab/workspace-engine";
import {
  deserializeEnvironments,
  serializeEnvironments,
  type EnvironmentWorkspace,
  type Variable,
} from "@api-lab/environment-engine";
import type { RequestTabState, HistoryItem, RunnerRunHistoryItem } from "../types";
import { debounce } from "./debounce";
import { z } from "zod";

const HISTORY_KEY = "api-lab-request-history";
const WORKSPACE_KEY = "api-lab-workspace";
const WORKSPACE_REGISTRY_KEY = "api-lab-workspace-registry";
const TABS_KEY = "api-lab-tabs";
const ENVIRONMENTS_KEY = "api-lab-environments";
const GLOBALS_KEY = "api-lab-globals";
const GLOBALS_FORMAT_VERSION = 1;
const DEBOUNCE_MS = 400;

/**
 * The id of the one workspace that exists before Workspace Management
 * (Phase 1) ships. Its persisted data lives at the pre-existing WORKSPACE_KEY
 * — never rewritten, never duplicated, just referenced by the new registry.
 * See workspaceStorageKey below and loadWorkspaceRegistryFromStorage's
 * migration path.
 */
export const LEGACY_WORKSPACE_ID = "default";

/** Where a given workspace's `Workspace{collections}` blob is stored. The
 * legacy/default workspace keeps using the original single-workspace key
 * (zero-data-loss migration); every workspace created afterwards gets its
 * own dedicated key. */
export function workspaceStorageKey(workspaceId: string): string {
  return workspaceId === LEGACY_WORKSPACE_ID ? WORKSPACE_KEY : `api-lab-workspace-${workspaceId}`;
}

// ---------------------------------------------------------------------------
// Workspace (collections/folders/requests) — the important, must-be-correct
// data. Strictly validated against the versioned schema before it's trusted;
// see @api-lab/workspace-engine's deserializeWorkspace. Each workspace in the
// registry (see below) has its own independent blob, keyed by
// workspaceStorageKey(workspaceId).
// ---------------------------------------------------------------------------

export type LoadWorkspaceResult =
  | { status: "empty" }
  | { status: "ok"; workspace: Workspace }
  | { status: "error"; detail: string };

export function loadWorkspaceFromStorage(workspaceId: string): LoadWorkspaceResult {
  if (typeof window === "undefined") return { status: "empty" };
  const raw = window.localStorage.getItem(workspaceStorageKey(workspaceId));
  if (raw === null) return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", detail: "Saved workspace data is not valid JSON." };
  }

  const result = deserializeWorkspace(parsed);
  if (!result.ok) return { status: "error", detail: result.detail };
  return { status: "ok", workspace: result.workspace };
}

function writeWorkspaceNow(workspaceId: string, workspace: Workspace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(workspaceStorageKey(workspaceId), JSON.stringify(serializeWorkspace(workspace)));
  } catch {
    // Storage full or unavailable (private browsing, quota exceeded) — the
    // in-memory workspace is still correct, it just won't survive a reload.
    // Not worth surfacing as an error interrupting the user's work.
  }
}

export const saveWorkspaceToStorage = debounce(writeWorkspaceNow, DEBOUNCE_MS);

/**
 * Writes immediately, bypassing the debounce. Callers must use this — never
 * the debounced saveWorkspaceToStorage — right before switching the active
 * workspace: the debounced writer is a single shared timer keyed by nothing,
 * so a pending write for workspace A followed immediately by a debounced
 * write for workspace B would cancel A's write, silently dropping A's last
 * edit. Flushing synchronously first closes that race.
 */
export function flushWorkspaceToStorage(workspaceId: string, workspace: Workspace): void {
  writeWorkspaceNow(workspaceId, workspace);
}

export function resetWorkspaceStorage(workspaceId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(workspaceStorageKey(workspaceId));
}

// ---------------------------------------------------------------------------
// Workspace registry (Phase 1 of Workspace Management) — the list of
// workspaces + which one is active. A dedicated versioned envelope, separate
// from any individual workspace's data.
//
// Migration: the very first time this key is read and found missing, a
// registry is synthesized in memory with exactly one entry — id
// LEGACY_WORKSPACE_ID, name "My Workspace" — and written out. Its data blob
// is never touched: workspaceStorageKey(LEGACY_WORKSPACE_ID) resolves to the
// original WORKSPACE_KEY, so whatever was already there (a real user's
// collections, or nothing for a brand-new install) becomes that workspace's
// data by reference, not by copy. Zero risk of duplication or loss.
// ---------------------------------------------------------------------------

function createDefaultRegistry(): WorkspaceRegistry {
  const now = new Date().toISOString();
  return {
    workspaces: [{ id: LEGACY_WORKSPACE_ID, name: "My Workspace", createdAt: now, updatedAt: now }],
    activeWorkspaceId: LEGACY_WORKSPACE_ID,
  };
}

function writeWorkspaceRegistryNow(registry: WorkspaceRegistry): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_REGISTRY_KEY, JSON.stringify(serializeWorkspaceRegistry(registry)));
  } catch {
    // Non-fatal, same reasoning as writeWorkspaceNow.
  }
}

export const saveWorkspaceRegistryToStorage = debounce(writeWorkspaceRegistryNow, DEBOUNCE_MS);

/** Immediate, non-debounced write — see flushWorkspaceToStorage's reasoning;
 * the same race applies to the registry's activeWorkspaceId. */
export function flushWorkspaceRegistryToStorage(registry: WorkspaceRegistry): void {
  writeWorkspaceRegistryNow(registry);
}

export type LoadWorkspaceRegistryResult =
  | { status: "ok"; registry: WorkspaceRegistry; migrated: boolean }
  | { status: "error"; detail: string; fallback: WorkspaceRegistry };

/**
 * Loads the workspace registry, migrating a pre-Phase-1 single-workspace
 * install on first read. Never mutates the legacy WORKSPACE_KEY blob itself.
 * On a corrupted registry blob, returns an in-memory fallback registry
 * (still pointing at LEGACY_WORKSPACE_ID, so the app keeps working) without
 * overwriting the unreadable stored key — same "don't clobber possibly-
 * recoverable data" policy as loadWorkspaceFromStorage's error path.
 */
export function loadWorkspaceRegistryFromStorage(): LoadWorkspaceRegistryResult {
  if (typeof window === "undefined") {
    return { status: "ok", registry: createDefaultRegistry(), migrated: false };
  }

  const raw = window.localStorage.getItem(WORKSPACE_REGISTRY_KEY);
  if (raw === null) {
    const registry = createDefaultRegistry();
    writeWorkspaceRegistryNow(registry);
    return { status: "ok", registry, migrated: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "error",
      detail: "Saved workspace registry is not valid JSON.",
      fallback: createDefaultRegistry(),
    };
  }

  const result = deserializeWorkspaceRegistry(parsed);
  if (!result.ok) {
    return { status: "error", detail: result.detail, fallback: createDefaultRegistry() };
  }
  return { status: "ok", registry: result.registry, migrated: false };
}

// ---------------------------------------------------------------------------
// Tabs / open-workspace UI state — session convenience, not critical data.
// Best-effort persistence: a missing or malformed blob just falls back to a
// single fresh tab, never blocks the app or shows a recovery prompt.
// ---------------------------------------------------------------------------

interface PersistedTabsBlob {
  tabs: RequestTabState[];
  activeTabId: string;
}

function isPersistedTabsBlob(value: unknown): value is PersistedTabsBlob {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.tabs) &&
    v.tabs.every((t) => typeof t === "object" && t !== null && typeof (t as { id?: unknown }).id === "string") &&
    typeof v.activeTabId === "string"
  );
}

export function loadTabsFromStorage(): PersistedTabsBlob | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(TABS_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedTabsBlob(parsed)) return null;
    if (!parsed.tabs.some((t) => t.id === parsed.activeTabId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeTabsNow(blob: PersistedTabsBlob): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TABS_KEY, JSON.stringify(blob));
  } catch {
    // Same reasoning as writeWorkspaceNow — non-fatal.
  }
}

export const saveTabsToStorage = debounce(writeTabsNow, DEBOUNCE_MS);

// ---------------------------------------------------------------------------
// Environments/variables — a dedicated versioned boundary, separate from the
// workspace envelope above. Environments are a sibling concept to
// collections (not nested inside them), can contain secret values that
// deserve their own documented storage story, and may evolve on a different
// schema timeline (e.g. adding Global/Collection scopes later) — reusing the
// workspace envelope would couple two unrelated migration paths together.
// Strictly validated, like the workspace, since losing environment
// definitions (and the active selection) is real, not just a UI polish
// issue.
//
// Security note: like all localStorage data, values stored here — including
// variables flagged `secret` — are stored in plaintext, accessible to any
// script or extension running in the browser's local profile with access to
// this origin's storage. The `secret` flag controls in-app UI masking only;
// it is not encryption and must never be described as one. See
// docs/SECURITY.md.
// ---------------------------------------------------------------------------

export type LoadEnvironmentsResult =
  | { status: "empty" }
  | { status: "ok"; data: EnvironmentWorkspace }
  | { status: "error"; detail: string };

export function loadEnvironmentsFromStorage(): LoadEnvironmentsResult {
  if (typeof window === "undefined") return { status: "empty" };
  const raw = window.localStorage.getItem(ENVIRONMENTS_KEY);
  if (raw === null) return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", detail: "Saved environment data is not valid JSON." };
  }

  const result = deserializeEnvironments(parsed);
  if (!result.ok) return { status: "error", detail: result.detail };
  return { status: "ok", data: result.data };
}

function writeEnvironmentsNow(data: EnvironmentWorkspace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify(serializeEnvironments(data)));
  } catch {
    // Storage full/unavailable — non-fatal, same reasoning as writeWorkspaceNow.
  }
}

export const saveEnvironmentsToStorage = debounce(writeEnvironmentsNow, DEBOUNCE_MS);

export function resetEnvironmentsStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ENVIRONMENTS_KEY);
}

// ---------------------------------------------------------------------------
// Global Variables Persistence
// ---------------------------------------------------------------------------

const persistedGlobalsSchema = z.object({
  version: z.literal(GLOBALS_FORMAT_VERSION),
  variables: z.array(z.object({
    id: z.string(),
    key: z.string(),
    value: z.string(),
    enabled: z.boolean(),
    secret: z.boolean(),
  })),
});

export type LoadGlobalsResult =
  | { status: "empty" }
  | { status: "ok"; variables: Variable[] }
  | { status: "error"; detail: string };

export function loadGlobalsFromStorage(): LoadGlobalsResult {
  if (typeof window === "undefined") return { status: "empty" };
  const raw = window.localStorage.getItem(GLOBALS_KEY);
  if (raw === null) return { status: "empty" };

  try {
    const parsed = JSON.parse(raw);
    const result = persistedGlobalsSchema.safeParse(parsed);
    if (!result.success) {
      return { status: "error", detail: "Globals data does not conform to the expected format." };
    }
    return { status: "ok", variables: result.data.variables };
  } catch {
    return { status: "error", detail: "Saved globals data is not valid JSON." };
  }
}

function writeGlobalsNow(variables: Variable[]): void {
  if (typeof window === "undefined") return;
  try {
    const data = {
      version: GLOBALS_FORMAT_VERSION,
      variables,
    };
    window.localStorage.setItem(GLOBALS_KEY, JSON.stringify(data));
  } catch {
    // Non-fatal
  }
}

export const saveGlobalsToStorage = debounce(writeGlobalsNow, DEBOUNCE_MS);

export function resetGlobalsStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(GLOBALS_KEY);
}

// ---------------------------------------------------------------------------
// Request History — session and execution convenience.
// ---------------------------------------------------------------------------

export function loadHistoryFromStorage(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(HISTORY_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is HistoryItem => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof item.id === "string" &&
          typeof item.method === "string" &&
          typeof item.url === "string" &&
          typeof item.timestamp === "string" &&
          typeof item.requestConfig === "object" &&
          item.requestConfig !== null
        );
      });
    }
    return [];
  } catch {
    return [];
  }
}

function writeHistoryNow(data: HistoryItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
  } catch {
    // Non-fatal.
  }
}

export const saveHistoryToStorage = debounce(writeHistoryNow, DEBOUNCE_MS);

export function resetHistoryStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(HISTORY_KEY);
}

const RUNNER_HISTORY_KEY = "api-lab-runner-history";

export function loadRunnerHistoryFromStorage(): RunnerRunHistoryItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(RUNNER_HISTORY_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is RunnerRunHistoryItem => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof item.id === "string" &&
          typeof item.collectionId === "string" &&
          typeof item.collectionName === "string" &&
          typeof item.startedAt === "number" &&
          typeof item.endedAt === "number" &&
          Array.isArray(item.iterations)
        );
      });
    }
    return [];
  } catch {
    return [];
  }
}

function writeRunnerHistoryNow(data: RunnerRunHistoryItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RUNNER_HISTORY_KEY, JSON.stringify(data));
  } catch {
    // Non-fatal.
  }
}

export const saveRunnerHistoryToStorage = debounce(writeRunnerHistoryNow, DEBOUNCE_MS);

export function resetRunnerHistoryStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(RUNNER_HISTORY_KEY);
}

