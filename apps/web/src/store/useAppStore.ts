import { create } from "zustand";
import type { HttpMethod, KeyValueRow, RequestPanelId, ThemeMode } from "@api-lab/shared";
import type { ApiResponseResult, ValidationError } from "@api-lab/request-engine";
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
  isFolder,
  isRequest,
  resolveDependencyOrder,
  formatCircularDependencyChain,
  type RequestLocation,
  type Workspace,
  type SavedRequest,
  type RequestConfig,
} from "@api-lab/workspace-engine";
import {
  addVariable as envAddVariable,
  createEmptyEnvironmentWorkspace,
  createEnvironment as envCreateEnvironment,
  deleteEnvironment as envDeleteEnvironment,
  duplicateEnvironment as envDuplicateEnvironment,
  removeVariable as envRemoveVariable,
  renameEnvironment as envRenameEnvironment,
  setActiveEnvironment as envSetActiveEnvironment,
  updateVariable as envUpdateVariable,
  type EnvironmentWorkspace,
  type Variable,
} from "@api-lab/environment-engine";
import type { AuthConfig } from "@api-lab/auth-engine";
import type {
  NormalizedCollectionImport,
  NormalizedEnvironmentImport,
  NormalizedWorkspaceImport,
} from "@api-lab/collection-format";
import { createAssertion, type Assertion, type TestResult } from "@api-lab/test-engine";
import { createExtraction, type Dataset, type Extraction, type ExtractionResult } from "@api-lab/runner-engine";
import type { ContractValidationResult } from "@api-lab/contract-engine";
import type { RequestTabState, HistoryItem } from "../types";
import { createId } from "../lib/id";
import { createEmptyTab, createInitialTab } from "../lib/seedData";
import { createSeedWorkspace } from "../lib/seedWorkspace";
import { requestConfigToTabFields, tabToRequestConfig } from "../lib/requestConfig";
import { applyCollectionImport, applyEnvironmentImport } from "../lib/importExport";
import {
  executeRequestConfig,
  type ContractExecutionOptions,
  type ExecuteRequestResult,
  type ExecutionScopes,
} from "../lib/executeRequest";
import type { ScriptResult } from "@api-lab/script-engine";
import { findSpecificationForCollection, getContractModel, useContractStore } from "./useContractStore";
import {
  flattenCollectionRequests,
  createIdleRunnerState,
  type RunnerState,
} from "../lib/runner";
import { runSecurityTests, type SecurityTestResult } from "@api-lab/security-engine";
import { resolveSecurityRequest } from "../lib/securityAdapt";
import { browserSecurityExecutor } from "../lib/securityRun";
import { useSecurityStore } from "./useSecurityStore";
import {
  loadEnvironmentsFromStorage,
  loadTabsFromStorage,
  loadWorkspaceFromStorage,
  resetEnvironmentsStorage,
  resetWorkspaceStorage,
  saveEnvironmentsToStorage,
  saveTabsToStorage,
  saveWorkspaceToStorage,
  loadHistoryFromStorage,
  saveHistoryToStorage,
  resetHistoryStorage,
} from "../lib/persistence";

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
  history: HistoryItem[];
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

  const history = loadHistoryFromStorage();

  const persistedTabs = loadTabsFromStorage();
  if (persistedTabs) {
    return {
      workspace,
      workspaceLoadError,
      environments,
      environmentsLoadError,
      tabs: persistedTabs.tabs,
      activeTabId: persistedTabs.activeTabId,
      history,
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
    history,
  };
}

/**
 * Which top-level workspace is showing. Milestone 10 adds a real
 * Performance *page* rather than another modal dialog — a load test is a
 * long-running activity with live charts, not a quick action, so it needs
 * durable screen space of its own.
 */
export type WorkspaceView = "home" | "request" | "performance";

interface AppState {
  // Layout
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  activeView: WorkspaceView;
  setActiveView: (view: WorkspaceView) => void;

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

