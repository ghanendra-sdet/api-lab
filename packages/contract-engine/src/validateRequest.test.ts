import { describe, expect, it } from "vitest";
import { parseContract } from "./parse.ts";
import { resolveOperation } from "./operationMatch.ts";
import { coerceParameterValue, validateRequestAgainstOperation, type ContractRequestInput } from "./validateRequest.ts";
import { SPEC_30 } from "./testFixtures.ts";
import type { ContractModel } from "./types.ts";
import type { HttpMethod } from "@api-lab/shared";

function contractFrom(text: string): ContractModel {
  const result = parseContract(text);
  if (!result.ok) throw new Error(result.detail);
  return result.contract;
}

const contract = contractFrom(SPEC_30);

function request(overrides: Partial<ContractRequestInput> = {}): ContractRequestInput {
  return {
    method: "GET",
    path: "/users",
    query: [],
    headers: [],
    cookies: [],
    body: undefined,
    contentType: undefined,
    ...overrides,
  };
}

function validate(method: HttpMethod, path: string, overrides: Partial<ContractRequestInput> = {}) {
  const match = resolveOperation(contract, method, path);
  if (match.status !== "matched") throw new Error(`no operation for ${method} ${path}`);
  return validateRequestAgainstOperation(contract, match.operation, request({ method, path, ...overrides }));
}

describe("coerceParameterValue", () => {
  it("converts a numeric string when the contract declares a number type", () => {
    expect(coerceParameterValue("123", { type: "integer" })).toBe(123);
    expect(coerceParameterValue("1.5", { type: "number" })).toBe(1.5);
    expect(coerceParameterValue("-7", { type: "integer" })).toBe(-7);
  });

  it("leaves a non-numeric string alone so the type mismatch is reported honestly", () => {
    expect(coerceParameterValue("abc", { type: "integer" })).toBe("abc");
    expect(coerceParameterValue("12abc", { type: "integer" })).toBe("12abc");
    expect(coerceParameterValue("", { type: "integer" })).toBe("");
  });

  it("converts booleans only for the two literal spellings", () => {
    expect(coerceParameterValue("true", { type: "boolean" })).toBe(true);
    expect(coerceParameterValue("false", { type: "boolean" })).toBe(false);
    expect(coerceParameterValue("yes", { type: "boolean" })).toBe("yes");
  });

  it("splits a comma-separated list for an array-typed parameter", () => {
    expect(coerceParameterValue("1,2,3", { type: "array", items: { type: "integer" } })).toEqual([1, 2, 3]);
    expect(coerceParameterValue("", { type: "array", items: { type: "string" } })).toEqual([]);
  });

  it("coerces each element of a repeated (exploded) parameter", () => {
    expect(coerceParameterValue(["1", "2"], { type: "array", items: { type: "integer" } })).toEqual([1, 2]);
  });

  it("leaves the value untouched when the contract declares no type", () => {
    expect(coerceParameterValue("123", undefined)).toBe("123");
    expect(coerceParameterValue("123", {})).toBe("123");
  });
});

describe("path parameter validation (spec §7)", () => {
  it("passes when the value matches the declared type", () => {
    const result = validate("GET", "/users/123");
    expect(result.violations).toEqual([]);
  });

  it("fails GET /users/abc against an integer id, naming the parameter", () => {
    // The worked example from spec §7.
    const result = validate("GET", "/users/abc");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      location: "request.path",
      path: "id",
      keyword: "type",
      expected: "integer",
      actual: "string",
      severity: "error",
    });
    expect(result.violations[0]!.message).toContain('Path parameter "id"');
  });
});

describe("query parameter validation (spec §20)", () => {
  it("reports a missing required query parameter", () => {
    const result = validate("GET", "/users");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      location: "request.query",
      path: "status",
      keyword: "required",
      actual: "(absent)",
    });
    expect(result.violations[0]!.message).toContain("status");
  });

  it("passes when the required parameter is present and valid", () => {
    const result = validate("GET", "/users", { query: [{ name: "status", value: "active" }] });
    expect(result.violations).toEqual([]);
  });

  it("reports an enum violation on a query parameter", () => {
    const result = validate("GET", "/users", { query: [{ name: "status", value: "deleted" }] });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ location: "request.query", path: "status", keyword: "enum" });
  });

  it("enforces numeric bounds on an optional parameter that is present", () => {
    const result = validate("GET", "/users", {
      query: [
        { name: "status", value: "active" },
        { name: "limit", value: "500" },
      ],
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ path: "limit", keyword: "maximum" });
  });

  it("does not complain about an absent optional parameter", () => {
    const result = validate("GET", "/users", { query: [{ name: "status", value: "active" }] });
    expect(result.violations).toEqual([]);
  });
});

