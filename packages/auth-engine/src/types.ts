/**
 * Serializable authentication configuration. Each variant's fields may
 * contain `{{variable}}` references — auth-engine itself never resolves
 * them (see apply.ts's docstring); the caller resolves the config's string
 * fields via @api-lab/environment-engine before calling applyAuth, exactly
 * like it already does for the URL/headers/body.
 */
export type AuthConfig =
  | { type: "none" }
  | { type: "inherit" }
  | { type: "apiKey"; key: string; value: string; addTo: "header" | "query" }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | { type: "jwt"; token: string }
  /** Architecturally reserved, not executable — see docs/ARCHITECTURE.md
   * and docs/SECURITY.md for why a full OAuth 2.0 flow is deliberately not
   * implemented in this milestone. */
  | { type: "oauth2" };

export type AuthType = AuthConfig["type"];

export const AUTH_TYPES: readonly AuthType[] = ["none", "inherit", "apiKey", "basic", "bearer", "jwt", "oauth2"] as const;

export function createDefaultAuthConfig(type: AuthType): AuthConfig {
  switch (type) {
    case "none":
      return { type: "none" };
    case "inherit":
      return { type: "inherit" };
    case "apiKey":
      return { type: "apiKey", key: "", value: "", addTo: "header" };
    case "basic":
      return { type: "basic", username: "", password: "" };
    case "bearer":
      return { type: "bearer", token: "" };
    case "jwt":
      return { type: "jwt", token: "" };
    case "oauth2":
      return { type: "oauth2" };
  }
}

export interface AuthValidationError {
  field: "auth";
  message: string;
}
