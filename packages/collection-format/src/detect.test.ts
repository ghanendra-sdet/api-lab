import { describe, expect, it } from "vitest";
import { detectFormat } from "./detect";

describe("detectFormat", () => {
  it("detects a Postman collection", () => {
    expect(detectFormat({ info: { name: "X", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [] })).toBe(
      "postman-collection",
    );
  });

  it("detects a Postman environment", () => {
    expect(detectFormat({ name: "Dev", values: [{ key: "a", value: "b" }] })).toBe("postman-environment");
  });

  it("detects an OpenAPI 3.x document", () => {
    expect(detectFormat({ openapi: "3.0.3", info: { title: "X" }, paths: {} })).toBe("openapi");
  });

  it("does not detect an OpenAPI 2.0 (Swagger) document as OpenAPI 3.x", () => {
    expect(detectFormat({ swagger: "2.0", info: { title: "X" } })).toBe("unknown");
  });

  it("detects an API Lab native export", () => {
    expect(detectFormat({ format: "api-lab", version: 1, workspace: {}, environments: {} })).toBe("api-lab-native");
  });

  it("returns unknown for an unrecognizable object", () => {
    expect(detectFormat({ hello: "world" })).toBe("unknown");
  });

  it("returns unknown for non-object input", () => {
    expect(detectFormat(null)).toBe("unknown");
    expect(detectFormat("string")).toBe("unknown");
    expect(detectFormat([1, 2, 3])).toBe("unknown");
    expect(detectFormat(42)).toBe("unknown");
  });
});
