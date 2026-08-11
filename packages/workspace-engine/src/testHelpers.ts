import type { RequestConfig } from "./types";

export function sampleRequestConfig(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    method: "GET",
    url: "https://example.com/users",
    params: [],
    headers: [],
    authType: "none",
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    ...overrides,
  };
}
