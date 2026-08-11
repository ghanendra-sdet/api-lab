import type { Environment, EnvironmentWorkspace } from "./types.ts";
import { createEnvironmentId } from "./id.ts";
import { findEnvironment, touch } from "./internal.ts";

export function createEnvironment(
  workspace: EnvironmentWorkspace,
  name: string,
): { workspace: EnvironmentWorkspace; environmentId: string } {
  const id = createEnvironmentId("env");
  const now = touch();
  const environment: Environment = { id, name, variables: [], createdAt: now, updatedAt: now };
  return {
    workspace: { ...workspace, environments: [...workspace.environments, environment] },
    environmentId: id,
  };
}

export function renameEnvironment(
  workspace: EnvironmentWorkspace,
  environmentId: string,
  name: string,
): EnvironmentWorkspace {
  findEnvironment(workspace, environmentId);
  return {
    ...workspace,
    environments: workspace.environments.map((e) =>
      e.id === environmentId ? { ...e, name, updatedAt: touch() } : e,
    ),
  };
}

export function deleteEnvironment(workspace: EnvironmentWorkspace, environmentId: string): EnvironmentWorkspace {
  findEnvironment(workspace, environmentId);
  return {
    environments: workspace.environments.filter((e) => e.id !== environmentId),
    // Never leave the app pointing at a deleted environment.
    activeEnvironmentId: workspace.activeEnvironmentId === environmentId ? null : workspace.activeEnvironmentId,
  };
}

export function duplicateEnvironment(
  workspace: EnvironmentWorkspace,
  environmentId: string,
): { workspace: EnvironmentWorkspace; environmentId: string } {
  const source = findEnvironment(workspace, environmentId);
  const newId = createEnvironmentId("env");
  const now = touch();
  const copy: Environment = {
    id: newId,
    name: `${source.name} Copy`,
    variables: source.variables.map((v) => ({ ...v, id: createEnvironmentId("var") })),
    createdAt: now,
    updatedAt: now,
  };
  const index = workspace.environments.findIndex((e) => e.id === environmentId);
  const environments = [...workspace.environments];
  environments.splice(index + 1, 0, copy);
  return { workspace: { ...workspace, environments }, environmentId: newId };
}

export function setActiveEnvironment(
  workspace: EnvironmentWorkspace,
  environmentId: string | null,
): EnvironmentWorkspace {
  if (environmentId !== null) findEnvironment(workspace, environmentId);
  return { ...workspace, activeEnvironmentId: environmentId };
}
