import { describe, expect, it } from "vitest";
import { parseContract } from "./parse.ts";
import { resolveOperation } from "./operationMatch.ts";
import { selectResponse, validateResponseAgainstOperation, type ContractResponseInput } from "./validateResponse.ts";
import { SPEC_30, SPEC_31 } from "./testFixtures.ts";
import type { ContractModel } from "./types.ts";
import type { HttpMethod } from "@api-lab/shared";

function contractFrom(text: string): ContractModel {
  const result = parseContract(text);
  if (!result.ok) throw new Error(result.detail);
  return result.contract;
}

const contract = contractFrom(SPEC_30);

const JSON_HEADERS = { "content-type": "application/json" };

function response(overrides: Partial<ContractResponseInput> = {}): ContractResponseInput {
  return { status: 200, headers: { ...JSON_HEADERS }, rawBody: "{}", ...overrides };
}

function validate(
  method: HttpMethod,
  path: string,
  actual: Partial<ContractResponseInput>,
  model: ContractModel = contract,
) {
  const match = resolveOperation(model, method, path);
  if (match.status !== "matched") throw new Error(`no operation for ${method} ${path}`);
  return validateResponseAgainstOperation(model, match.operation, response(actual));
}

describe("selectResponse — status matching precedence (spec §9)", () => {
  const operation = {
    id: "GET /x",
    method: "GET" as HttpMethod,
    path: "/x",
    operationId: undefined,
    summary: undefined,
    parameters: [],
    requestBody: undefined,
    responses: [
      { statusKey: "200", headers: [], content: [] },
      { statusKey: "4XX", headers: [], content: [] },
      { statusKey: "default", headers: [], content: [] },
    ],
  };

  it("prefers an exact status code", () => {
    expect(selectResponse(operation, 200)?.statusKey).toBe("200");
  });

  it("falls back to a range when no exact code is documented", () => {
    expect(selectResponse(operation, 404)?.statusKey).toBe("4XX");
    expect(selectResponse(operation, 418)?.statusKey).toBe("4XX");
  });

  it("falls back to default last", () => {
    expect(selectResponse(operation, 500)?.statusKey).toBe("default");
  });

  it("returns undefined when nothing at all matches", () => {
    const noDefault = { ...operation, responses: [{ statusKey: "200", headers: [], content: [] }] };
    expect(selectResponse(noDefault, 500)).toBeUndefined();
  });
});

describe("status code validation (spec §9)", () => {
  it("reports an undocumented status with the documented ones named", () => {
    // Spec §9's worked example: 200/201/400 documented, actual 500.
    const result = validate("GET", "/users/1", { status: 500, rawBody: "" });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      location: "response.status",
      keyword: "status",
      actual: "500",
      severity: "error",
    });
    expect(result.violations[0]!.message).toContain("Response status 500 is not documented");
    expect(result.violations[0]!.expected).toContain("200");
  });

  it("accepts a documented status", () => {
    const result = validate("GET", "/users/1", { status: 404, rawBody: "", headers: {} });
    expect(result.violations).toEqual([]);
  });

  it("does not schema-check the body of an undocumented status", () => {
    // There is no response definition to check it against; reporting schema
    // errors as well would be noise on top of the real violation.
    const result = validate("GET", "/users/1", { status: 500, rawBody: '{"anything": true}' });
    expect(result.violations).toHaveLength(1);
  });

  it("warns rather than fails when there was no HTTP response at all", () => {
    const result = validate("GET", "/users/1", { status: null, rawBody: "" });
    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.severity).toBe("warning");
  });
});

describe("content type validation (spec §18)", () => {
  it("accepts the documented type with a charset parameter attached", () => {
    const result = validate("GET", "/users/1", {
      headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "r" },
      rawBody: JSON.stringify({ id: 1, name: "a" }),
    });
    expect(result.violations).toEqual([]);
  });

  it("reports a wrong content type", () => {
    const result = validate("GET", "/users/1", {
      headers: { "content-type": "text/plain" },
      rawBody: "hello",
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      location: "response.contentType",
      expected: "application/json",
      actual: "text/plain",
    });
  });

  it("reports a missing Content-Type header when content is documented", () => {
    const result = validate("GET", "/users/1", { headers: {}, rawBody: "{}" });
    expect(result.violations[0]).toMatchObject({ location: "response.contentType", actual: "(absent)" });
  });

  it("warns when a response documented without content carries a body", () => {
    const result = validate("GET", "/users/1", { status: 404, headers: {}, rawBody: '{"unexpected": true}' });
    expect(result.violations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("response header validation (spec §19)", () => {
  it("reports a missing required response header", () => {
    const result = validate("GET", "/users", {
      headers: { "content-type": "application/json" },
      rawBody: JSON.stringify({ users: [] }),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      location: "response.header",
      path: "X-Request-ID",
      keyword: "required",
    });
    expect(result.violations[0]!.message).toBe("Missing required response header: X-Request-ID");
  });

  it("passes when the required header is present, matched case-insensitively", () => {
    const result = validate("GET", "/users", {
      headers: { "content-type": "application/json", "x-request-id": "abc" },
      rawBody: JSON.stringify({ users: [] }),
    });
    expect(result.violations).toEqual([]);
  });

  it("type-checks a declared response header", () => {
    const numeric = contractFrom(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: {
          "/n": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                  headers: { "X-Count": { required: true, schema: { type: "integer" } } },
                },
              },
            },
          },
        },
      }),
    );
    const ok = validate("GET", "/n", { headers: { "x-count": "5" }, rawBody: "" }, numeric);
    expect(ok.violations).toEqual([]);

    const bad = validate("GET", "/n", { headers: { "x-count": "many" }, rawBody: "" }, numeric);
    expect(bad.violations[0]).toMatchObject({ location: "response.header", path: "X-Count", keyword: "type" });
  });
});

