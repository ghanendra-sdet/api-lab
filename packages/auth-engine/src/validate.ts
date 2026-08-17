import type { AuthConfig, AuthValidationError } from "./types.ts";

/** Pre-send validation — mirrors request-engine's validateUrl/validateJsonBody
 * pattern: returns a typed error instead of throwing, so the caller can
 * surface it the same way and refuse to send a malformed configuration. */
export function validateAuthConfig(config: AuthConfig): AuthValidationError | null {
  switch (config.type) {
    case "none":
    case "inherit":
      return null;
    case "apiKey":
      if (config.key.trim() === "") return { field: "auth", message: "API key name is required." };
      if (config.value.trim() === "") return { field: "auth", message: "API key value is required." };
      return null;
    case "basic":
      if (config.username.trim() === "") return { field: "auth", message: "Username is required." };
      if (config.password.trim() === "") return { field: "auth", message: "Password is required." };
      return null;
    case "bearer":
      if (config.token.trim() === "") return { field: "auth", message: "Bearer token is required." };
      return null;
    case "jwt":
      if (config.token.trim() === "") return { field: "auth", message: "JWT token is required." };
      return null;
    case "oauth2":
      return {
        field: "auth",
        message: "OAuth 2.0 support is planned but not yet implemented — choose another authorization type to send this request.",
      };
  }
}
