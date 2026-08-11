import { describe, expect, it } from "vitest";
import type { ApiResponseResult } from "@api-lab/request-engine";
import { extractAll, extractValue } from "./extract";
import { createExtraction } from "./factory";
import type { Extraction } from "./types";

function response(overrides: Partial<ApiResponseResult> = {}): ApiResponseResult {
  return {
    status: 200,
    statusText: "OK",
    ok: true,
    headers: { "content-type": "application/json", location: "/users/42" },
    body: { data: { token: "abc123", id: 7 }, items: [{ id: 1 }, { id: 2 }] },
    rawBody: "{}",
    bodyKind: "json",
    duration: 10,
    size: 20,
    sizeSource: "decoded-body-bytes",
    error: null,
    ...overrides,
  };
}

function extraction(overrides: Partial<Extraction>): Extraction {
  return { ...createExtraction("json"), ...overrides };
}

describe("extractValue — json source", () => {
  it("extracts a nested string value", () => {
    const result = extractValue(extraction({ source: "json", path: "$.data.token", variable: "token" }), response());
    expect(result.ok).toBe(true);
    expect(result.value).toBe("abc123");
  });

  it("extracts a numeric value as a string", () => {
    const result = extractValue(extraction({ source: "json", path: "$.data.id", variable: "id" }), response());
    expect(result.ok).toBe(true);
    expect(result.value).toBe("7");
  });

  it("fails deterministically (not an empty string) for a missing path", () => {
    const result = extractValue(extraction({ source: "json", path: "$.data.missing", variable: "x" }), response());
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it("fails for a non-JSON response", () => {
    const result = extractValue(
      extraction({ source: "json", path: "$.data.token", variable: "token" }),
      response({ bodyKind: "text", body: "plain" }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not JSON/i);
  });

  it("fails on malformed JSON path syntax", () => {
    const result = extractValue(extraction({ source: "json", path: "$.a[*]", variable: "x" }), response());
    expect(result.ok).toBe(false);
  });

  it("extracts an array element", () => {
    const result = extractValue(extraction({ source: "json", path: "$.items[1].id", variable: "secondId" }), response());
    expect(result.ok).toBe(true);
    expect(result.value).toBe("2");
  });
});

describe("extractValue — header source", () => {
  it("extracts a header value case-insensitively", () => {
    const result = extractValue(extraction({ source: "header", path: "Location", variable: "resourceUrl" }), response());
    expect(result.ok).toBe(true);
    expect(result.value).toBe("/users/42");
  });

  it("fails deterministically for a missing header", () => {
    const result = extractValue(extraction({ source: "header", path: "X-Missing", variable: "x" }), response());
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("extractAll", () => {
  it("collects successful extractions into a variable map and reports failures separately", () => {
    const extractions: Extraction[] = [
      extraction({ source: "json", path: "$.data.token", variable: "token" }),
      extraction({ source: "json", path: "$.data.missing", variable: "missingVar" }),
      extraction({ source: "header", path: "location", variable: "resourceUrl" }),
    ];
    const { variables, results } = extractAll(extractions, response());

    expect(variables).toEqual({ token: "abc123", resourceUrl: "/users/42" });
    expect(variables).not.toHaveProperty("missingVar");
    expect(results).toHaveLength(3);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("skips disabled extractions entirely", () => {
    const extractions: Extraction[] = [extraction({ source: "json", path: "$.data.token", variable: "token", enabled: false })];
    const { variables, results } = extractAll(extractions, response());
    expect(variables).toEqual({});
    expect(results).toEqual([]);
  });

  it("never mutates the response", () => {
    const res = response();
    const snapshot = JSON.stringify(res);
    extractAll([extraction({ source: "json", path: "$.data.token", variable: "token" })], res);
    expect(JSON.stringify(res)).toBe(snapshot);
  });
});