  // Request History
  history: HistoryItem[];
  clearHistory: () => void;
  openHistoryItem: (item: HistoryItem) => void;

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

  // Assertions (tests)
  addAssertion: (tabId: string) => string;
  updateAssertion: (tabId: string, assertionId: string, patch: Partial<Omit<Assertion, "id">>) => void;
  removeAssertion: (tabId: string, assertionId: string) => void;

  // Extractions (Milestone 8: pull a runtime variable out of the response)
  addExtraction: (tabId: string) => string;
  updateExtraction: (tabId: string, extractionId: string, patch: Partial<Omit<Extraction, "id">>) => void;
  removeExtraction: (tabId: string, extractionId: string) => void;

  // Request execution
  requestStatus: Record<string, "idle" | "loading">;
  responses: Record<string, ApiResponseResult | undefined>;
  testResults: Record<string, TestResult | undefined>;
  preRequestScriptResults: Record<string, ScriptResult | undefined>;
  postResponseScriptResults: Record<string, ScriptResult | undefined>;
  extractionResults: Record<string, ExtractionResult[] | undefined>;
  sendErrors: Record<string, ValidationError | undefined>;
  abortControllers: Record<string, AbortController>;
  /** Per-tab contract validation outcomes (Milestone 11). Never persisted —
   * a result describes one exchange that already happened. */
  contractResults: Record<string, ContractValidationResult | undefined>;
  /** "[✓] Validate against contract" next to Send (spec §28). */
  contractValidationEnabled: boolean;
  setContractValidationEnabled: (enabled: boolean) => void;
  /** Pre-flight request validation, which blocks the send (spec §7, §12). */
  contractRequestValidationEnabled: boolean;
  setContractRequestValidationEnabled: (enabled: boolean) => void;
  /** Runtime variables extracted from responses, scoped per tab — never
   * persisted, cleared on tab close or Clear. Lets a tab manually chain
   * "Send A, then reference {{extractedVar}} in B" without a Runner. */
  tabRuntimeVariables: Record<string, Record<string, string>>;
  sendRequest: (tabId: string) => Promise<void>;
  cancelRequest: (tabId: string) => void;
  resetRequest: (tabId: string) => void;

  // Collection Runner
  runnerState: RunnerState;
  runnerAbortController: AbortController | null;
  runnerDataset: Dataset | null;
  runnerDatasetName: string | null;
  setRunnerDataset: (dataset: Dataset | null, name: string | null) => void;
  /** "Validate contract after response" in the Runner (spec §29). */
  runnerValidateContract: boolean;
  setRunnerValidateContract: (enabled: boolean) => void;
  /**
   * Whether a collection run also executes the generated security suite
   * (Milestone 12, spec §32). Off by default: a security pass sends extra
   * requests, some deliberately malformed, and that must never be something a
   * user turns on by accident while running their functional collection.
   */
  runnerIncludeSecurity: boolean;
  setRunnerIncludeSecurity: (enabled: boolean) => void;
  /** Security results from the most recent run. Session-only, never persisted
   * (see lib/securityPersistence.ts). */
  runnerSecurityResults: SecurityTestResult[];
  startRunner: (
    collectionId: string,
    requestIds: string[],
    environmentId: string | null,
    stopOnFailure: boolean,
  ) => Promise<void>;
  cancelRunner: () => void;
  resetRunner: () => void;
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


/**
 * Resolves which specification a request should be validated against, and
 * builds the execution options from it.
 *
 * A saved request inherits the specification bound to its collection
 * (spec §26); anything else falls back to the specification explicitly
 * selected in the Contract panel. Returning `undefined` — no attached
 * specification, or one that no longer parses — means validation is simply
 * skipped, never that an ordinary request is blocked (spec §28).
 */
function buildContractOptions(
  collectionId: string | undefined,
  validateResponse: boolean,
  validateRequestBeforeSend: boolean,
): { options: ContractExecutionOptions | undefined; specId: string | null } {
  if (!validateResponse && !validateRequestBeforeSend) return { options: undefined, specId: null };

  const contractState = useContractStore.getState();
  const specification =
    findSpecificationForCollection(contractState.contracts, collectionId) ??
    contractState.contracts.specifications.find((spec) => spec.id === contractState.activeSpecificationId);

  const contract = getContractModel(specification);
  if (!contract || !specification) return { options: undefined, specId: null };

  return {
    options: { contract, validateResponse, validateRequestBeforeSend },
    specId: specification.id,
  };
}

function buildDependencyMap(workspace: Workspace): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const collection of workspace.collections) {
    for (const item of collection.items) {
      if (isFolder(item)) {
        for (const req of item.items) {
          map[req.id] = req.request.dependsOn || [];
        }
      } else if (isRequest(item)) {
        map[item.id] = item.request.dependsOn || [];
      }
    }
  }
  return map;
}

