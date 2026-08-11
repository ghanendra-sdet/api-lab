import { describe, expect, it } from "vitest";
import { createCollection, createFolder, createRequest } from "@api-lab/workspace-engine";
import { createEmptyEnvironmentWorkspace, createEnvironment, addVariable, updateVariable } from "@api-lab/environment-engine";
import { emptyRequestConfig } from "../internal";
import { exportNativeWorkspace } from "./export";
import { parseNativeExport, adaptNativeExport } from "./import";
import { NATIVE_FORMAT_VERSION } from "./schema";

describe("native export/import round-trip", () => {
  it("stamps the current format version", () => {
    const exported = exportNativeWorkspace({ collections: [] }, createEmptyEnvironmentWorkspace());
    expect(exported.format).toBe("api-lab");
    expect(exported.version).toBe(NATIVE_FORMAT_VERSION);
  });

  it("round-trips a workspace with a folder, a request, and an environment", () => {
    let workspace = createCollection({ collections: [] }, "My Collection").workspace;
    const collectionId = workspace.collections[0]!.id;
    const folderResult = createFolder(workspace, collectionId, "My Folder");
    workspace = folderResult.workspace;
    workspace = createRequest(
      workspace,
      { collectionId, folderId: folderResult.folderId },
      "My Request",
      emptyRequestConfig({ url: "https://example.com", auth: { type: "bearer", token: "{{token}}" } }),
    ).workspace;

    let environments = createEnvironment(createEmptyEnvironmentWorkspace(), "Dev").workspace;
    const envId = environments.environments[0]!.id;
    const varResult = addVariable(environments, envId);
    environments = updateVariable(varResult.workspace, envId, varResult.variableId, { key: "token", value: "abc", secret: true });

    const exported = exportNativeWorkspace(workspace, environments);
    const roundTripped = JSON.parse(JSON.stringify(exported));

    const parsed = parseNativeExport(roundTripped);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const normalized = adaptNativeExport(parsed.data);
    expect(normalized.collections[0]!.name).toBe("My Collection");
    const folder = normalized.collections[0]!.items.find((i) => i.type === "folder");
    expect(folder?.type).toBe("folder");
    if (folder?.type === "folder") {
      expect(folder.items[0]!.name).toBe("My Request");
      expect(folder.items[0]!.request.auth).toEqual({ type: "bearer", token: "{{token}}" });
    }
    expect(normalized.environments[0]!.name).toBe("Dev");
    expect(normalized.environments[0]!.variables[0]).toEqual({ key: "token", value: "abc", enabled: true, secret: true });
  });

  it("rejects an unsupported future version", () => {
    const result = parseNativeExport({ format: "api-lab", version: 999, workspace: { collections: [] }, environments: { environments: [], activeEnvironmentId: null } });
    expect(result.ok).toBe(false);
  });

  it("never throws on garbage input", () => {
    expect(() => parseNativeExport(null)).not.toThrow();
    expect(() => parseNativeExport("string")).not.toThrow();
    expect(() => parseNativeExport({ format: "api-lab" })).not.toThrow();
  });
});
