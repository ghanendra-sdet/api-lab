import { describe, expect, it } from "vitest";
import { createEmptyEnvironmentWorkspace } from "./index.ts";
import { createEnvironment } from "./environment.ts";
import { addVariable, updateVariable } from "./variable.ts";
import { deserializeEnvironments, serializeEnvironments } from "./serialize.ts";

describe("serializeEnvironments / deserializeEnvironments", () => {
  it("round-trips a workspace with variables", () => {
    let workspace = createEmptyEnvironmentWorkspace();
    const created = createEnvironment(workspace, "Dev");
    workspace = created.workspace;
    const added = addVariable(workspace, created.environmentId);
    workspace = added.workspace;
    workspace = updateVariable(workspace, created.environmentId, added.variableId, {
      key: "token",
      value: "secret-value",
      secret: true,
    });

    const persisted = serializeEnvironments(workspace);
    const result = deserializeEnvironments(JSON.parse(JSON.stringify(persisted)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.environments[0]!.name).toBe("Dev");
      expect(result.data.environments[0]!.variables[0]!.secret).toBe(true);
    }
  });

  it("stamps the current format version", () => {
    const persisted = serializeEnvironments(createEmptyEnvironmentWorkspace());
    expect(persisted.version).toBe(1);
  });

  it("never throws on garbage input", () => {
    const garbageInputs: unknown[] = [null, undefined, 42, "string", [], {}, { version: 1 }, { data: {} }];
    for (const input of garbageInputs) {
      expect(() => deserializeEnvironments(input)).not.toThrow();
    }
  });

  it("rejects a missing version field", () => {
    const result = deserializeEnvironments({ data: { environments: [], activeEnvironmentId: null } });
    expect(result.ok).toBe(false);
  });

  it("rejects an unsupported future version", () => {
    const result = deserializeEnvironments({ version: 999, data: { environments: [], activeEnvironmentId: null } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported-version");
  });

  it("rejects a structurally invalid workspace", () => {
    const result = deserializeEnvironments({ version: 1, data: { environments: "not-an-array" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-shape");
  });

  it("rejects a variable missing required fields", () => {
    const result = deserializeEnvironments({
      version: 1,
      data: {
        environments: [{ id: "e1", name: "Dev", variables: [{ key: "x" }], createdAt: "", updatedAt: "" }],
        activeEnvironmentId: null,
      },
    });
    expect(result.ok).toBe(false);
  });
});
