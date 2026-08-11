import { describe, expect, it } from "vitest";
import { buildRequest } from "./buildRequest.ts";
import type { ApiRequestConfig } from "./types.ts";

function baseConfig(overrides: Partial<ApiRequestConfig> = {}): ApiRequestConfig {
  return {
    id: "tab_1",
    name: "Test",
    method: "GET",
    url: "https://example.com/users",
    queryParams: [],
    headers: [],
    authType: "none",
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    ...overrides,
  };
}

describe("buildRequest", () => {
  it("adds Content-Type when a raw body is present and the user set none", () => {
    const built = buildRequest(
      baseConfig({ method: "POST", bodyMode: "raw", bodyRawContent: '{"a":1}' }),
    );
    expect(built.headers["Content-Type"]).toBe("application/json");
    expect(built.body).toBe('{"a":1}');
  });

  it("does not override a user-provided Content-Type", () => {
    const built = buildRequest(
      baseConfig({
        method: "POST",
        bodyMode: "raw",
        bodyRawContent: '{"a":1}',
        headers: [
          { id: "1", key: "Content-Type", value: "application/vnd.custom+json", enabled: true },
        ],
      }),
    );
    expect(built.headers["Content-Type"]).toBe("application/vnd.custom+json");
  });

  it("combines URL, headers, and body end-to-end", () => {
    const built = buildRequest(
      baseConfig({
        queryParams: [{ id: "1", key: "page", value: "2", enabled: true }],
        headers: [{ id: "1", key: "Accept", value: "application/json", enabled: true }],
      }),
    );
    expect(built.url).toBe("https://example.com/users?page=2");
    expect(built.headers.Accept).toBe("application/json");
    expect(built.method).toBe("GET");
  });
});
