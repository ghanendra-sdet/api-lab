import { describe, expect, it } from "vitest";
import { buildBody } from "./buildBody.ts";

describe("buildBody", () => {
  it("returns no body for mode 'none'", () => {
    expect(buildBody("none", "JSON", "{}")).toEqual({ body: undefined, contentType: undefined });
  });

  it("returns the raw JSON string and application/json content type", () => {
    const result = buildBody("raw", "JSON", '{"a":1}');
    expect(result.body).toBe('{"a":1}');
    expect(result.contentType).toBe("application/json");
  });

  it("returns text/plain for raw Text format", () => {
    const result = buildBody("raw", "Text", "hello");
    expect(result.contentType).toBe("text/plain");
  });

  it("returns no body when raw content is empty", () => {
    expect(buildBody("raw", "JSON", "   ")).toEqual({ body: undefined, contentType: undefined });
  });

  it("returns no body for unimplemented modes (form-data, x-www-form-urlencoded)", () => {
    expect(buildBody("form-data", "JSON", "").body).toBeUndefined();
    expect(buildBody("x-www-form-urlencoded", "JSON", "").body).toBeUndefined();
  });
});