function getRequestName(workspace: Workspace, id: string): string {
  for (const collection of workspace.collections) {
    for (const item of collection.items) {
      if (isFolder(item)) {
        for (const req of item.items) {
          if (req.id === id) return req.name;
        }
      } else if (isRequest(item)) {
        if (item.id === id) return item.name;
      }
    }
  }
  return id;
}

function validateWorkspaceDependencies(workspace: Workspace, changedRequestId: string): void {
  const dependencyMap = buildDependencyMap(workspace);
  const result = resolveDependencyOrder(changedRequestId, dependencyMap);
  if (!result.ok) {
    const error = result.error;
    if (error.type === "self-dependency") {
      const name = getRequestName(workspace, error.requestId);
      throw new Error(`Request ${name} cannot depend on itself.`);
    } else if (error.type === "duplicate-dependency") {
      const name = getRequestName(workspace, error.requestId);
      const duplicateName = getRequestName(workspace, error.duplicateId);
      throw new Error(`Request ${name} contains duplicate dependency ${duplicateName}.`);
    } else if (error.type === "missing-dependency") {
      const name = getRequestName(workspace, error.requestId);
      throw new Error(`Request ${name} depends on missing request ${error.missingId}.`);
    } else if (error.type === "circular-dependency") {
      const chainStr = formatCircularDependencyChain(
        error.chain.map((id) => getRequestName(workspace, id))
      );
      throw new Error(`Circular dependency detected:\n${chainStr}`);
    }
  }
}

function findSavedRequest(workspace: Workspace, id: string): SavedRequest | undefined {
  for (const collection of workspace.collections) {
    for (const item of collection.items) {
      if (isFolder(item)) {
        for (const req of item.items) {
          if (req.id === id) return req;
        }
      } else if (isRequest(item)) {
        if (item.id === id) return item;
      }
    }
  }
  return undefined;
}

function isExecutionFailure(outcome: ExecuteRequestResult): boolean {
  if (!outcome.ok) return true;
  if (!outcome.response) return true;
  if (outcome.testResult && (outcome.testResult.status === "failed" || outcome.testResult.status === "error")) {
    return true;
  }
  if (outcome.contractResult && !outcome.contractResult.valid) {
    return true;
  }
  return false;
}

function isPrerequisiteFailure(outcome: ExecuteRequestResult): boolean {
  if (isExecutionFailure(outcome)) return true;
  if (outcome.extractionResults && outcome.extractionResults.some((r) => !r.ok)) {
    return true;
  }
  return false;
}

