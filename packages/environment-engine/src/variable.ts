import type { EnvironmentWorkspace, Variable } from "./types.ts";
import { createEnvironmentId } from "./id.ts";
import { findEnvironment, replaceEnvironment, touch } from "./internal.ts";

export function addVariable(
  workspace: EnvironmentWorkspace,
  environmentId: string,
): { workspace: EnvironmentWorkspace; variableId: string } {
  findEnvironment(workspace, environmentId);
  const id = createEnvironmentId("var");
  const variable: Variable = { id, key: "", value: "", enabled: true, secret: false };
  return {
    workspace: replaceEnvironment(workspace, environmentId, (e) => ({
      ...e,
      variables: [...e.variables, variable],
      updatedAt: touch(),
    })),
    variableId: id,
  };
}

export function updateVariable(
  workspace: EnvironmentWorkspace,
  environmentId: string,
  variableId: string,
  patch: Partial<Pick<Variable, "key" | "value" | "enabled" | "secret">>,
): EnvironmentWorkspace {
  findEnvironment(workspace, environmentId);
  return replaceEnvironment(workspace, environmentId, (e) => ({
    ...e,
    variables: e.variables.map((v) => (v.id === variableId ? { ...v, ...patch } : v)),
    updatedAt: touch(),
  }));
}

export function removeVariable(
  workspace: EnvironmentWorkspace,
  environmentId: string,
  variableId: string,
): EnvironmentWorkspace {
  findEnvironment(workspace, environmentId);
  return replaceEnvironment(workspace, environmentId, (e) => ({
    ...e,
    variables: e.variables.filter((v) => v.id !== variableId),
    updatedAt: touch(),
  }));
}
