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
} from "./persistence";

const WORKSPACE_KEY = "api-lab-workspace";
const TABS_KEY = "api-lab-tabs";
const ENVIRONMENTS_KEY = "api-lab-environments";

describe("persistence: workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reports empty when nothing is stored", () => {
    expect(loadWorkspaceFromStorage()).toEqual({ status: "empty" });
  });

  it("round-trips a valid persisted workspace", () => {
    const { workspace } = createCollection(createEmptyWorkspace(), "Coll");
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(workspace)));

    const result = loadWorkspaceFromStorage();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.workspace.collections[0]!.name).toBe("Coll");
    }
  });

  it("returns an error (not a throw) for malformed JSON", () => {
    window.localStorage.setItem(WORKSPACE_KEY, "{not json");
    const result = loadWorkspaceFromStorage();
    expect(result.status).toBe("error");
  });

  it("returns an error (not a throw) for a structurally invalid workspace", () => {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, workspace: { collections: "nope" } }));
    const result = loadWorkspaceFromStorage();
    expect(result.status).toBe("error");
  });

  it("returns an error for an unsupported future version", () => {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 999, workspace: { collections: [] } }));
    const result = loadWorkspaceFromStorage();
    expect(result.status).toBe("error");
  });

  it("resetWorkspaceStorage clears the stored workspace", () => {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(createEmptyWorkspace())));
    resetWorkspaceStorage();
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBeNull();
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
