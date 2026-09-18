import { beforeEach, describe, expect, it } from "vitest";
import { createCollection, createEmptyWorkspace, serializeWorkspace } from "@api-lab/workspace-engine";
import {
  createEmptyEnvironmentWorkspace,
  createEnvironment,
  serializeEnvironments,
} from "@api-lab/environment-engine";
import {
  loadWorkspaceFromStorage,
  resetWorkspaceStorage,
  loadTabsFromStorage,
  loadEnvironmentsFromStorage,
  resetEnvironmentsStorage,
  loadRunnerHistoryFromStorage,
  resetRunnerHistoryStorage,
  loadWorkspaceRegistryFromStorage,
  workspaceStorageKey,
  LEGACY_WORKSPACE_ID,
} from "./persistence";

const WORKSPACE_KEY = "api-lab-workspace";
const TABS_KEY = "api-lab-tabs";
const ENVIRONMENTS_KEY = "api-lab-environments";

describe("persistence: workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reports empty when nothing is stored", () => {
    expect(loadWorkspaceFromStorage(LEGACY_WORKSPACE_ID)).toEqual({ status: "empty" });
  });

  it("round-trips a valid persisted workspace", () => {
    const { workspace } = createCollection(createEmptyWorkspace(), "Coll");
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(workspace)));

    const result = loadWorkspaceFromStorage(LEGACY_WORKSPACE_ID);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.workspace.collections[0]!.name).toBe("Coll");
    }
  });

  it("returns an error (not a throw) for malformed JSON", () => {
    window.localStorage.setItem(WORKSPACE_KEY, "{not json");
    const result = loadWorkspaceFromStorage(LEGACY_WORKSPACE_ID);
    expect(result.status).toBe("error");
  });

  it("returns an error (not a throw) for a structurally invalid workspace", () => {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, workspace: { collections: "nope" } }));
    const result = loadWorkspaceFromStorage(LEGACY_WORKSPACE_ID);
    expect(result.status).toBe("error");
  });

  it("returns an error for an unsupported future version", () => {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 999, workspace: { collections: [] } }));
    const result = loadWorkspaceFromStorage(LEGACY_WORKSPACE_ID);
    expect(result.status).toBe("error");
  });

  it("resetWorkspaceStorage clears the stored workspace", () => {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(createEmptyWorkspace())));
    resetWorkspaceStorage(LEGACY_WORKSPACE_ID);
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBeNull();
  });
});

describe("persistence: workspace registry migration (zero-data-loss)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("a brand-new install (no legacy key) gets a single default workspace, empty", () => {
    const result = loadWorkspaceRegistryFromStorage();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.migrated).toBe(true);
    expect(result.registry.workspaces).toHaveLength(1);
    expect(result.registry.workspaces[0]!.id).toBe(LEGACY_WORKSPACE_ID);
    expect(result.registry.activeWorkspaceId).toBe(LEGACY_WORKSPACE_ID);
    // The legacy workspace's data key is untouched — nothing written there.
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBeNull();
  });

  it("an existing single-workspace user's data becomes exactly one default workspace, byte-identical, never duplicated", () => {
    const { workspace } = createCollection(createEmptyWorkspace(), "Pre-existing Collection");
    const persistedBlob = JSON.stringify(serializeWorkspace(workspace));
    window.localStorage.setItem(WORKSPACE_KEY, persistedBlob);

    const registryResult = loadWorkspaceRegistryFromStorage();
    expect(registryResult.status).toBe("ok");
    if (registryResult.status !== "ok") return;
    expect(registryResult.migrated).toBe(true);
    expect(registryResult.registry.workspaces).toHaveLength(1);
    expect(registryResult.registry.workspaces[0]!.id).toBe(LEGACY_WORKSPACE_ID);
    expect(registryResult.registry.activeWorkspaceId).toBe(LEGACY_WORKSPACE_ID);

    // The legacy key's bytes are exactly what they were before migration —
    // never rewritten, never duplicated elsewhere.
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBe(persistedBlob);
    expect(workspaceStorageKey(LEGACY_WORKSPACE_ID)).toBe(WORKSPACE_KEY);

    // And it loads back as the same data, through the normal per-workspace load path.
    const loaded = loadWorkspaceFromStorage(LEGACY_WORKSPACE_ID);
    expect(loaded.status).toBe("ok");
    if (loaded.status === "ok") {
      expect(loaded.workspace.collections[0]!.name).toBe("Pre-existing Collection");
    }
  });

  it("only migrates once — a second load reads the now-persisted registry, not a fresh migration", () => {
    window.localStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify(serializeWorkspace(createCollection(createEmptyWorkspace(), "X").workspace)),
    );
    const first = loadWorkspaceRegistryFromStorage();
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.migrated).toBe(true);

    const second = loadWorkspaceRegistryFromStorage();
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.migrated).toBe(false);
    expect(second.registry).toEqual(first.registry);
  });

  it("a new (non-legacy) workspace gets its own storage key, distinct from the legacy key", () => {
    expect(workspaceStorageKey("ws_abc123")).not.toBe(WORKSPACE_KEY);
    expect(workspaceStorageKey("ws_abc123")).toContain("ws_abc123");
  });
});

