import { describe, expect, it } from "vitest";
import { createEmptyEnvironmentWorkspace } from "./index.ts";
import { createEnvironment, deleteEnvironment, duplicateEnvironment, renameEnvironment, setActiveEnvironment } from "./environment.ts";
import { addVariable, removeVariable, updateVariable } from "./variable.ts";

describe("environment CRUD", () => {
  it("creates an environment", () => {
    const { workspace, environmentId } = createEnvironment(createEmptyEnvironmentWorkspace(), "Development");
    expect(workspace.environments).toHaveLength(1);
    expect(workspace.environments[0]!.id).toBe(environmentId);
    expect(workspace.environments[0]!.name).toBe("Development");
    expect(workspace.environments[0]!.variables).toEqual([]);
  });

  it("renames an environment", () => {
    const { workspace, environmentId } = createEnvironment(createEmptyEnvironmentWorkspace(), "Dev");
    const renamed = renameEnvironment(workspace, environmentId, "Development");
    expect(renamed.environments[0]!.name).toBe("Development");
  });

  it("deletes an environment", () => {
    const { workspace, environmentId } = createEnvironment(createEmptyEnvironmentWorkspace(), "Dev");
    const deleted = deleteEnvironment(workspace, environmentId);
    expect(deleted.environments).toHaveLength(0);
  });

  it("switching to No Environment when the active environment is deleted", () => {
    let workspace = createEmptyEnvironmentWorkspace();
    const created = createEnvironment(workspace, "Dev");
    workspace = created.workspace;
    workspace = setActiveEnvironment(workspace, created.environmentId);
    expect(workspace.activeEnvironmentId).toBe(created.environmentId);

    workspace = deleteEnvironment(workspace, created.environmentId);
    expect(workspace.activeEnvironmentId).toBeNull();
  });

  it("duplicating an environment creates independent variables with new IDs", () => {
    let workspace = createEmptyEnvironmentWorkspace();
    const created = createEnvironment(workspace, "Dev");
    workspace = created.workspace;
    const withVar = addVariable(workspace, created.environmentId);
    workspace = updateVariable(withVar.workspace, created.environmentId, withVar.variableId, {
      key: "baseUrl",
      value: "https://dev.example.com",
    });

    const dup = duplicateEnvironment(workspace, created.environmentId);
    workspace = dup.workspace;
    const original = workspace.environments.find((e) => e.id === created.environmentId)!;
    const copy = workspace.environments.find((e) => e.id === dup.environmentId)!;

    expect(copy.name).toBe("Dev Copy");
    expect(copy.variables[0]!.key).toBe("baseUrl");
    expect(copy.variables[0]!.id).not.toBe(original.variables[0]!.id);

    // Changing the copy must not change the original.
    workspace = updateVariable(workspace, dup.environmentId, copy.variables[0]!.id, { value: "https://changed.example.com" });
    const originalAfter = workspace.environments.find((e) => e.id === created.environmentId)!;
    expect(originalAfter.variables[0]!.value).toBe("https://dev.example.com");
  });

  it("setActiveEnvironment(null) clears the active environment", () => {
    let workspace = createEmptyEnvironmentWorkspace();
    const created = createEnvironment(workspace, "Dev");
    workspace = setActiveEnvironment(created.workspace, created.environmentId);
    workspace = setActiveEnvironment(workspace, null);
    expect(workspace.activeEnvironmentId).toBeNull();
  });
});

describe("variable CRUD", () => {
  it("adds, updates, enables/disables, and removes a variable", () => {
    let workspace = createEmptyEnvironmentWorkspace();
    const created = createEnvironment(workspace, "Dev");
    workspace = created.workspace;

    const added = addVariable(workspace, created.environmentId);
    workspace = added.workspace;
    expect(workspace.environments[0]!.variables).toHaveLength(1);

    workspace = updateVariable(workspace, created.environmentId, added.variableId, {
      key: "token",
      value: "abc123",
      secret: true,
    });
    const variable = workspace.environments[0]!.variables[0]!;
    expect(variable.key).toBe("token");
    expect(variable.value).toBe("abc123");
    expect(variable.secret).toBe(true);
    expect(variable.enabled).toBe(true);

    workspace = updateVariable(workspace, created.environmentId, added.variableId, { enabled: false });
    expect(workspace.environments[0]!.variables[0]!.enabled).toBe(false);

    workspace = removeVariable(workspace, created.environmentId, added.variableId);
    expect(workspace.environments[0]!.variables).toHaveLength(0);
  });
});
