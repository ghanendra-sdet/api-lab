import { deserializeWorkspace, serializeWorkspace, type Workspace } from "@api-lab/workspace-engine";
import type { EnvironmentOption, RequestTabState } from "../types";
import { debounce } from "./debounce";

const WORKSPACE_KEY = "api-lab-workspace";
const TABS_KEY = "api-lab-tabs";
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
  environment: EnvironmentOption;
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
