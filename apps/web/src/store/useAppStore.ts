import { create } from "zustand";
import type { HttpMethod, KeyValueRow, RequestPanelId, ThemeMode } from "@api-lab/shared";
import {
  BrowserFetchExecutor,
  buildRequest,
  validateJsonBody,
  validateUrl,
  type ApiResponseResult,
  type ValidationError,
} from "@api-lab/request-engine";
import type { Collection, EnvironmentOption, RequestTabState } from "../types";
import { createId } from "../lib/id";
import { createEmptyTab, createInitialTab, seedCollections } from "../lib/seedData";

const executor = new BrowserFetchExecutor();

function getPreferredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("api-lab-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface AppState {
  // Layout
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Theme
  theme: ThemeMode;
  toggleTheme: () => void;

  // Environment (placeholder — no resolution logic until Milestone 4)
  environment: EnvironmentOption;
  setEnvironment: (env: EnvironmentOption) => void;

  // Collections (static for Milestone 1 — Milestone 3 connects this to real persistence)
  collections: Collection[];

  // Tabs
  tabs: RequestTabState[];
  activeTabId: string;
  openNewTab: () => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // Active tab field updates
  setTabMethod: (tabId: string, method: HttpMethod) => void;
  setTabUrl: (tabId: string, url: string) => void;
  setActivePanel: (tabId: string, panel: RequestPanelId) => void;

  // Params / Headers row management
  addParamRow: (tabId: string) => void;
  updateParamRow: (tabId: string, rowId: string, patch: Partial<KeyValueRow>) => void;
  removeParamRow: (tabId: string, rowId: string) => void;
  addHeaderRow: (tabId: string) => void;
  updateHeaderRow: (tabId: string, rowId: string, patch: Partial<KeyValueRow>) => void;
  removeHeaderRow: (tabId: string, rowId: string) => void;

  // Auth / Body / Scripts
  setAuthType: (tabId: string, authType: RequestTabState["authType"]) => void;
  setBodyMode: (tabId: string, bodyMode: RequestTabState["bodyMode"]) => void;
  setBodyRawFormat: (tabId: string, format: RequestTabState["bodyRawFormat"]) => void;
  setBodyRawContent: (tabId: string, content: string) => void;
  setPreRequestScript: (tabId: string, script: string) => void;
  setPostResponseScript: (tabId: string, script: string) => void;
  setTestsScript: (tabId: string, script: string) => void;

  // Request execution
  requestStatus: Record<string, "idle" | "loading">;
  responses: Record<string, ApiResponseResult | undefined>;
  sendErrors: Record<string, ValidationError | undefined>;
  abortControllers: Record<string, AbortController>;
  sendRequest: (tabId: string) => Promise<void>;
  cancelRequest: (tabId: string) => void;
  resetRequest: (tabId: string) => void;
}

function newRow(): KeyValueRow {
  return { id: createId("row"), key: "", value: "", description: "", enabled: true };
}

function updateTab(
  tabs: RequestTabState[],
  tabId: string,
  patch: Partial<RequestTabState> | ((tab: RequestTabState) => Partial<RequestTabState>),
): RequestTabState[] {
  return tabs.map((tab) =>
    tab.id === tabId ? { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) } : tab,
  );
}

const initialTab = createInitialTab();

