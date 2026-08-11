import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import type { NormalizedCollectionImport, NormalizedEnvironmentImport } from "@api-lab/collection-format";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";

function resetStore() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    workspace: createEmptyWorkspace(),
    workspaceLoadError: null,
    environments: createEmptyEnvironmentWorkspace(),
    environmentsLoadError: null,
    theme: "light",
    sidebarCollapsed: false,
  });
}

function sampleCollectionImport(name: string): NormalizedCollectionImport {
  return {
    kind: "collection",
    name,
    sourceFormat: "postman-collection",
    warnings: [],
    items: [
      {
        type: "request",
        name: "Get Thing",
        warnings: [],
        request: {
          method: "GET",
          url: "https://example.com",
          params: [],
          headers: [],
          auth: { type: "none" },
          bodyMode: "none",
          bodyRawFormat: "JSON",
          bodyRawContent: "",
        },
      },
    ],
  };
}

function sampleEnvironmentImport(name: string): NormalizedEnvironmentImport {
  return {
    kind: "environment",
    name,
    sourceFormat: "postman-environment",
    warnings: [],
    variables: [{ key: "baseUrl", value: "https://example.com", enabled: true, secret: false }],
  };
}

describe("useAppStore import", () => {
  beforeEach(() => {
    resetStore();
  });

  it("imports a normalized collection into the workspace", () => {
    const { importCollection } = useAppStore.getState();
    const collectionId = importCollection(sampleCollectionImport("Imported API"));

    const state = useAppStore.getState();
    expect(state.workspace.collections).toHaveLength(1);
    expect(state.workspace.collections[0]!.id).toBe(collectionId);
    expect(state.workspace.collections[0]!.name).toBe("Imported API");
    expect(state.workspace.collections[0]!.items[0]!.name).toBe("Get Thing");
  });

  it("renames a colliding collection name rather than overwriting", () => {
    const { createCollection: createStoreCollection, importCollection } = useAppStore.getState();
    createStoreCollection("Payment API");
    importCollection(sampleCollectionImport("Payment API"));

    const names = useAppStore.getState().workspace.collections.map((c) => c.name);
    expect(names).toContain("Payment API");
    expect(names).toContain("Payment API (Imported)");
  });

  it("imports a normalized environment with its variables", () => {
    const { importEnvironment } = useAppStore.getState();
    const environmentId = importEnvironment(sampleEnvironmentImport("Development"));

    const state = useAppStore.getState();
    expect(state.environments.environments[0]!.id).toBe(environmentId);
    expect(state.environments.environments[0]!.variables[0]).toMatchObject({ key: "baseUrl", value: "https://example.com" });
  });

  it("importNativeWorkspace imports both collections and environments", () => {
    const { importNativeWorkspace } = useAppStore.getState();
    importNativeWorkspace({
      kind: "workspace",
      sourceFormat: "api-lab-native",
      warnings: [],
      collections: [sampleCollectionImport("Restored Collection")],
      environments: [sampleEnvironmentImport("Restored Env")],
    });

    const state = useAppStore.getState();
    expect(state.workspace.collections.map((c) => c.name)).toContain("Restored Collection");
    expect(state.environments.environments.map((e) => e.name)).toContain("Restored Env");
  });

  it("imports a collection containing a folder with a nested request", () => {
    const { importCollection } = useAppStore.getState();
    const normalized: NormalizedCollectionImport = {
      kind: "collection",
      name: "Nested Import",
      sourceFormat: "postman-collection",
      warnings: [],
      items: [
        {
          type: "folder",
          name: "Auth",
          items: [
            {
              type: "request",
              name: "Login",
              warnings: [],
              request: {
                method: "POST",
                url: "https://example.com/login",
                params: [],
                headers: [],
                auth: { type: "none" },
                bodyMode: "none",
                bodyRawFormat: "JSON",
                bodyRawContent: "",
              },
            },
          ],
        },
      ],
    };

    importCollection(normalized);
    const collection = useAppStore.getState().workspace.collections.find((c) => c.name === "Nested Import")!;
    const folder = collection.items[0]!;
    expect(folder.type).toBe("folder");
    if (folder.type === "folder") {
      expect(folder.items[0]!.name).toBe("Login");
    }
  });
});