describe("response body validation (spec §13–§17)", () => {
  it("passes a conforming body", () => {
    const result = validate("GET", "/users/1", {
      headers: JSON_HEADERS,
      rawBody: JSON.stringify({ id: 1, name: "Test User" }),
    });
    expect(result.violations).toEqual([]);
  });

  it("reports a wrong property type with its precise path", () => {
    const result = validate("GET", "/users/1", {
      headers: JSON_HEADERS,
      rawBody: JSON.stringify({ id: "123", name: "Test User" }),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      location: "response.body",
      path: "$.id",
      keyword: "type",
      expected: "integer",
      actual: "string",
    });
  });

  it("reports a missing required property", () => {
    const result = validate("GET", "/users/1", { headers: JSON_HEADERS, rawBody: JSON.stringify({ id: 1 }) });
    expect(result.violations[0]).toMatchObject({ path: "$.name", keyword: "required" });
  });

  it("identifies the failing element inside an array", () => {
    const result = validate("GET", "/users", {
      headers: { ...JSON_HEADERS, "x-request-id": "r" },
      rawBody: JSON.stringify({ users: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: "x", name: "c" }] }),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.path).toBe("$.users[2].id");
  });

  it("reports an undocumented property when additionalProperties is false", () => {
    const result = validate("GET", "/users", {
      headers: { ...JSON_HEADERS, "x-request-id": "r" },
      rawBody: JSON.stringify({ users: [], debug: true }),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ path: "$.debug", keyword: "additionalProperties" });
  });

  it("reports a body that is not valid JSON despite a JSON content type", () => {
    const result = validate("GET", "/users/1", { headers: JSON_HEADERS, rawBody: "<html>oops</html>" });
    expect(result.violations[0]).toMatchObject({ location: "response.body", keyword: "syntax" });
  });

  it("resolves $ref into components when validating the body", () => {
    const result = validate("GET", "/users/1", {
      headers: JSON_HEADERS,
      rawBody: JSON.stringify({ id: 1, name: "a", profile: { email: "not-an-email" } }),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.path).toBe("$.profile.email");
  });
});

describe("OpenAPI 3.0 versus 3.1 null semantics end to end (spec §11)", () => {
  const contract31 = contractFrom(SPEC_31);
  const body = (nickname: unknown) => JSON.stringify({ id: 1, name: "a", nickname });

  it("accepts null for a 3.0 nullable field", () => {
    const result = validate("GET", "/users/1", { headers: JSON_HEADERS, rawBody: body(null) });
    expect(result.violations).toEqual([]);
  });

  it("accepts null for the equivalent 3.1 type union", () => {
    const result = validate("GET", "/users/1", { headers: JSON_HEADERS, rawBody: body(null) }, contract31);
    expect(result.violations).toEqual([]);
  });

  it("still rejects a wrong non-null type under both versions", () => {
    expect(validate("GET", "/users/1", { headers: JSON_HEADERS, rawBody: body(42) }).violations).toHaveLength(1);
    expect(
      validate("GET", "/users/1", { headers: JSON_HEADERS, rawBody: body(42) }, contract31).violations,
    ).toHaveLength(1);
  });

  it("enforces the 3.0 boolean exclusiveMinimum the same as the 3.1 numeric one", () => {
    const zeroScore = JSON.stringify({ id: 1, name: "a", score: 0 });
    expect(validate("GET", "/users/1", { headers: JSON_HEADERS, rawBody: zeroScore }).violations).toHaveLength(1);
    expect(
      validate("GET", "/users/1", { headers: JSON_HEADERS, rawBody: zeroScore }, contract31).violations,
    ).toHaveLength(1);
  });
});
