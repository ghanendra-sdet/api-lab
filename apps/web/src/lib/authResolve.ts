import type { AuthConfig } from "@api-lab/auth-engine";
import { resolveVariables } from "@api-lab/environment-engine";

export interface AuthResolveResult {
  resolved: AuthConfig;
  unresolvedVariables: string[];
  hasCircularReference: boolean;
}

/**
 * Resolves {{variable}} references inside an auth config's string fields
 * (API key value, username/password, bearer/JWT token) against an
 * environment context — the same resolver used for the URL/headers/body,
 * just applied to a different shape. Lives at the app layer rather than in
 * either engine: auth-engine stays environment-agnostic (testable with
 * plain strings), and environment-engine stays auth-agnostic (it has no
 * concept of an AuthConfig) — this is the composition point.
 */
export function resolveAuthConfig(auth: AuthConfig, context: Record<string, string>): AuthResolveResult {
  const unresolved = new Set<string>();
  let hasCircularReference = false;

  function res(input: string): string {
    const result = resolveVariables(input, context);
    result.unresolvedVariables.forEach((name) => unresolved.add(name));
    if (result.hasCircularReference) hasCircularReference = true;
    return result.value;
  }

  let resolved: AuthConfig;
  switch (auth.type) {
    case "apiKey":
      resolved = { ...auth, key: res(auth.key), value: res(auth.value) };
      break;
    case "basic":
      resolved = { ...auth, username: res(auth.username), password: res(auth.password) };
      break;
    case "bearer":
    case "jwt":
      resolved = { ...auth, token: res(auth.token) };
      break;
    default:
      resolved = auth;
  }

  return { resolved, unresolvedVariables: [...unresolved], hasCircularReference };
}
