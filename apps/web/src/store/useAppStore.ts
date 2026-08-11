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
import {
  createCollection as wsCreateCollection,
  createFolder as wsCreateFolder,
  createRequest as wsCreateRequest,
  deleteCollection as wsDeleteCollection,
  deleteFolder as wsDeleteFolder,
  deleteRequest as wsDeleteRequest,
  duplicateRequest as wsDuplicateRequest,
  getRequestsAtLocation,
  moveCollectionDown as wsMoveCollectionDown,
  moveCollectionUp as wsMoveCollectionUp,
  moveItemDown as wsMoveItemDown,
  moveItemUp as wsMoveItemUp,
  moveRequest as wsMoveRequest,
  renameCollection as wsRenameCollection,
  renameFolder as wsRenameFolder,
  renameRequest as wsRenameRequest,
  updateRequestConfig as wsUpdateRequestConfig,
  type RequestLocation,
  type Workspace,
} from "@api-lab/workspace-engine";
import {
  addVariable as envAddVariable,
  buildVariableContext,
  createEmptyEnvironmentWorkspace,
  createEnvironment as envCreateEnvironment,
  deleteEnvironment as envDeleteEnvironment,
  duplicateEnvironment as envDuplicateEnvironment,
  removeVariable as envRemoveVariable,
  renameEnvironment as envRenameEnvironment,
  resolveRequestConfig,
  setActiveEnvironment as envSetActiveEnvironment,
  updateVariable as envUpdateVariable,
  type EnvironmentWorkspace,
  type Variable,
} from "@api-lab/environment-engine";
import { applyAuth, validateAuthConfig, type AuthConfig } from "@api-lab/auth-engine";
import type {
  NormalizedCollectionImport,
  NormalizedEnvironmentImport,
  NormalizedWorkspaceImport,
} from "@api-lab/collection-format";
import type { RequestTabState } from "../types";
import { createId } from "../lib/id";
import { createEmptyTab, createInitialTab } from "../lib/seedData";
import { createSeedWorkspace } from "../lib/seedWorkspace";
import { requestConfigToTabFields, tabToRequestConfig } from "../lib/requestConfig";
import { resolveAuthConfig } from "../lib/authResolve";
import { applyCollectionImport, applyEnvironmentImport } from "../lib/importExport";
import {
  loadEnvironmentsFromStorage,
  loadTabsFromStorage,
  loadWorkspaceFromStorage,
  resetEnvironmentsStorage,
  resetWorkspaceStorage,
  saveEnvironmentsToStorage,
  saveTabsToStorage,
  saveWorkspaceToStorage,
} from "../lib/persistence";

const executor = new BrowserFetchExecutor();

function getPreferredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("api-lab-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface InitialState {
  workspace: Workspace;
  workspaceLoadError: string | null;
  environments: EnvironmentWorkspace;
  environmentsLoadError: string | null;
  tabs: RequestTabState[];
  activeTabId: string;
}

function loadInitialState(): InitialState {
  const workspaceResult = loadWorkspaceFromStorage();
  const workspace =
    workspaceResult.status === "ok"
      ? workspaceResult.workspace
      : workspaceResult.status === "empty"
        ? createSeedWorkspace()
        : { collections: [] };
  const workspaceLoadError = workspaceResult.status === "error" ? workspaceResult.detail : null;

  const environmentsResult = loadEnvironmentsFromStorage();
  const environments =
    environmentsResult.status === "ok" ? environmentsResult.data : createEmptyEnvironmentWorkspace();
  const environmentsLoadError = environmentsResult.status === "error" ? environmentsResult.detail : null;

  const persistedTabs = loadTabsFromStorage();
  if (persistedTabs) {
    return {
      workspace,
      workspaceLoadError,
      environments,
      environmentsLoadError,
      tabs: persistedTabs.tabs,
      activeTabId: persistedTabs.activeTabId,
    };
  }

  const tab = createInitialTab();
  return {
    workspace,
    workspaceLoadError,
    environments,
    environmentsLoadError,
    tabs: [tab],
    activeTabId: tab.id,
  };
}

interface AppState {
  // Layout
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Theme
  theme: ThemeMode;
  toggleTheme: () => void;

  // Environments / variables
  environments: EnvironmentWorkspace;
  environmentsLoadError: string | null;
  resetEnvironments: () => void;
  createEnvironment: (name: string) => string;
  renameEnvironment: (environmentId: string, name: string) => void;
  deleteEnvironment: (environmentId: string) => void;
  duplicateEnvironment: (environmentId: string) => string;
  setActiveEnvironment: (environmentId: string | null) => void;
  addVariable: (environmentId: string) => string;
  updateVariable: (
    environmentId: string,
    variableId: string,
    patch: Partial<Pick<Variable, "key" | "value" | "enabled" | "secret">>,
  ) => void;
  removeVariable: (environmentId: string, variableId: string) => void;

