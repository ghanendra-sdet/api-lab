import type { Environment, EnvironmentWorkspace } from "./types";

export function findEnvironment(workspace: EnvironmentWorkspace, environmentId: string): Environment {
  const environment = workspace.environments.find((e) => e.id === environmentId);
  if (!environment) throw new Error(`Environment not found: ${environmentId}`);
  return environment;
}

export function replaceEnvironment(
  workspace: EnvironmentWorkspace,
  environmentId: string,
  fn: (environment: Environment) => Environment,
): EnvironmentWorkspace {
  return {
    ...workspace,
    environments: workspace.environments.map((e) => (e.id === environmentId ? fn(e) : e)),
  };
}

export function touch(): string {
  return new Date().toISOString();
}
