import { describe, expect, it } from "vitest";
import { applyAuth } from "./apply";
import type { KeyValueRow } from "@api-lab/shared";

function row(key: string, value: string): KeyValueRow {
  return { id: `r_${key}`, key, value, enabled: true };
}

describe("applyAuth", () => {
  it("No Auth adds no headers and leaves existing headers untouched", () => {
    const headers = [row("X-Custom", "1")];
    const result = applyAuth({ type: "none" }, headers, []);
    expect(result.headers).toEqual(headers);
    expect(result.params).toEqual([]);
  });

  it("API Key (header) adds the configured header", () => {
    const result = applyAuth({ type: "apiKey", key: "X-API-Key", value: "abc123", addTo: "header" }, [], []);
    expect(result.headers).toEqual([expect.objectContaining({ key: "X-API-Key", value: "abc123" })]);
    expect(result.params).toEqual([]);
  });

  it("API Key (query) adds the configured query parameter", () => {
    const result = applyAuth({ type: "apiKey", key: "api_key", value: "abc123", addTo: "query" }, [], []);
    expect(result.params).toEqual([expect.objectContaining({ key: "api_key", value: "abc123" })]);
    expect(result.headers).toEqual([]);
  });

  it("Basic auth generates a correctly base64-encoded Authorization header", () => {
    const result = applyAuth({ type: "basic", username: "alice", password: "wonderland" }, [], []);
    const header = result.headers.find((h) => h.key === "Authorization")!;
    expect(header.value).toBe(`Basic ${btoa("alice:wonderland")}`);
  });

  it("Bearer auth generates the Authorization header", () => {
    const result = applyAuth({ type: "bearer", token: "abc123" }, [], []);
    expect(result.headers).toEqual([expect.objectContaining({ key: "Authorization", value: "Bearer abc123" })]);
  });

  it("JWT auth generates the Authorization header the same way as Bearer", () => {
    const result = applyAuth({ type: "jwt", token: "xyz789" }, [], []);
    expect(result.headers).toEqual([expect.objectContaining({ key: "Authorization", value: "Bearer xyz789" })]);
  });

  it("OAuth2 (not executable) adds nothing", () => {
    const result = applyAuth({ type: "oauth2" }, [], []);
    expect(result.headers).toEqual([]);
    expect(result.params).toEqual([]);
  });

  it("precedence: auth-generated header replaces a manually entered header of the same name (case-insensitive)", () => {
    const headers = [row("authorization", "Bearer manually-typed")];
    const result = applyAuth({ type: "bearer", token: "real-token" }, headers, []);
    expect(result.headers).toHaveLength(1);
    expect(result.headers[0]!.value).toBe("Bearer real-token");
  });

  it("precedence: API key header replaces a manual header with the same name", () => {
    const headers = [row("X-API-Key", "manual-value")];
    const result = applyAuth({ type: "apiKey", key: "X-API-Key", value: "generated-value", addTo: "header" }, headers, []);
    expect(result.headers).toHaveLength(1);
    expect(result.headers[0]!.value).toBe("generated-value");
  });

  it("precedence: API key query param replaces a manual param with the same (case-sensitive) key", () => {
    const params = [row("api_key", "manual"), row("API_KEY", "different-case-untouched")];
    const result = applyAuth({ type: "apiKey", key: "api_key", value: "generated", addTo: "query" }, [], params);
    expect(result.params).toHaveLength(2);
    expect(result.params.find((p) => p.key === "api_key")!.value).toBe("generated");
    expect(result.params.find((p) => p.key === "API_KEY")!.value).toBe("different-case-untouched");
  });

  it("does not disturb unrelated headers", () => {
    const headers = [row("X-Custom", "keep-me")];
    const result = applyAuth({ type: "bearer", token: "abc" }, headers, []);
    expect(result.headers.find((h) => h.key === "X-Custom")).toBeDefined();
    expect(result.headers).toHaveLength(2);
  });
});
