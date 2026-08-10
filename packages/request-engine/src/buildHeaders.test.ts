import { describe, expect, it } from "vitest";
import { buildHeaders, hasHeader } from "./buildHeaders";

describe("buildHeaders", () => {
  it("includes only enabled headers", () => {
    const headers = buildHeaders([
      { id: "1", key: "Accept", value: "application/json", enabled: true },
      { id: "2", key: "X-Debug", value: "1", enabled: false },
    ]);
    expect(headers).toEqual({ Accept: "application/json" });
  });

  it("excludes rows with an empty key", () => {
    const headers = buildHeaders([{ id: "1", key: "", value: "x", enabled: true }]);
    expect(headers).toEqual({});
  });

  it("allows an empty value on an enabled header", () => {
    const headers = buildHeaders([{ id: "1", key: "X-Empty", value: "", enabled: true }]);
    expect(headers).toEqual({ "X-Empty": "" });
  });

  it("returns an empty object for no rows", () => {
    expect(buildHeaders([])).toEqual({});
  });
});

describe("hasHeader", () => {
  it("matches case-insensitively", () => {
    expect(hasHeader({ "content-type": "text/plain" }, "Content-Type")).toBe(true);
  });

  it("returns false when the header is absent", () => {
    expect(hasHeader({ Accept: "application/json" }, "Content-Type")).toBe(false);
  });
});
