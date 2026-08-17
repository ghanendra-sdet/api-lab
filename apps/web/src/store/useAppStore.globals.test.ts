import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";
import { mergeResolutionContext } from "@api-lab/runner-engine";
import { resolveVariables, buildVariableContextFromVariables } from "@api-lab/environment-engine";

function resetStore() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    workspace: createEmptyWorkspace(),
    workspaceLoadError: null,
    environments: createEmptyEnvironmentWorkspace(),
    environmentsLoadError: null,
    globals: [],
    globalsLoadError: null,
    theme: "light",
    sidebarCollapsed: false,
    requestStatus: {},
    responses: {},
    sendErrors: {},
  });
}

describe("useAppStore global variable actions", () => {
  beforeEach(() => {
    resetStore();
  });

  it("creates, updates, and deletes a global variable", () => {
    const { addGlobalVariable, updateGlobalVariable, removeGlobalVariable } = useAppStore.getState();

    // 1. Creation
    const id = addGlobalVariable();
    expect(useAppStore.getState().globals).toHaveLength(1);
    expect(useAppStore.getState().globals[0]!.id).toBe(id);
    expect(useAppStore.getState().globals[0]!.key).toBe("");
    expect(useAppStore.getState().globals[0]!.enabled).toBe(true);

    // 2. Update
    updateGlobalVariable(id, { key: "baseUrl", value: "https://global.api", secret: true });
    expect(useAppStore.getState().globals[0]!.key).toBe("baseUrl");
    expect(useAppStore.getState().globals[0]!.value).toBe("https://global.api");
    expect(useAppStore.getState().globals[0]!.secret).toBe(true);

    // 3. Deletion
    removeGlobalVariable(id);
    expect(useAppStore.getState().globals).toHaveLength(0);
  });

  it("respects enabled/disabled status of global variables", () => {
    const { addGlobalVariable, updateGlobalVariable } = useAppStore.getState();
    const id1 = addGlobalVariable();
    updateGlobalVariable(id1, { key: "a", value: "1", enabled: true });
    const id2 = addGlobalVariable();
    updateGlobalVariable(id2, { key: "b", value: "2", enabled: false });

    const context = buildVariableContextFromVariables(useAppStore.getState().globals);
    expect(context).toEqual({ a: "1" });
  });

  it("resets globals storage cleanly", () => {
    const { addGlobalVariable, resetGlobals } = useAppStore.getState();
    addGlobalVariable();
    expect(useAppStore.getState().globals).toHaveLength(1);

    resetGlobals();
    expect(useAppStore.getState().globals).toHaveLength(0);
  });
});

describe("useAppStore global variables precedence & resolution", () => {
  it("resolves variables with 7-layer precedence shadowing (Global < Environment < Collection < Folder < Request < Runtime < Iteration)", () => {
    const globalContext = { foo: "global", bar: "global", baz: "global", qux: "global", quux: "global", corge: "global", grault: "global" };
    const environmentContext = { bar: "env", baz: "env", qux: "env", quux: "env", corge: "env", grault: "env" };
    const collectionContext = { baz: "col", qux: "col", quux: "col", corge: "col", grault: "col" };
    const folderContext = { qux: "fol", quux: "fol", corge: "fol", grault: "fol" };
    const requestContext = { quux: "req", corge: "req", grault: "req" };
    const runtimeContext = { corge: "run", grault: "run" };
    const iterationContext = { grault: "iter" };

    const merged = mergeResolutionContext({
      global: globalContext,
      environment: environmentContext,
      collection: collectionContext,
      folder: folderContext,
      request: requestContext,
      runtime: runtimeContext,
      iteration: iterationContext,
    });

    // Verify correct precedence shadowing using resolveVariables
    expect(resolveVariables("{{foo}}", merged).value).toBe("global");
    expect(resolveVariables("{{bar}}", merged).value).toBe("env");
    expect(resolveVariables("{{baz}}", merged).value).toBe("col");
    expect(resolveVariables("{{qux}}", merged).value).toBe("fol");
    expect(resolveVariables("{{quux}}", merged).value).toBe("req");
    expect(resolveVariables("{{corge}}", merged).value).toBe("run");
    expect(resolveVariables("{{grault}}", merged).value).toBe("iter");
  });

  it("shadows individual levels one by one correctly", () => {
    const scopes = {
      global: { val: "global" },
      environment: { val: "env" },
    };

    let merged = mergeResolutionContext(scopes);
    expect(resolveVariables("{{val}}", merged).value).toBe("env");

    // Collection overrides environment
    merged = mergeResolutionContext({ ...scopes, collection: { val: "col" } });
    expect(resolveVariables("{{val}}", merged).value).toBe("col");

    // Folder overrides collection
    merged = mergeResolutionContext({ ...scopes, collection: { val: "col" }, folder: { val: "fol" } });
    expect(resolveVariables("{{val}}", merged).value).toBe("fol");

    // Request overrides folder
    merged = mergeResolutionContext({ ...scopes, collection: { val: "col" }, folder: { val: "fol" }, request: { val: "req" } });
    expect(resolveVariables("{{val}}", merged).value).toBe("req");

    // Runtime overrides request
    merged = mergeResolutionContext({ ...scopes, collection: { val: "col" }, folder: { val: "fol" }, request: { val: "req" }, runtime: { val: "run" } });
    expect(resolveVariables("{{val}}", merged).value).toBe("run");

    // Iteration overrides runtime
    merged = mergeResolutionContext({ ...scopes, collection: { val: "col" }, folder: { val: "fol" }, request: { val: "req" }, runtime: { val: "run" }, iteration: { val: "iter" } });
    expect(resolveVariables("{{val}}", merged).value).toBe("iter");
  });

  it("retains missing variables behavior when resolving text", () => {
    const merged = mergeResolutionContext({
      global: { a: "1" },
    });
    const result = resolveVariables("{{a}} - {{b}}", merged);
    expect(result.value).toBe("1 - {{b}}");
    expect(result.unresolvedVariables).toEqual(["b"]);
  });
});