async function executeRequestWithDependencies(
  targetId: string,
  targetName: string,
  targetConfig: RequestConfig,
  scopes: ExecutionScopes,
  signal: AbortSignal,
  contractOptions: ContractExecutionOptions | undefined,
  workspace: Workspace,
  executed: Set<string>,
  onStepStart?: (id: string, name: string) => void,
  onStepEnd?: (id: string, name: string, outcome: ExecuteRequestResult) => void,
): Promise<ExecuteRequestResult> {
  const dependencyMap = buildDependencyMap(workspace);
  dependencyMap[targetId] = targetConfig.dependsOn || [];

  const resolution = resolveDependencyOrder(targetId, dependencyMap);
  if (!resolution.ok) {
    return {
      ok: false,
      validationError: { field: "variables", message: "Invalid dependency configuration." },
    };
  }

  const currentRuntime = { ...(scopes.runtime ?? {}) };

  for (const id of resolution.order) {
    if (signal.aborted) {
      return { ok: false, validationError: { field: "variables", message: "Execution cancelled." } };
    }

    if (executed.has(id)) {
      continue;
    }

    const isTarget = id === targetId;
    let name: string;
    let config: RequestConfig;

    if (isTarget) {
      name = targetName;
      config = targetConfig;
    } else {
      const saved = findSavedRequest(workspace, id);
      if (!saved) {
        return {
          ok: false,
          validationError: { field: "variables", message: `Prerequisite request ID ${id} not found in workspace.` },
        };
      }
      name = saved.name;
      config = saved.request;
    }

    if (onStepStart) {
      onStepStart(id, name);
    }

    const outcome = await executeRequestConfig(
      id,
      name,
      config,
      { ...scopes, runtime: currentRuntime },
      signal,
      isTarget ? contractOptions : undefined,
    );

    if (onStepEnd) {
      onStepEnd(id, name, outcome);
    }

    executed.add(id);

    if (outcome.ok && outcome.extractedVariables) {
      Object.assign(currentRuntime, outcome.extractedVariables);
    }

    const isStepFailed = isTarget ? isExecutionFailure(outcome) : isPrerequisiteFailure(outcome);
    if (isStepFailed) {
      if (isTarget) {
        return outcome;
      } else {
        let errMsg = `Prerequisite request '${name}' failed.`;
        if (!outcome.ok && outcome.validationError) {
          errMsg = `Prerequisite request '${name}' failed: ${outcome.validationError.message}`;
        } else if (outcome.extractionResults && outcome.extractionResults.some((r) => !r.ok)) {
          const failed = outcome.extractionResults.find((r) => !r.ok)!;
          errMsg = `Prerequisite request '${name}' failed extraction: ${failed.error}`;
        } else if (outcome.testResult && (outcome.testResult.status === "failed" || outcome.testResult.status === "error")) {
          errMsg = `Prerequisite request '${name}' failed assertions.`;
        } else if (outcome.contractResult && !outcome.contractResult.valid) {
          errMsg = `Prerequisite request '${name}' failed contract validation.`;
        }
        return {
          ok: false,
          validationError: { field: "variables", message: errMsg },
        };
      }
    }

    if (isTarget) {
      return outcome;
    }
  }

  return {
    ok: false,
    validationError: { field: "variables", message: "No requests executed." },
  };
}

const initial = loadInitialState();