  // Workspace: collections / folders / saved requests
  workspace: Workspace;
  workspaceLoadError: string | null;
  resetWorkspace: () => void;

  createCollection: (name: string) => string;
  renameCollection: (collectionId: string, name: string) => void;
  deleteCollection: (collectionId: string) => void;
  moveCollectionUp: (collectionId: string) => void;
  moveCollectionDown: (collectionId: string) => void;

  createFolder: (collectionId: string, name: string) => string;
  renameFolder: (collectionId: string, folderId: string, name: string) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;

  renameSavedRequest: (location: RequestLocation, requestId: string, name: string) => void;
  deleteSavedRequest: (location: RequestLocation, requestId: string) => void;
  duplicateSavedRequest: (location: RequestLocation, requestId: string) => void;
  moveSavedRequest: (from: RequestLocation, to: RequestLocation, requestId: string) => void;
  moveItemUp: (location: RequestLocation, itemId: string) => void;
  moveItemDown: (location: RequestLocation, itemId: string) => void;

  // Import (Postman / OpenAPI / API Lab native) — see @api-lab/collection-format
  importCollection: (normalized: NormalizedCollectionImport) => string;
  importEnvironment: (normalized: NormalizedEnvironmentImport) => string;
  importNativeWorkspace: (normalized: NormalizedWorkspaceImport) => void;

  // Tabs
  tabs: RequestTabState[];
  activeTabId: string;
  openNewTab: () => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  openSavedRequest: (location: RequestLocation, requestId: string) => void;
  saveNewRequest: (tabId: string, location: RequestLocation, name: string) => void;
  saveTab: (tabId: string) => void;

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
  setAuth: (tabId: string, auth: AuthConfig) => void;
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

function sameLocation(a: RequestLocation, b: RequestLocation): boolean {
  return a.collectionId === b.collectionId && a.folderId === b.folderId;
}

const initial = loadInitialState();

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

  environments: initial.environments,
  environmentsLoadError: initial.environmentsLoadError,
  resetEnvironments: () => {
    resetEnvironmentsStorage();
    set({ environments: createEmptyEnvironmentWorkspace(), environmentsLoadError: null });
  },
  createEnvironment: (name) => {
    const { workspace, environmentId } = envCreateEnvironment(get().environments, name);
    set({ environments: workspace });
    return environmentId;
  },
  renameEnvironment: (environmentId, name) =>
    set((s) => ({ environments: envRenameEnvironment(s.environments, environmentId, name) })),
  deleteEnvironment: (environmentId) =>
    set((s) => ({ environments: envDeleteEnvironment(s.environments, environmentId) })),
  duplicateEnvironment: (environmentId) => {
    const { workspace, environmentId: newId } = envDuplicateEnvironment(get().environments, environmentId);
    set({ environments: workspace });
    return newId;
  },
  setActiveEnvironment: (environmentId) =>
    set((s) => ({ environments: envSetActiveEnvironment(s.environments, environmentId) })),
  addVariable: (environmentId) => {
    const { workspace, variableId } = envAddVariable(get().environments, environmentId);
    set({ environments: workspace });
    return variableId;
  },
  updateVariable: (environmentId, variableId, patch) =>
    set((s) => ({ environments: envUpdateVariable(s.environments, environmentId, variableId, patch) })),
  removeVariable: (environmentId, variableId) =>
    set((s) => ({ environments: envRemoveVariable(s.environments, environmentId, variableId) })),

  workspace: initial.workspace,
  workspaceLoadError: initial.workspaceLoadError,
  resetWorkspace: () => {
    resetWorkspaceStorage();
    const workspace = createSeedWorkspace();
    set({ workspace, workspaceLoadError: null });
  },

  createCollection: (name) => {
    const { workspace, collectionId } = wsCreateCollection(get().workspace, name);
    set({ workspace });
    return collectionId;
  },
  renameCollection: (collectionId, name) =>
    set((s) => ({ workspace: wsRenameCollection(s.workspace, collectionId, name) })),
  deleteCollection: (collectionId) =>
    set((s) => ({
      workspace: wsDeleteCollection(s.workspace, collectionId),
      tabs: s.tabs.map((tab) =>
        tab.savedLocation?.collectionId === collectionId
          ? { ...tab, savedRequestId: undefined, savedLocation: undefined, savedSnapshot: undefined }
          : tab,
      ),
    })),
  moveCollectionUp: (collectionId) =>
    set((s) => ({ workspace: wsMoveCollectionUp(s.workspace, collectionId) })),
  moveCollectionDown: (collectionId) =>
    set((s) => ({ workspace: wsMoveCollectionDown(s.workspace, collectionId) })),