describe("header and cookie parameter validation (spec §20)", () => {
  const headerContract = contractFrom(
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t" },
      paths: {
        "/h": {
          get: {
            parameters: [
              { name: "X-Tenant", in: "header", required: true, schema: { type: "string" } },
              { name: "session", in: "cookie", required: true, schema: { type: "integer" } },
            ],
            responses: {},
          },
        },
      },
    }),
  );

  function validateHeaders(overrides: Partial<ContractRequestInput>) {
    const match = resolveOperation(headerContract, "GET", "/h");
    if (match.status !== "matched") throw new Error("no match");
    return validateRequestAgainstOperation(headerContract, match.operation, request({ path: "/h", ...overrides }));
  }

  it("matches header names case-insensitively, as HTTP requires", () => {
    const result = validateHeaders({
      headers: [{ name: "x-tenant", value: "acme" }],
      cookies: [{ name: "session", value: "1" }],
    });
    expect(result.violations).toEqual([]);
  });

  it("reports a missing required header", () => {
    const result = validateHeaders({ cookies: [{ name: "session", value: "1" }] });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ location: "request.header", path: "X-Tenant", keyword: "required" });
  });

  it("reports a missing required cookie separately from headers", () => {
    const result = validateHeaders({ headers: [{ name: "X-Tenant", value: "acme" }] });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.location).toBe("request.cookie");
  });

  it("type-checks a cookie value", () => {
    const result = validateHeaders({
      headers: [{ name: "X-Tenant", value: "acme" }],
      cookies: [{ name: "session", value: "abc" }],
    });
    expect(result.violations[0]).toMatchObject({ location: "request.cookie", keyword: "type", expected: "integer" });
  });
});

describe("request body validation (spec §12)", () => {
  const post = { method: "POST" as HttpMethod, path: "/users", contentType: "application/json" };

  it("passes a conforming body", () => {
    const result = validate("POST", "/users", { ...post, body: JSON.stringify({ name: "Test User", age: 20 }) });
    expect(result.violations).toEqual([]);
  });

  it("fails a wrongly-typed property before the request is ever sent", () => {
    // Spec §12's worked example: {"name": "Test User", "age": "twenty"}.
    const result = validate("POST", "/users", {
      ...post,
      body: JSON.stringify({ name: "Test User", age: "twenty" }),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      location: "request.body",
      path: "$.age",
      keyword: "type",
      expected: "integer",
      actual: "string",
    });
  });

  it("reports a missing required property in the body", () => {
    const result = validate("POST", "/users", { ...post, body: JSON.stringify({ age: 20 }) });
    expect(result.violations[0]).toMatchObject({ path: "$.name", keyword: "required" });
  });

  it("reports a missing required body", () => {
    const result = validate("POST", "/users", { ...post, body: undefined });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ location: "request.body", keyword: "required" });
  });

  it("reports an undocumented request content type", () => {
    const result = validate("POST", "/users", { ...post, contentType: "text/plain", body: "hello" });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      location: "request.contentType",
      expected: "application/json",
      actual: "text/plain",
    });
  });

  it("accepts a documented content type carrying a charset parameter", () => {
    const result = validate("POST", "/users", {
      ...post,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ name: "ok" }),
    });
    expect(result.violations).toEqual([]);
  });

  it("reports a body that is declared JSON but is not parseable", () => {
    const result = validate("POST", "/users", { ...post, body: "{not json" });
    expect(result.violations[0]).toMatchObject({ location: "request.body", keyword: "syntax" });
  });

  it("warns rather than fails when a body is sent to an operation documenting none", () => {
    const result = validate("GET", "/users", {
      query: [{ name: "status", value: "active" }],
      body: JSON.stringify({ a: 1 }),
      contentType: "application/json",
    });
    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.severity).toBe("warning");
  });
});

describe("unsupported serialization styles (spec §21)", () => {
  const styled = contractFrom(
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t" },
      paths: {
        "/s": {
          get: {
            parameters: [
              { name: "filter", in: "query", required: true, style: "deepObject", explode: true, schema: { type: "object" } },
            ],
            responses: {},
          },
        },
      },
    }),
  );

  it("warns that the value was not validated instead of failing or pretending it passed", () => {
    const match = resolveOperation(styled, "GET", "/s");
    if (match.status !== "matched") throw new Error("no match");
    const result = validateRequestAgainstOperation(styled, match.operation, request({ path: "/s" }));

    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ keyword: "style", severity: "warning" });
    expect(result.warnings[0]!.message).toContain("deepObject");
  });
});

describe("unvalidated formats produce warnings (spec §23)", () => {
  const formatted = contractFrom(
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t" },
      paths: {
        "/f": {
          get: {
            parameters: [{ name: "n", in: "query", required: true, schema: { type: "integer", format: "int64" } }],
            responses: {},
          },
        },
      },
    }),
  );

  it("passes the value but records that the format was not checked", () => {
    const match = resolveOperation(formatted, "GET", "/f");
    if (match.status !== "matched") throw new Error("no match");
    const result = validateRequestAgainstOperation(
      formatted,
      match.operation,
      request({ path: "/f", query: [{ name: "n", value: "5" }] }),
    );

    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain("int64");
  });
});