export const useAppStore = create<AppState>((set, get) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  activeView: "request",
  setActiveView: (view) => set({ activeView: view }),

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

  history: initial.history,

  clearHistory: () => {
    resetHistoryStorage();
    set({ history: [] });
  },

  openHistoryItem: (item) => {
    let path = item.url;
    try {
      if (item.url.startsWith("http://") || item.url.startsWith("https://")) {
        path = new URL(item.url).pathname;
      } else {
        path = new URL(item.url, "http://localhost").pathname;
      }
    } catch {
      // Safe fallback
    }
    const tab = createEmptyTab({
      name: `History: ${item.method} ${path}`.substring(0, 45),
      ...requestConfigToTabFields(item.requestConfig),
    });
    set((s) => ({
      activeView: "request",
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  openNewTab: () =>
    set((s) => {
      const tab = createEmptyTab();
      return { tabs: [...s.tabs, tab], activeTabId: tab.id };
    }),

  closeTab: (tabId) =>
    set((s) => {
      const remainingRuntimeVariables = { ...s.tabRuntimeVariables };
      delete remainingRuntimeVariables[tabId];

      const remaining = s.tabs.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        const tab = createEmptyTab();
        return { tabs: [tab], activeTabId: tab.id, tabRuntimeVariables: remainingRuntimeVariables };
      }
      const activeTabId =
        s.activeTabId === tabId ? remaining[remaining.length - 1]!.id : s.activeTabId;
      return { tabs: remaining, activeTabId, tabRuntimeVariables: remainingRuntimeVariables };
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
    const { workspace: proposedWorkspace, requestId } = wsCreateRequest(get().workspace, location, name, requestConfig);
    validateWorkspaceDependencies(proposedWorkspace, requestId);
    set((s) => ({
      workspace: proposedWorkspace,
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
    const proposedWorkspace = wsUpdateRequestConfig(get().workspace, tab.savedLocation, tab.savedRequestId, requestConfig);
    validateWorkspaceDependencies(proposedWorkspace, tab.savedRequestId);
    set((s) => ({
      workspace: proposedWorkspace,
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

  addAssertion: (tabId) => {
    const assertion = createAssertion("status");
    set((s) => ({ tabs: updateTab(s.tabs, tabId, (tab) => ({ tests: [...tab.tests, assertion] })) }));
    return assertion.id;
  },
  updateAssertion: (tabId, assertionId, patch) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({
        tests: tab.tests.map((a) => (a.id === assertionId ? { ...a, ...patch } : a)),
      })),
    })),
  removeAssertion: (tabId, assertionId) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({
        tests: tab.tests.filter((a) => a.id !== assertionId),
      })),
    })),

  addExtraction: (tabId) => {
    const extraction = createExtraction("json");
    set((s) => ({ tabs: updateTab(s.tabs, tabId, (tab) => ({ extractions: [...tab.extractions, extraction] })) }));
    return extraction.id;
  },
  updateExtraction: (tabId, extractionId, patch) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({
        extractions: tab.extractions.map((e) => (e.id === extractionId ? { ...e, ...patch } : e)),
      })),
    })),
  removeExtraction: (tabId, extractionId) =>
    set((s) => ({
      tabs: updateTab(s.tabs, tabId, (tab) => ({
        extractions: tab.extractions.filter((e) => e.id !== extractionId),
      })),
    })),

  requestStatus: {},
  responses: {},
  testResults: {},
  preRequestScriptResults: {},
  postResponseScriptResults: {},
  extractionResults: {},
  tabRuntimeVariables: {},
  sendErrors: {},
  abortControllers: {},
  contractResults: {},
  contractValidationEnabled: false,
  setContractValidationEnabled: (enabled) => set({ contractValidationEnabled: enabled }),
  contractRequestValidationEnabled: false,
  setContractRequestValidationEnabled: (enabled) => set({ contractRequestValidationEnabled: enabled }),

  sendRequest: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const activeEnvironment = state.environments.environments.find(
      (e) => e.id === state.environments.activeEnvironmentId,
    );

    set((s) => ({
      sendErrors: { ...s.sendErrors, [tabId]: undefined },
      requestStatus: { ...s.requestStatus, [tabId]: "loading" },
    }));

    const controller = new AbortController();
    set((s) => ({ abortControllers: { ...s.abortControllers, [tabId]: controller } }));

    const contract = buildContractOptions(
      tab.savedLocation?.collectionId,
      state.contractValidationEnabled,
      state.contractRequestValidationEnabled,
    );

    const executed = new Set<string>();

    const outcome = await executeRequestWithDependencies(
      tab.savedRequestId || tab.id,
      tab.name,
      tabToRequestConfig(tab),
      { environment: activeEnvironment, runtime: state.tabRuntimeVariables[tabId] ?? {} },
      controller.signal,
      contract.options,
      state.workspace,
      executed,
    );

    // Coverage counts operations that were actually exercised this session
    // (spec §37) — recorded only when an operation genuinely resolved.
    if (contract.specId && outcome.contractResult?.operation) {
      useContractStore.getState().recordValidatedOperation(contract.specId, outcome.contractResult.operation.id);
    }

    set((s) => {
      const remainingControllers = { ...s.abortControllers };
      delete remainingControllers[tabId];

      if (!outcome.ok) {
        return {
          sendErrors: { ...s.sendErrors, [tabId]: outcome.validationError },
          requestStatus: { ...s.requestStatus, [tabId]: "idle" },
          abortControllers: remainingControllers,
        };
      }

      // A blocked pre-flight (spec §12) or pre-request script failure returns no response.
      if (!outcome.response) {
        return {
          contractResults: { ...s.contractResults, [tabId]: outcome.contractResult },
          preRequestScriptResults: { ...s.preRequestScriptResults, [tabId]: outcome.preRequestScriptResult },
          requestStatus: { ...s.requestStatus, [tabId]: "idle" },
          abortControllers: remainingControllers,
        };
      }

      const nextRuntimeVariables = outcome.extractedVariables
        ? { ...s.tabRuntimeVariables[tabId], ...outcome.extractedVariables }
        : s.tabRuntimeVariables[tabId];

      // A null status means the executor never got a real HTTP response —
      // cancellation (AbortError) and network/CORS failures both resolve
      // this way (see BrowserFetchExecutor.errorResponse), rather than
      // throwing. Recording those in history would be indistinguishable
      // from a genuine completed request, so — matching the "never report
      // cancellation as success" rule the Performance engine already
      // follows — only a request that actually reached the server (any
      // real status code, success or error) is added to history.
      const history =
        outcome.response.status !== null
          ? [
              {
                id: createId("hist"),
                method: tab.method,
                url: tab.url,
                timestamp: new Date().toISOString(),
                status: outcome.response.status,
                requestConfig: tabToRequestConfig(tab),
              } satisfies HistoryItem,
              ...s.history,
            ].slice(0, 50)
          : s.history;

      return {
        responses: { ...s.responses, [tabId]: outcome.response },
        testResults: { ...s.testResults, [tabId]: outcome.testResult },
        preRequestScriptResults: { ...s.preRequestScriptResults, [tabId]: outcome.preRequestScriptResult },
        postResponseScriptResults: { ...s.postResponseScriptResults, [tabId]: outcome.postResponseScriptResult },
        extractionResults: { ...s.extractionResults, [tabId]: outcome.extractionResults },
        contractResults: { ...s.contractResults, [tabId]: outcome.contractResult },
        requestStatus: { ...s.requestStatus, [tabId]: "idle" },
        abortControllers: remainingControllers,
        tabRuntimeVariables: { ...s.tabRuntimeVariables, [tabId]: nextRuntimeVariables ?? {} },
        history,
      };
    });
  },

  cancelRequest: (tabId) => {
    get().abortControllers[tabId]?.abort();
  },

  resetRequest: (tabId) =>
    set((s) => {
      const remainingRuntimeVariables = { ...s.tabRuntimeVariables };
      delete remainingRuntimeVariables[tabId];
      return {
        tabs: updateTab(s.tabs, tabId, {
          params: [],
          headers: [],
          auth: { type: "none" },
          bodyMode: "none",
          bodyRawContent: "",
          tests: [],
          extractions: [],
        }),
        responses: { ...s.responses, [tabId]: undefined },
        testResults: { ...s.testResults, [tabId]: undefined },
        preRequestScriptResults: { ...s.preRequestScriptResults, [tabId]: undefined },
        postResponseScriptResults: { ...s.postResponseScriptResults, [tabId]: undefined },
        extractionResults: { ...s.extractionResults, [tabId]: undefined },
        contractResults: { ...s.contractResults, [tabId]: undefined },
        sendErrors: { ...s.sendErrors, [tabId]: undefined },
        tabRuntimeVariables: remainingRuntimeVariables,
      };
    }),

  runnerState: createIdleRunnerState(),
  runnerAbortController: null,
  runnerDataset: null,
  runnerDatasetName: null,
  setRunnerDataset: (dataset, name) => set({ runnerDataset: dataset, runnerDatasetName: name }),
  runnerValidateContract: false,
  setRunnerValidateContract: (enabled) => set({ runnerValidateContract: enabled }),
  runnerIncludeSecurity: false,
  setRunnerIncludeSecurity: (enabled) => set({ runnerIncludeSecurity: enabled }),
  runnerSecurityResults: [],

  startRunner: async (collectionId, requestIds, environmentId, stopOnFailure) => {
    const state = get();
    const collection = state.workspace.collections.find((c) => c.id === collectionId);
    if (!collection) return;

    const requested = new Set(requestIds);
    const flat = flattenCollectionRequests(collection).filter((r) => requested.has(r.id));
    const environment = state.environments.environments.find((e) => e.id === environmentId);
    const dataset = state.runnerDataset;
    // The Runner validates against the specification bound to the collection
    // being run (spec §26/§29), never against whatever the request workspace
    // happens to have selected.
    const contract = buildContractOptions(collectionId, state.runnerValidateContract, false);
    // A dataset-less run is exactly one iteration with an empty data row —
    // the common case looks identical to Milestone 7's single-pass runner.
    const iterationRows = dataset && dataset.rows.length > 0 ? dataset.rows : [{}];
    const controller = new AbortController();

    set({
      runnerAbortController: controller,
      runnerSecurityResults: [],
      runnerState: {
        status: "running",
        collectionId,
        environmentId,
        stopOnFailure,
        datasetName: state.runnerDatasetName,
        validateContract: contract.options !== undefined,
        iterations: iterationRows.map((data, index) => ({
          index,
          data,
          items: flat.map((r) => ({ requestId: r.id, name: r.name, status: "pending" })),
        })),
        startedAt: Date.now(),
      },
    });

    function setItem(iterationIndex: number, requestId: string, patch: Partial<RunnerState["iterations"][number]["items"][number]>) {
      set((s) => ({
        runnerState: {
          ...s.runnerState,
          iterations: s.runnerState.iterations.map((iteration) =>
            iteration.index !== iterationIndex
              ? iteration
              : {
                  ...iteration,
                  items: iteration.items.map((item) => (item.requestId === requestId ? { ...item, ...patch } : item)),
                },
          ),
        },
      }));
    }

    outer: for (let iterationIndex = 0; iterationIndex < iterationRows.length; iterationIndex++) {
      const iterationData = iterationRows[iterationIndex]!;
      // Fresh runtime map per iteration — an extraction in iteration 2 must
      // never see a value left over from iteration 1 (see
      // docs/ARCHITECTURE.md's Milestone 8 section).
      let runtime: Record<string, string> = {};
      const executed = new Set<string>();

      for (const req of flat) {
        if (controller.signal.aborted) break outer;

        if (executed.has(req.id)) {
          continue;
        }

        const outcome = await executeRequestWithDependencies(
          req.id,
          req.name,
          req.request,
          { environment, runtime, iteration: iterationData },
          controller.signal,
          contract.options,
          state.workspace,
          executed,
          (stepId, _stepName) => {
            setItem(iterationIndex, stepId, { status: "running" });
          },
          (stepId, _stepName, stepOutcome) => {
            if (contract.specId && stepOutcome.contractResult?.operation) {
              useContractStore.getState().recordValidatedOperation(contract.specId, stepOutcome.contractResult.operation.id);
            }

            const assertionStatus = !stepOutcome.ok ? "error" : (stepOutcome.testResult?.status ?? "passed");
            const contractFailed = stepOutcome.contractResult !== undefined && !stepOutcome.contractResult.valid;
            const itemStatus =
              contractFailed && (assertionStatus === "passed" || assertionStatus === "skipped")
                ? "contract-failed"
                : assertionStatus;

            setItem(iterationIndex, stepId, {
              status: itemStatus,
              response: stepOutcome.response,
              testResult: stepOutcome.testResult,
              validationError: stepOutcome.validationError,
              extractionResults: stepOutcome.extractionResults,
              contractResult: stepOutcome.contractResult,
            });

            if (stepOutcome.ok && stepOutcome.extractedVariables) {
              runtime = { ...runtime, ...stepOutcome.extractedVariables };
            }
          }
        );

        if (controller.signal.aborted) break outer;

        const assertionStatus = !outcome.ok ? "error" : (outcome.testResult?.status ?? "passed");
        const contractFailed = outcome.contractResult !== undefined && !outcome.contractResult.valid;
        const itemStatus =
          contractFailed && (assertionStatus === "passed" || assertionStatus === "skipped")
            ? "contract-failed"
            : assertionStatus;

        if (stopOnFailure && (itemStatus === "failed" || itemStatus === "error" || itemStatus === "contract-failed")) {
          break outer;
        }
      }
    }

    const wasCancelled = controller.signal.aborted;

    // ---------------------------------------------------------------------
    // Security pass (Milestone 12, spec §32)
    //
    // Runs *after* the functional pass, never interleaved with it. Two
    // reasons. First, a security test deliberately removes the credential or
    // corrupts the body; doing that between two chained functional requests
    // would poison the runtime variables the second one depends on. Second,
    // keeping the passes separate is what lets the report show Functional /
    // Contract / Security counts that each mean exactly one thing.
    //
    // Results are categorised by the engine and stored separately — they are
    // never folded into the Runner's own pass/fail totals (spec §22).
    // ---------------------------------------------------------------------
    if (!wasCancelled && get().runnerIncludeSecurity) {
      const securityState = useSecurityStore.getState();
      const runnableIds = new Set(flat.map((entry) => entry.id));
      const applicable = securityState.security.tests.filter(
        (test) => test.enabled && runnableIds.has(test.targetRequestId),
      );

      if (applicable.length > 0) {
        const outcome = await runSecurityTests({
          tests: applicable,
          resolveRequest: (requestId) => {
            const entry = flat.find((candidate) => candidate.id === requestId);
            if (!entry) return null;
            const resolved = resolveSecurityRequest(
              entry.id,
              entry.name,
              entry.request,
              { environment },
              contract.options?.contract ?? null,
            );
            return resolved.ok && resolved.request ? resolved.request : null;
          },
          executor: browserSecurityExecutor,
          confirmedHosts: securityState.confirmedHosts,
          signal: controller.signal,
        });

        set({ runnerSecurityResults: outcome.results });
      }
    }

    set((s) => ({
      runnerAbortController: null,
      runnerState: {
        ...s.runnerState,
        status: wasCancelled ? "cancelled" : "completed",
        iterations: s.runnerState.iterations.map((iteration) => ({
          ...iteration,
          items: iteration.items.map((item) =>
            item.status === "pending" ? { ...item, status: wasCancelled ? "cancelled" : "skipped" } : item,
          ),
        })),
        durationMs: Date.now() - (s.runnerState.startedAt ?? Date.now()),
      },
    }));
  },

  cancelRunner: () => {
    get().runnerAbortController?.abort();
  },

  resetRunner: () => set({ runnerState: createIdleRunnerState(), runnerAbortController: null }),
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

let lastHistory = useAppStore.getState().history;
useAppStore.subscribe((state) => {
  if (state.history !== lastHistory) {
    lastHistory = state.history;
    saveHistoryToStorage(state.history);
  }
});

