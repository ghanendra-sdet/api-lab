import type { RequestConfig } from "@api-lab/workspace-engine";

/** Builds a complete `RequestConfig` for tests without repeating every default. */
export function emptyRequestConfigFor(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    method: "GET",
    url: "",
    params: [],
    headers: [],
    auth: { type: "none" },
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    tests: [],
    extractions: [],
    ...overrides,
  };
}
