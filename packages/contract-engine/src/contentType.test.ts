import { describe, expect, it } from "vitest";
import { isJsonMediaType, mediaTypeMatches, parseMediaType, selectMediaType } from "./contentType.ts";

describe("parseMediaType", () => {
  it("separates the essence from its parameters", () => {
    expect(parseMediaType("application/json; charset=utf-8")).toEqual({
      essence: "application/json",
      type: "application",
      subtype: "json",
      parameters: { charset: "utf-8" },
    });
  });

  it("lowercases and trims", () => {
    expect(parseMediaType("  APPLICATION/JSON  ")?.essence).toBe("application/json");
  });

  it("unquotes parameter values", () => {
    expect(parseMediaType('text/plain; boundary="a;b"')?.parameters.boundary).toBe("a;b");
  });

  it("rejects values that are not media types", () => {
    expect(parseMediaType("")).toBeNull();
    expect(parseMediaType("notamediatype")).toBeNull();
    expect(parseMediaType("/json")).toBeNull();
    expect(parseMediaType("application/")).toBeNull();
  });
});

describe("mediaTypeMatches (spec §18)", () => {
  it("ignores parameters, so charset never causes a false violation", () => {
    expect(mediaTypeMatches("application/json", "application/json; charset=utf-8")).toBe(true);
  });

  it("does not match a genuinely different type", () => {
    expect(mediaTypeMatches("application/json", "text/plain")).toBe(false);
    expect(mediaTypeMatches("application/json", "application/xml")).toBe(false);
  });

  it("honours subtype and full wildcards on the documented side", () => {
    expect(mediaTypeMatches("application/*", "application/json")).toBe(true);
    expect(mediaTypeMatches("application/*", "text/plain")).toBe(false);
    expect(mediaTypeMatches("*/*", "anything/at-all")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(mediaTypeMatches("Application/JSON", "application/json")).toBe(true);
  });
});

describe("isJsonMediaType", () => {
  it("recognises JSON and the +json structured syntax suffix", () => {
    expect(isJsonMediaType("application/json")).toBe(true);
    expect(isJsonMediaType("application/problem+json")).toBe(true);
    expect(isJsonMediaType("application/vnd.api+json; charset=utf-8")).toBe(true);
  });

  it("does not treat other types as JSON", () => {
    expect(isJsonMediaType("text/plain")).toBe(false);
    expect(isJsonMediaType("application/xml")).toBe(false);
    expect(isJsonMediaType("application/jsonish")).toBe(false);
  });
});

describe("selectMediaType", () => {
  const entries = [{ contentType: "*/*" }, { contentType: "application/json" }];

  it("prefers an exact match over a wildcard documented alongside it", () => {
    expect(selectMediaType(entries, "application/json; charset=utf-8")).toEqual({ contentType: "application/json" });
  });

  it("falls back to the wildcard when nothing matches exactly", () => {
    expect(selectMediaType(entries, "text/csv")).toEqual({ contentType: "*/*" });
  });

  it("returns undefined when nothing matches", () => {
    expect(selectMediaType([{ contentType: "application/json" }], "text/plain")).toBeUndefined();
  });
});