  createFolder: (collectionId, name) => {
    const { workspace, folderId } = wsCreateFolder(get().workspace, collectionId, name);
    set({ workspace });
    return folderId;
  },
  renameFolder: (collectionId, folderId, name) =>
    set((s) => ({ workspace: wsRenameFolder(s.workspace, collectionId, folderId, name) })),
  deleteFolder: (collectionId, folderId) =>
    set((s) => ({
      workspace: wsDeleteFolder(s.workspace, collectionId, folderId),
      tabs: s.tabs.map((tab) =>
        tab.savedLocation?.collectionId === collectionId && tab.savedLocation.folderId === folderId
          ? { ...tab, savedRequestId: undefined, savedLocation: undefined, savedSnapshot: undefined }
          : tab,
      ),
    })),

  renameSavedRequest: (location, requestId, name) =>
    set((s) => ({
      workspace: wsRenameRequest(s.workspace, location, requestId, name),
      tabs: updateTab(s.tabs, s.tabs.find((t) => t.savedRequestId === requestId)?.id ?? "", { name }),
    })),
  deleteSavedRequest: (location, requestId) =>
    set((s) => ({
      workspace: wsDeleteRequest(s.workspace, location, requestId),
      tabs: s.tabs.map((tab) =>
        tab.savedRequestId === requestId
          ? { ...tab, savedRequestId: undefined, savedLocation: undefined, savedSnapshot: undefined }
          : tab,
      ),
    })),
  duplicateSavedRequest: (location, requestId) => {
    const { workspace, requestId: copyId } = wsDuplicateRequest(get().workspace, location, requestId);
    set({ workspace });
    get().openSavedRequest(location, copyId);
  },
  moveSavedRequest: (from, to, requestId) =>
    set((s) => ({
      workspace: wsMoveRequest(s.workspace, from, to, requestId),
      tabs: s.tabs.map((tab) =>
        tab.savedRequestId === requestId && tab.savedLocation && sameLocation(tab.savedLocation, from)
          ? { ...tab, savedLocation: to }
          : tab,
      ),
    })),
  moveItemUp: (location, itemId) => set((s) => ({ workspace: wsMoveItemUp(s.workspace, location, itemId) })),
  moveItemDown: (location, itemId) =>
    set((s) => ({ workspace: wsMoveItemDown(s.workspace, location, itemId) })),

  importCollection: (normalized) => {
    const { workspace, collectionId } = applyCollectionImport(get().workspace, normalized);
    set({ workspace });
    return collectionId;
  },
  importEnvironment: (normalized) => {
    const { workspace, environmentId } = applyEnvironmentImport(get().environments, normalized);
    set({ environments: workspace });
    return environmentId;
  },
  importNativeWorkspace: (normalized) => {
    let workspace = get().workspace;
    let environments = get().environments;
    for (const collection of normalized.collections) {
      workspace = applyCollectionImport(workspace, collection).workspace;
    }
    for (const environment of normalized.environments) {
      environments = applyEnvironmentImport(environments, environment).workspace;
    }
    set({ workspace, environments });
  },

  tabs: initial.tabs,
  activeTabId: initial.activeTabId,

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

  openSavedRequest: (location, requestId) => {
    const state = get();
    // Opening an already-open saved request activates its existing tab
    // instead of creating a duplicate editing session.
    const existing = state.tabs.find(
      (t) => t.savedRequestId === requestId && t.savedLocation && sameLocation(t.savedLocation, location),
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const requests = getRequestsAtLocation(state.workspace, location.collectionId, location.folderId);
    const saved = requests.find((r) => r.id === requestId);
    if (!saved) return;

    const tab = createEmptyTab({
      name: saved.name,
      ...requestConfigToTabFields(saved.request),
      savedRequestId: saved.id,
      savedLocation: location,
      savedSnapshot: saved.request,
    });
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  saveNewRequest: (tabId, location, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const requestConfig = tabToRequestConfig(tab);
    const { workspace, requestId } = wsCreateRequest(get().workspace, location, name, requestConfig);
    set((s) => ({
      workspace,
      tabs: updateTab(s.tabs, tabId, {
        name,
        savedRequestId: requestId,
        savedLocation: location,
        savedSnapshot: requestConfig,
      }),
    }));
  },

  saveTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.savedRequestId || !tab.savedLocation) return;
    const requestConfig = tabToRequestConfig(tab);
    const workspace = wsUpdateRequestConfig(get().workspace, tab.savedLocation, tab.savedRequestId, requestConfig);
    set((s) => ({
      workspace,
      tabs: updateTab(s.tabs, tabId, { savedSnapshot: requestConfig }),
    }));
  },

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

