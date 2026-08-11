import { describe, expect, it } from "vitest";
import { parseContract } from "./parse.ts";
import { allViolations, resolveOperationForRequest, validateContract } from "./validate.ts";
import { SPEC_30 } from "./testFixtures.ts";
import type { ContractModel } from "./types.ts";
import type { ContractRequestInput } from "./validateRequest.ts";
import type { ContractResponseInput } from "./validateResponse.ts";

function contractFrom(text: string): ContractModel {
  const result = parseContract(text);
  if (!result.ok) throw new Error(result.detail);
  return result.contract;
}

const contract = contractFrom(SPEC_30);

function request(overrides: Partial<ContractRequestInput> = {}): ContractRequestInput {
  return {
    method: "GET",
    path: "/users/1",
    query: [],
    headers: [],
    cookies: [],
    body: undefined,
    contentType: undefined,
    ...overrides,
  };
}

function response(overrides: Partial<ContractResponseInput> = {}): ContractResponseInput {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    rawBody: JSON.stringify({ id: 1, name: "Test User" }),
    ...overrides,
  };
}

describe("resolveOperationForRequest", () => {
  it("strips the server base path and resolves the operation", () => {
    const { match, path } = resolveOperationForRequest(contract, "GET", "http://localhost:4010/api/users/7");
    expect(path).toBe("/users/7");
    expect(match.status === "matched" && match.operation.path).toBe("/users/{id}");
  });
});

describe("validateContract (spec §22)", () => {
  it("returns a valid result for a conforming exchange", () => {
    const result = validateContract(contract, request(), response());

    expect(result.valid).toBe(true);
    expect(result.operation?.id).toBe("GET /users/{id}");
    expect(result.requestViolations).toEqual([]);
    expect(result.responseViolations).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps request and response violations in separate buckets", () => {
    const result = validateContract(
      contract,
      request({ path: "/users/abc" }),
      response({ rawBody: JSON.stringify({ id: "1", name: "x" }) }),
    );

    expect(result.valid).toBe(false);
    expect(result.requestViolations).toHaveLength(1);
    expect(result.requestViolations[0]!.location).toBe("request.path");
    expect(result.responseViolations).toHaveLength(1);
    expect(result.responseViolations[0]!.location).toBe("response.body");
    expect(allViolations(result)).toHaveLength(2);
  });

  it("validates only the request when no response is supplied", () => {
    const result = validateContract(contract, request({ path: "/users/abc" }), undefined);
    expect(result.requestViolations).toHaveLength(1);
    expect(result.responseViolations).toEqual([]);
  });

  it("honours skipRequest and skipResponse", () => {
    const bad = { request: request({ path: "/users/abc" }), response: response({ status: 500 }) };

    const responseOnly = validateContract(contract, bad.request, bad.response, { skipRequest: true });
    expect(responseOnly.requestViolations).toEqual([]);
    expect(responseOnly.responseViolations).toHaveLength(1);

    const requestOnly = validateContract(contract, bad.request, bad.response, { skipResponse: true });
    expect(requestOnly.requestViolations).toHaveLength(1);
    expect(requestOnly.responseViolations).toEqual([]);
  });

  it("reports an undocumented endpoint once, not on both sides", () => {
    const result = validateContract(contract, request({ path: "/nope" }), response());

    expect(result.valid).toBe(false);
    expect(result.operation).toBeNull();
    expect(result.requestViolations).toHaveLength(1);
    expect(result.requestViolations[0]).toMatchObject({ location: "contract", keyword: "operation" });
    expect(result.responseViolations).toEqual([]);
  });

  it("reports an undocumented method against the request", () => {
    const result = validateContract(contract, request({ method: "DELETE", path: "/users" }), undefined);
    expect(result.requestViolations[0]).toMatchObject({ location: "request.method", keyword: "operation" });
  });

  it("reports ambiguity rather than validating against a guessed operation", () => {
    const ambiguous = contractFrom(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: { "/x/{a}": { get: { responses: {} } }, "/x/{b}": { get: { responses: {} } } },
      }),
    );
    const result = validateContract(ambiguous, request({ path: "/x/1" }), undefined);
    expect(result.operation).toBeNull();
    expect(result.requestViolations[0]!.message).toContain("could not be uniquely determined");
  });

  it("carries warnings without letting them change validity (spec §23)", () => {
    const warned = contractFrom(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: {
          "/w": {
            get: {
              parameters: [{ name: "n", in: "query", required: true, schema: { type: "string", format: "int64" } }],
              responses: { "200": { description: "OK" } },
            },
          },
        },
      }),
    );

    const result = validateContract(
      warned,
      request({ path: "/w", query: [{ name: "n", value: "5" }] }),
      response({ headers: {}, rawBody: "" }),
    );

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.severity).toBe("warning");
  });

  it("validates the request and response against the same resolved operation", () => {
    // Both phases must judge `/users/list` as the literal operation, never
    // one as the literal and the other as the templated `/users/{id}`.
    const result = validateContract(
      contract,
      request({ path: "/users/list" }),
      response({ headers: {}, rawBody: "" }),
    );
    expect(result.operation?.path).toBe("/users/list");
    expect(result.valid).toBe(true);
  });
});
