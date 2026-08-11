import { describe, expect, it } from "vitest";
import type { ApiResponseResult } from "@api-lab/request-engine";
import { evaluateAssertion, evaluateAssertions } from "./evaluate.ts";
import { createAssertion } from "./factory.ts";
import type { Assertion } from "./types.ts";

function response(overrides: Partial<ApiResponseResult> = {}): ApiResponseResult {
  return {
    status: 200,
    statusText: "OK",
    ok: true,
    headers: { "content-type": "application/json" },
    body: { id: 123, user: { name: "Ada" }, items: [{ id: 1 }, { id: 2 }] },
    rawBody: '{"id":123,"user":{"name":"Ada"},"items":[{"id":1},{"id":2}]}',
    bodyKind: "json",
    duration: 150,
    size: 60,
    sizeSource: "decoded-body-bytes",
    error: null,
    ...overrides,
  };
}

function assertion(overrides: Partial<Assertion>): Assertion {
  return { ...createAssertion("status"), ...overrides };
}

describe("evaluateAssertion — status", () => {
  it("passes when status equals the expected value", () => {
    const result = evaluateAssertion(assertion({ target: "status", operator: "equals", expected: "200" }), response());
    expect(result.passed).toBe(true);
  });

  it("fails when status does not equal the expected value", () => {
    const result = evaluateAssertion(assertion({ target: "status", operator: "equals", expected: "404" }), response());
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("200");
  });

  it("supports notEquals", () => {
    expect(evaluateAssertion(assertion({ target: "status", operator: "notEquals", expected: "404" }), response()).passed).toBe(true);
  });

  it("errors when the expected value is not numeric", () => {
    const result = evaluateAssertion(assertion({ target: "status", operator: "equals", expected: "not-a-number" }), response());
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("evaluateAssertion — statusRange", () => {
  it("matches a 2xx response", () => {
    expect(evaluateAssertion(assertion({ target: "statusRange", operator: "equals", expected: "2xx" }), response()).passed).toBe(true);
  });

  it("does not match a different range", () => {
    const result = evaluateAssertion(assertion({ target: "statusRange", operator: "equals", expected: "4xx" }), response());
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("2xx");
  });

  it("matches a 4xx response", () => {
    const result = evaluateAssertion(
      assertion({ target: "statusRange", operator: "equals", expected: "4xx" }),
      response({ status: 404 }),
    );
    expect(result.passed).toBe(true);
  });
});

describe("evaluateAssertion — header", () => {
  it("checks header existence, case-insensitively", () => {
    const result = evaluateAssertion(
      assertion({ target: "header", operator: "exists", key: "Content-Type", expected: "" }),
      response(),
    );
    expect(result.passed).toBe(true);
  });

  it("checks header equals", () => {
    const result = evaluateAssertion(
      assertion({ target: "header", operator: "equals", key: "content-type", expected: "application/json" }),
      response(),
    );
    expect(result.passed).toBe(true);
  });

  it("checks header contains", () => {
    const result = evaluateAssertion(
      assertion({ target: "header", operator: "contains", key: "content-type", expected: "json" }),
      response(),
    );
    expect(result.passed).toBe(true);
  });

  it("fails notExists for a header that is present", () => {
    const result = evaluateAssertion(
      assertion({ target: "header", operator: "notExists", key: "content-type", expected: "" }),
      response(),
    );
    expect(result.passed).toBe(false);
  });

  it("fails equals/contains against a missing header", () => {
    const result = evaluateAssertion(
      assertion({ target: "header", operator: "equals", key: "x-missing", expected: "value" }),
      response(),
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("(missing)");
  });
});

describe("evaluateAssertion — body", () => {
  it("checks body contains", () => {
    const result = evaluateAssertion(assertion({ target: "body", operator: "contains", expected: "Ada" }), response());
    expect(result.passed).toBe(true);
  });

  it("checks body is empty / non-empty", () => {
    expect(evaluateAssertion(assertion({ target: "body", operator: "notExists", expected: "" }), response({ rawBody: "" })).passed).toBe(
      true,
    );
    expect(evaluateAssertion(assertion({ target: "body", operator: "exists", expected: "" }), response()).passed).toBe(true);
  });
});

describe("evaluateAssertion — json", () => {
  it("checks a JSON path exists", () => {
    const result = evaluateAssertion(assertion({ target: "json", operator: "exists", key: "$.id", expected: "" }), response());
    expect(result.passed).toBe(true);
  });

  it("checks a JSON path equals", () => {
    const result = evaluateAssertion(assertion({ target: "json", operator: "equals", key: "$.id", expected: "123" }), response());
    expect(result.passed).toBe(true);
  });

  it("checks a nested JSON path", () => {
    const result = evaluateAssertion(
      assertion({ target: "json", operator: "equals", key: "$.user.name", expected: "Ada" }),
      response(),
    );
    expect(result.passed).toBe(true);
  });

  it("checks an array index JSON path", () => {
    const result = evaluateAssertion(
      assertion({ target: "json", operator: "equals", key: "$.items[1].id", expected: "2" }),
      response(),
    );
    expect(result.passed).toBe(true);
  });

  it("does not silently treat a missing path as an empty string — reports failure", () => {
    const result = evaluateAssertion(
      assertion({ target: "json", operator: "equals", key: "$.doesNotExist", expected: "" }),
      response(),
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("(missing)");
  });

  it("errors when the response is not JSON", () => {
    const result = evaluateAssertion(
      assertion({ target: "json", operator: "exists", key: "$.id", expected: "" }),
      response({ bodyKind: "text", body: "plain text" }),
    );
    expect(result.error).toBeDefined();
  });

  it("errors on malformed JSON path syntax instead of guessing", () => {
    const result = evaluateAssertion(
      assertion({ target: "json", operator: "exists", key: "$.a[*]", expected: "" }),
      response(),
    );
    expect(result.error).toBeDefined();
  });
});

describe("evaluateAssertion — responseTime", () => {
  it("passes when under the threshold", () => {
    const result = evaluateAssertion(
      assertion({ target: "responseTime", operator: "lessThan", expected: "500" }),
      response({ duration: 150 }),
    );
    expect(result.passed).toBe(true);
  });

  it("fails when over the threshold", () => {
    const result = evaluateAssertion(
      assertion({ target: "responseTime", operator: "lessThan", expected: "100" }),
      response({ duration: 150 }),
    );
    expect(result.passed).toBe(false);
  });
});

describe("evaluateAssertion — responseSize", () => {
  it("compares against the response size", () => {
    const result = evaluateAssertion(
      assertion({ target: "responseSize", operator: "lessThanOrEqual", expected: "100" }),
      response({ size: 60 }),
    );
    expect(result.passed).toBe(true);
  });

  it("errors when size is unknown", () => {
    const result = evaluateAssertion(
      assertion({ target: "responseSize", operator: "lessThan", expected: "100" }),
      response({ size: null }),
    );
    expect(result.error).toBeDefined();
  });
});

describe("evaluateAssertions", () => {
  it("only evaluates enabled assertions", () => {
    const assertions: Assertion[] = [
      assertion({ target: "status", operator: "equals", expected: "200", enabled: true }),
      assertion({ target: "status", operator: "equals", expected: "999", enabled: false }),
    ];
    const results = evaluateAssertions(assertions, response());
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });

  it("never mutates the response object", () => {
    const res = response();
    const snapshot = JSON.stringify(res);
    evaluateAssertions(
      [assertion({ target: "json", operator: "equals", key: "$.id", expected: "123" })],
      res,
    );
    expect(JSON.stringify(res)).toBe(snapshot);
  });
});
