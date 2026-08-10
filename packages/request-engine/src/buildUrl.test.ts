import { describe, expect, it } from "vitest";
import { buildUrl } from "./buildUrl";

describe("buildUrl", () => {
  it("returns the base URL unchanged when there are no params", () => {
    expect(buildUrl("https://example.com/users", [])).toBe("https://example.com/users");
  });

  it("appends enabled query params", () => {
    const url = buildUrl("https://example.com/users", [
      { id: "1", key: "page", value: "1", enabled: true },
      { id: "2", key: "limit", value: "10", enabled: true },
    ]);
    expect(url).toBe("https://example.com/users?page=1&limit=10");
  });

  it("excludes disabled params", () => {
    const url = buildUrl("https://example.com/users", [
      { id: "1", key: "page", value: "1", enabled: true },
      { id: "2", key: "limit", value: "10", enabled: false },
    ]);
    expect(url).toBe("https://example.com/users?page=1");
  });

  it("excludes rows with an empty key", () => {
    const url = buildUrl("https://example.com/users", [
      { id: "1", key: "", value: "x", enabled: true },
    ]);
    expect(url).toBe("https://example.com/users");
  });

  it("URL-encodes special characters in values", () => {
    const url = buildUrl("https://example.com/search", [
      { id: "1", key: "q", value: "hello world", enabled: true },
    ]);
    expect(url).toBe("https://example.com/search?q=hello+world");
  });

  it("preserves an existing query string on the base URL", () => {
    const url = buildUrl("https://example.com/search?existing=1", [
      { id: "1", key: "q", value: "test", enabled: true },
    ]);
    expect(url).toBe("https://example.com/search?existing=1&q=test");
  });
});