export const useAppStore = create<AppState>((set, get) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  theme: getPreferredTheme(),
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === "light" ? "dark" : "light";
      if (typeof window !== "undefined") {
        window.localStorage.setItem("api-lab-theme", next);
      }
      return { theme: next };
    }),

  environment: "none",
  setEnvironment: (environment) => set({ environment }),

  collections: seedCollections,

  tabs: [initialTab],
  activeTabId: initialTab.id,

  openNewTab: () =>
    set((s) => {
      const tab = createEmptyTab();
      return { tabs: [...s.tabs, tab], activeTabId: tab.id };
    }),

  closeTab: (tabId) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        const tab = createEmptyTab();
        return { tabs: [tab], activeTabId: tab.id };
      }
      const activeTabId =
        s.activeTabId === tabId ? remaining[remaining.length - 1]!.id : s.activeTabId;
      return { tabs: remaining, activeTabId };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setTabMethod: (tabId, method) => set((s) => ({ tabs: updateTab(s.tabs, tabId, { method }) })),
  setTabUrl: (tabId, url) => set((s) => ({ tabs: updateTab(s.tabs, tabId, { url }) })),
  setActivePanel: (tabId, activePanel) =>
    set((s) => ({ tabs: updateTab(s.tabs, tabId, { activePanel }) })),

  addParamRow: (tabId) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({ params: [...tab.params, newRow()] })),
    })),
  updateParamRow: (tabId, rowId, patch) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({
        params: tab.params.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
      })),
    })),
  removeParamRow: (tabId, rowId) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({
        params: tab.params.filter((row) => row.id !== rowId),
      })),
    })),

  addHeaderRow: (tabId) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({ headers: [...tab.headers, newRow()] })),
    })),
  updateHeaderRow: (tabId, rowId, patch) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({
        headers: tab.headers.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
      })),
    })),
  removeHeaderRow: (tabId, rowId) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({
        headers: tab.headers.filter((row) => row.id !== rowId),
      })),
    })),

  setAuthType: (tabId, authType) => set((s) => ({ tabs: updateTab(s.tabs, tabId, { authType }) })),
  setBodyMode: (tabId, bodyMode) => set((s) => ({ tabs: updateTab(s.tabs, tabId, { bodyMode }) })),
  setBodyRawFormat: (tabId, bodyRawFormat) =>
    set((s) => ({ tabs: updateTab(s.tabs, tabId, { bodyRawFormat }) })),
  setBodyRawContent: (tabId, bodyRawContent) =>
    set((s) => ({ tabs: updateTab(s.tabs, tabId, { bodyRawContent }) })),
  setPreRequestScript: (tabId, preRequestScript) =>
    set((s) => ({ tabs: updateTab(s.tabs, tabId, { preRequestScript }) })),
  setPostResponseScript: (tabId, postResponseScript) =>
    set((s) => ({ tabs: updateTab(s.tabs, tabId, { postResponseScript }) })),
  setTestsScript: (tabId, testsScript) =>
    set((s) => ({ tabs: updateTab(s.tabs, tabId, { testsScript }) })),

  requestStatus: {},
  responses: {},
  sendErrors: {},
  abortControllers: {},

  sendRequest: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const urlError = validateUrl(tab.url);
    if (urlError) {
      set((s) => ({ sendErrors: { ...s.sendErrors, [tabId]: urlError } }));
      return;
    }
    const bodyError = validateJsonBody(tab.bodyMode, tab.bodyRawFormat, tab.bodyRawContent);
    if (bodyError) {
      set((s) => ({ sendErrors: { ...s.sendErrors, [tabId]: bodyError } }));
      return;
    }

    set((s) => ({
      sendErrors: { ...s.sendErrors, [tabId]: undefined },
      requestStatus: { ...s.requestStatus, [tabId]: "loading" },
    }));

    const controller = new AbortController();
    set((s) => ({ abortControllers: { ...s.abortControllers, [tabId]: controller } }));

    const built = buildRequest({
      id: tab.id,
      name: tab.name,
      method: tab.method,
      url: tab.url,
      queryParams: tab.params,
      headers: tab.headers,
      authType: tab.authType,
      bodyMode: tab.bodyMode,
      bodyRawFormat: tab.bodyRawFormat,
      bodyRawContent: tab.bodyRawContent,
    });

    const result = await executor.execute(built, { signal: controller.signal });

    set((s) => {
      const remainingControllers = { ...s.abortControllers };
      delete remainingControllers[tabId];
      return {
        responses: { ...s.responses, [tabId]: result },
        requestStatus: { ...s.requestStatus, [tabId]: "idle" },
        abortControllers: remainingControllers,
      };
    });
  },

  cancelRequest: (tabId) => {
    get().abortControllers[tabId]?.abort();
  },

  resetRequest: (tabId) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, {
        params: [],
        headers: [],
        authType: "none",
        bodyMode: "none",
        bodyRawContent: "",
      }),
      responses: { ...s.responses, [tabId]: undefined },
      sendErrors: { ...s.sendErrors, [tabId]: undefined },
    })),
}));

export function useActiveTab(): RequestTabState {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  return tabs.find((t) => t.id === activeTabId) ?? tabs[0]!;
}
