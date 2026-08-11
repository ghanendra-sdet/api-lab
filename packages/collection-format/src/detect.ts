import type { DetectedFormat } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural detection — never trusts a file extension (files can be
 * renamed/misnamed) and never assumes a single sample shape. Order matters:
 * more specific/unambiguous markers are checked first.
 */
export function detectFormat(raw: unknown): DetectedFormat {
  if (!isRecord(raw)) return "unknown";

  // API Lab's own native envelope is the most specific and unambiguous marker.
  if (raw.format === "api-lab" && typeof raw.version === "number") {
    return "api-lab-native";
  }

  // OpenAPI 3.x: the `openapi` field is a required, unambiguous marker.
  if (typeof raw.openapi === "string" && raw.openapi.startsWith("3.")) {
    return "openapi";
  }

  // Postman Collection v2.x: `info.schema` points at the official schema
  // URL, or `info._postman_id` is present alongside an `item` array.
  if (isRecord(raw.info) && Array.isArray(raw.item)) {
    const schema = raw.info.schema;
    if (typeof schema === "string" && schema.includes("postman.com/json/collection")) {
      return "postman-collection";
    }
    if (typeof raw.info._postman_id === "string" || typeof raw.info.name === "string") {
      return "postman-collection";
    }
  }

  // Postman Environment: `values` array of {key, value, enabled}, and
  // critically no `item` array (which would make it a collection instead).
  if (Array.isArray(raw.values) && !Array.isArray(raw.item)) {
    const looksLikeEnvironment = raw.values.every(
      (v) => isRecord(v) && typeof v.key === "string",
    );
    if (looksLikeEnvironment && (typeof raw.name === "string" || raw._postman_variable_scope === "environment")) {
      return "postman-environment";
    }
  }

  return "unknown";
}
