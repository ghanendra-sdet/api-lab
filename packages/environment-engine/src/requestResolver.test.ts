import { describe, expect, it } from "vitest";
import { resolveRequestConfig, type ResolvableRequestConfig } from "./requestResolver.ts";

function config(overrides: Partial<ResolvableRequestConfig> = {}): ResolvableRequestConfig {
  return {
    url: "",
    params: [],
    headers: [],
    bodyRawContent: "",
    ...overrides,
  };
}

describe("resolveRequestConfig", () => {
  it("resolves variables in the URL", () => {
    const result = resolveRequestConfig(config({ url: "{{baseUrl}}/users/{{userId}}" }), {
      baseUrl: "https://api.example.com",
      userId: "123",
    });
    expect(result.resolved.url).toBe("https://api.example.com/users/123");
    expect(result.unresolvedVariables).toEqual([]);
  });

  it("resolves variables in query parameter values", () => {
    const result = resolveRequestConfig(
      config({ params: [{ id: "1", key: "search", value: "{{term}}", enabled: true }] }),
      { term: "api-lab" },
    );
    expect(result.resolved.params[0]!.value).toBe("api-lab");
  });

  it("resolves variables in header values", () => {
    const result = resolveRequestConfig(
      config({ headers: [{ id: "1", key: "Authorization", value: "Bearer {{token}}", enabled: true }] }),
      { token: "abc123" },
    );
    expect(result.resolved.headers[0]!.value).toBe("Bearer abc123");
  });

  it("resolves variables inside the JSON body", () => {
    const result = resolveRequestConfig(config({ bodyRawContent: '{"id": "{{userId}}"}' }), { userId: "123" });
    expect(result.resolved.bodyRawContent).toBe('{"id": "123"}');
  });

  it("collects unresolved variables across every field", () => {
    const result = resolveRequestConfig(
      config({
        url: "{{baseUrl}}/x",
        headers: [{ id: "1", key: "X-Token", value: "{{missingHeader}}", enabled: true }],
        bodyRawContent: "{{missingBody}}",
      }),
      {},
    );
    expect(result.unresolvedVariables.sort()).toEqual(["baseUrl", "missingBody", "missingHeader"]);
  });

  it("does not mutate the input config", () => {
    const input = config({ url: "{{baseUrl}}" });
    resolveRequestConfig(input, { baseUrl: "https://example.com" });
    expect(input.url).toBe("{{baseUrl}}");
  });
});
