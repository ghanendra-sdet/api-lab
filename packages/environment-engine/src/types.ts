/**
 * Domain model for environments and variables. Kept independent of React
 * and of workspace-engine — an Environment is a sibling concept to a
 * Collection, not a child of it (see docs/ARCHITECTURE.md, Milestone 4).
 */

export interface Variable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  /** Masked by default in the UI; never included in logs/errors. */
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: Variable[];
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentWorkspace {
  environments: Environment[];
  activeEnvironmentId: string | null;
}

export const ENVIRONMENT_FORMAT_VERSION = 1;

export interface PersistedEnvironments {
  version: number;
  data: EnvironmentWorkspace;
}
