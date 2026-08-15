import { deserializeWorkspace, serializeWorkspace, type Workspace } from "@api-lab/workspace-engine";
import {
  deserializeEnvironments,
  serializeEnvironments,
  type EnvironmentWorkspace,
} from "@api-lab/environment-engine";
import type { RequestTabState, HistoryItem } from "../types";
import { debounce } from "./debounce";

const HISTORY_KEY = "api-lab-request-history";

const WORKSPACE_KEY = "api-lab-workspace";
const TABS_KEY = "api-lab-tabs";
const ENVIRONMENTS_KEY = "api-lab-environments";
const DEBOUNCE_MS = 400;

// ---------------------------------------------------------------------------
// Workspace (collections/folders/requests) — the important, must-be-correct
// data. Strictly validated against the versioned schema before it's trusted;
// see @api-lab/workspace-engine's deserializeWorkspace.
// ---------------------------------------------------------------------------

export type LoadWorkspaceResult =
  | { status: "empty" }
  | { status: "ok"; workspace: Workspace }
  | { status: "error"; detail: string };

export function loadWorkspaceFromStorage(): LoadWorkspaceResult {
  if (typeof window === "undefined") return { status: "empty" };
  const raw = window.localStorage.getItem(WORKSPACE_KEY);
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

function writeWorkspaceNow(workspace: Workspace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(workspace)));
  } catch {
    // Storage full or unavailable (private browsing, quota exceeded) — the
    // in-memory workspace is still correct, it just won't survive a reload.
    // Not worth surfacing as an error interrupting the user's work.
  }
}

export const saveWorkspaceToStorage = debounce(writeWorkspaceNow, DEBOUNCE_MS);

export function resetWorkspaceStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(WORKSPACE_KEY);
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