describe("persistence: tabs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("falls back to null when nothing is stored", () => {
    expect(loadTabsFromStorage()).toBeNull();
  });

  it("falls back to null on malformed JSON rather than throwing", () => {
    window.localStorage.setItem(TABS_KEY, "{not json");
    expect(loadTabsFromStorage()).toBeNull();
  });

  it("falls back to null when activeTabId doesn't match any tab", () => {
    window.localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ tabs: [{ id: "a" }], activeTabId: "does-not-exist", environment: "none" }),
    );
    expect(loadTabsFromStorage()).toBeNull();
  });

  it("loads a well-formed tabs blob", () => {
    const blob = { tabs: [{ id: "a" }], activeTabId: "a" };
    window.localStorage.setItem(TABS_KEY, JSON.stringify(blob));
    expect(loadTabsFromStorage()).toEqual(blob);
  });
});

describe("persistence: environments", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reports empty when nothing is stored", () => {
    expect(loadEnvironmentsFromStorage()).toEqual({ status: "empty" });
  });

  it("round-trips a valid persisted environment workspace", () => {
    const { workspace } = createEnvironment(createEmptyEnvironmentWorkspace(), "Development");
    window.localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify(serializeEnvironments(workspace)));

    const result = loadEnvironmentsFromStorage();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.environments[0]!.name).toBe("Development");
    }
  });

  it("returns an error (not a throw) for malformed JSON", () => {
    window.localStorage.setItem(ENVIRONMENTS_KEY, "{not json");
    expect(loadEnvironmentsFromStorage().status).toBe("error");
  });

  it("returns an error for a structurally invalid environment workspace", () => {
    window.localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify({ version: 1, data: { environments: "nope" } }));
    expect(loadEnvironmentsFromStorage().status).toBe("error");
  });

  it("returns an error for an unsupported future version", () => {
    window.localStorage.setItem(
      ENVIRONMENTS_KEY,
      JSON.stringify({ version: 999, data: { environments: [], activeEnvironmentId: null } }),
    );
    expect(loadEnvironmentsFromStorage().status).toBe("error");
  });

  it("resetEnvironmentsStorage clears the stored environments", () => {
    window.localStorage.setItem(
      ENVIRONMENTS_KEY,
      JSON.stringify(serializeEnvironments(createEmptyEnvironmentWorkspace())),
    );
    resetEnvironmentsStorage();
    expect(window.localStorage.getItem(ENVIRONMENTS_KEY)).toBeNull();
  });
});

describe("persistence: runner history", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reports empty [] when nothing is stored", () => {
    expect(loadRunnerHistoryFromStorage()).toEqual([]);
  });

  it("returns empty [] (not a throw) for malformed JSON", () => {
    window.localStorage.setItem("api-lab-runner-history", "{not json");
    expect(loadRunnerHistoryFromStorage()).toEqual([]);
  });

  it("returns empty [] (not a throw) for structurally invalid history item", () => {
    window.localStorage.setItem(
      "api-lab-runner-history",
      JSON.stringify([{ invalidField: "should be ignored" }]),
    );
    expect(loadRunnerHistoryFromStorage()).toEqual([]);
  });

  it("round-trips a valid persisted run history item", () => {
    const validItem = {
      id: "run_123",
      startedAt: 1000,
      endedAt: 1050,
      collectionId: "col_1",
      collectionName: "Col A",
      folderId: null,
      folderName: null,
      environmentId: null,
      environmentName: null,
      iterationCount: 1,
      hasDataset: false,
      datasetName: null,
      totalRequests: 1,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      overallStatus: "passed",
      stopOnFailure: true,
      iterations: [],
    };
    window.localStorage.setItem("api-lab-runner-history", JSON.stringify([validItem]));

    const result = loadRunnerHistoryFromStorage();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("run_123");
    expect(result[0]!.collectionName).toBe("Col A");
  });

  it("resetRunnerHistoryStorage clears the stored runner history", () => {
    window.localStorage.setItem("api-lab-runner-history", JSON.stringify([{ id: "run_1" }]));
    resetRunnerHistoryStorage();
    expect(window.localStorage.getItem("api-lab-runner-history")).toBeNull();
  });
});
