import type { BodyMode, BodyRawFormat } from "@api-lab/shared";
import type { ValidationError } from "./types.ts";

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

export function validateUrl(rawUrl: string): ValidationError | null {
  const trimmed = rawUrl.trim();
  if (trimmed === "") {
    return { field: "url", message: "Please enter a URL." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { field: "url", message: "Please enter a valid HTTP or HTTPS URL." };
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    return {
      field: "url",
      message: `Please enter a valid HTTP or HTTPS URL (got "${parsed.protocol}").`,
    };
  }

  return null;
}

export function validateJsonBody(
  bodyMode: BodyMode,
  bodyRawFormat: BodyRawFormat,
  bodyRawContent: string,
): ValidationError | null {
  if (bodyMode !== "raw" || bodyRawFormat !== "JSON" || bodyRawContent.trim() === "") {
    return null;
  }

  try {
    JSON.parse(bodyRawContent);
    return null;
  } catch {
    return {
      field: "body",
      message: "Invalid JSON body. Please correct the JSON syntax before sending.",
    };
  }
}
