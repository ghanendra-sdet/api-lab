import { describe, expect, it } from "vitest";
import { validateUrl, validateJsonBody } from "./validate.ts";

describe("validateUrl", () => {
  it("rejects an empty URL", () => {
    expect(validateUrl("")).toEqual({ field: "url", message: "Please enter a URL." });
    expect(validateUrl("   ")).toEqual({ field: "url", message: "Please enter a URL." });
  });

  it("rejects a malformed URL", () => {
    const result = validateUrl("not a url");
    expect(result?.field).toBe("url");
  });

  it("rejects an unsupported protocol", () => {
    const result = validateUrl("ftp://example.com/file");
    expect(result?.field).toBe("url");
    expect(result?.message).toContain("ftp:");
  });

  it("accepts a valid http URL", () => {
    expect(validateUrl("http://example.com")).toBeNull();
  });

  it("accepts a valid https URL with a path and query", () => {
    expect(validateUrl("https://example.com/users?page=1")).toBeNull();
  });
});

describe("validateJsonBody", () => {
  it("passes when the mode isn't raw JSON", () => {
    expect(validateJsonBody("none", "JSON", "")).toBeNull();
    expect(validateJsonBody("raw", "Text", "not json")).toBeNull();
  });

  it("passes for empty raw JSON content", () => {
    expect(validateJsonBody("raw", "JSON", "")).toBeNull();
  });

  it("passes for valid JSON", () => {
    expect(validateJsonBody("raw", "JSON", '{"a":1}')).toBeNull();
  });

  it("flags invalid JSON", () => {
    const result = validateJsonBody("raw", "JSON", "{invalid");
    expect(result?.field).toBe("body");
    expect(result?.message).toContain("Invalid JSON");
  });
});