  setAuth: (tabId, auth) => set((s) => ({ tabs: updateTab(s.tabs, tabId, { auth }) })),
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
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const activeEnvironment = state.environments.environments.find(
      (e) => e.id === state.environments.activeEnvironmentId,
    );
    const context = buildVariableContext(activeEnvironment);
    const resolution = resolveRequestConfig(
      { url: tab.url, params: tab.params, headers: tab.headers, bodyRawContent: tab.bodyRawContent },
      context,
    );

    if (resolution.hasCircularReference) {
      set((s) => ({
        sendErrors: {
          ...s.sendErrors,
          [tabId]: {
            field: "variables",
            message: "Circular variable reference detected. Fix the environment's variable values before sending.",
          },
        },
      }));
      return;
    }

    if (resolution.unresolvedVariables.length > 0) {
      set((s) => ({
        sendErrors: {
          ...s.sendErrors,
          [tabId]: {
            field: "variables",
            message: `Unresolved variable${resolution.unresolvedVariables.length > 1 ? "s" : ""}: ${resolution.unresolvedVariables.join(", ")}. Select an environment that defines ${resolution.unresolvedVariables.length > 1 ? "them" : "it"}, or remove the reference.`,
          },
        },
      }));
      return;
    }

    const resolved = resolution.resolved;

    // Auth fields (API key value, username/password, bearer/JWT token) can
    // also reference {{variables}} — resolve them through the same
    // environment context before validating or applying the auth config.
    const authResolution = resolveAuthConfig(tab.auth, context);
    if (authResolution.hasCircularReference) {
      set((s) => ({
        sendErrors: {
          ...s.sendErrors,
          [tabId]: {
            field: "variables",
            message: "Circular variable reference detected in the authorization configuration.",
          },
        },
      }));
      return;
    }
    if (authResolution.unresolvedVariables.length > 0) {
      set((s) => ({
        sendErrors: {
          ...s.sendErrors,
          [tabId]: {
            field: "variables",
            message: `Unresolved variable${authResolution.unresolvedVariables.length > 1 ? "s" : ""} in authorization: ${authResolution.unresolvedVariables.join(", ")}.`,
          },
        },
      }));
      return;
    }

    const authError = validateAuthConfig(authResolution.resolved);
    if (authError) {
      set((s) => ({ sendErrors: { ...s.sendErrors, [tabId]: authError } }));
      return;
    }

    // Auth-generated headers/params take precedence over manually entered
    // ones with the same name — see auth-engine's applyAuth docstring for
    // the documented precedence rule.
    const withAuth = applyAuth(authResolution.resolved, resolved.headers, resolved.params);

    const urlError = validateUrl(resolved.url);
    if (urlError) {
      set((s) => ({ sendErrors: { ...s.sendErrors, [tabId]: urlError } }));
      return;
    }
    const bodyError = validateJsonBody(tab.bodyMode, tab.bodyRawFormat, resolved.bodyRawContent);
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
      url: resolved.url,
      queryParams: withAuth.params,
      headers: withAuth.headers,
      authType: tab.auth.type,
      bodyMode: tab.bodyMode,
      bodyRawFormat: tab.bodyRawFormat,
      bodyRawContent: resolved.bodyRawContent,
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
        auth: { type: "none" },
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

/** The currently active environment, or undefined for "No Environment". */
export function useActiveEnvironment() {
  const environments = useAppStore((s) => s.environments);
  return environments.environments.find((e) => e.id === environments.activeEnvironmentId);
}

// Persist the workspace (debounced) whenever it changes, and skip writes
// while a load error is being shown — see loadWorkspaceFromStorage's
// "don't clobber possibly-recoverable data" reasoning in lib/persistence.ts.
let lastWorkspace = useAppStore.getState().workspace;
useAppStore.subscribe((state) => {
  if (state.workspace !== lastWorkspace) {
    lastWorkspace = state.workspace;
    if (!state.workspaceLoadError) {
      saveWorkspaceToStorage(state.workspace);
    }
  }
});

let lastEnvironments = useAppStore.getState().environments;
useAppStore.subscribe((state) => {
  if (state.environments !== lastEnvironments) {
    lastEnvironments = state.environments;
    if (!state.environmentsLoadError) {
      saveEnvironmentsToStorage(state.environments);
    }
  }
});

let lastTabsSignature = "";
useAppStore.subscribe((state) => {
  const signature = JSON.stringify([state.tabs, state.activeTabId]);
  if (signature !== lastTabsSignature) {
    lastTabsSignature = signature;
    saveTabsToStorage({ tabs: state.tabs, activeTabId: state.activeTabId });
  }
});
