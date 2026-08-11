import type { RequestConfig } from "./types";

export function sampleRequestConfig(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    method: "GET",
    url: "https://example.com/users",
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
