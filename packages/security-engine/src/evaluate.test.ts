import { describe, expect, it } from "vitest";
import { describeExpectedStatus, evaluateSecurityTest, skippedResult, statusClassOf, statusSatisfies } from "./evaluate.ts";
import { makeRequest, makeResponse, makeTest } from "./testFixtures.ts";
import { createDefaultExpectedBehavior, type ExpectedBehavior } from "./types.ts";

function expected(overrides: Partial<ExpectedBehavior> = {}): ExpectedBehavior {
  return { ...createDefaultExpectedBehavior(), ...overrides };
}

describe("statusClassOf", () => {
  it("maps statuses onto their class", () => {
    expect(statusClassOf(200)).toBe("2xx");
    expect(statusClassOf(302)).toBe("3xx");
    expect(statusClassOf(422)).toBe("4xx");
    expect(statusClassOf(500)).toBe("5xx");
  });

  it("returns null for a status outside the HTTP range", () => {
    expect(statusClassOf(99)).toBeNull();
    expect(statusClassOf(600)).toBeNull();
  });
});

describe("statusSatisfies", () => {
  it("accepts anything when nothing was specified", () => {
    expect(statusSatisfies(expected(), 500)).toBe(true);
  });

  it("ORs exact codes with classes rather than ANDing them", () => {
    // "401 or 4xx" means "401 ideally, any client error acceptable".
    const behavior = expected({ statusCodes: [401], statusClasses: ["4xx"] });
    expect(statusSatisfies(behavior, 401)).toBe(true);
    expect(statusSatisfies(behavior, 403)).toBe(true);
    expect(statusSatisfies(behavior, 500)).toBe(false);
  });

  it("rejects a null status when an expectation was declared", () => {
    expect(statusSatisfies(expected({ statusClasses: ["4xx"] }), null)).toBe(false);
  });
});

describe("describeExpectedStatus", () => {
  it("renders codes and classes readably", () => {
    expect(describeExpectedStatus(expected({ statusCodes: [401, 403] }))).toBe("401, 403");
    expect(describeExpectedStatus(expected({ statusClasses: ["4xx"] }))).toBe("4xx");
    expect(describeExpectedStatus(expected())).toBe("any status");
  });
});

describe("evaluateSecurityTest", () => {
  const request = makeRequest();

  it("passes when the declared expectation holds", () => {
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ statusClasses: ["4xx"] }) }),
      request,
      response: makeResponse({ status: 400 }),
    });
    expect(result.status).toBe("passed");
    expect(result.detail).toBeUndefined();
  });

  it("fails when the status does not satisfy the expectation", () => {
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ statusClasses: ["4xx"] }) }),
      request,
      response: makeResponse({ status: 200 }),
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("expected 4xx, received 200");
  });

  it("reports a transport failure as error, never as a pass", () => {
    // A connection refused is not a passing security test.
    const result = evaluateSecurityTest({
      test: makeTest(),
      request,
      response: makeResponse({ status: null, error: "Failed to fetch" }),
    });
    expect(result.status).toBe("error");
    expect(result.detail).toBe("Failed to fetch");
  });

  it("fails on a 5xx returned for invalid input", () => {
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ statusClasses: ["4xx"], forbidServerError: true }) }),
      request,
      response: makeResponse({ status: 500, rawBody: "{}" }),
    });
    expect(result.status).toBe("failed");
    expect(result.findings.some((finding) => finding.rule === "security.robustness.server-error")).toBe(true);
  });

  it("fails when information disclosure was forbidden and occurred", () => {
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ forbidInformationDisclosure: true }) }),
      request,
      response: makeResponse({ status: 400, rawBody: "Traceback (most recent call last):" }),
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("disclosed internal implementation detail");
  });

  it("warns — never passes — when something notable was observed outside the expectations", () => {
    // The three-way outcome: observed, reported, explicitly not called a pass.
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ forbidInformationDisclosure: false, statusClasses: ["4xx"] }) }),
      request,
      response: makeResponse({ status: 400, rawBody: "Traceback (most recent call last):" }),
    });
    expect(result.status).toBe("warning");
    expect(result.detail).toContain("outside the declared expectations");
  });

  it("does not fail for something the tester never asked about", () => {
    // The tool cannot fail a test for an expectation nobody declared.
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ statusClasses: ["4xx"], forbidSensitiveData: false }) }),
      request,
      response: makeResponse({ status: 400, rawBody: JSON.stringify({ password: "x" }) }),
    });
    expect(result.status).not.toBe("failed");
  });

  it("fails on sensitive data when the tester forbade it", () => {
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ statusClasses: ["4xx"], forbidSensitiveData: true }) }),
      request,
      response: makeResponse({ status: 400, rawBody: JSON.stringify({ password: "x" }) }),
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("sensitive fields");
  });

  it("fails on a missing required security header", () => {
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ statusClasses: ["4xx"], requiredSecurityHeaders: ["X-Content-Type-Options"] }) }),
      request,
      response: makeResponse({ status: 400 }),
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("security header");
  });

  it("fails on wildcard CORS with credentials when CORS checking is enabled", () => {
    const result = evaluateSecurityTest({
      test: makeTest({ expected: expected({ statusClasses: ["4xx"], checkCors: true }) }),
      request,
      response: makeResponse({
        status: 400,
        headers: { "access-control-allow-origin": "*", "access-control-allow-credentials": "true" },
      }),
    });
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("any origin");
  });

  it("records a credential-free path", () => {
    const result = evaluateSecurityTest({
      test: makeTest(),
      request: makeRequest({ url: "https://u:p@api.example.com/users?api_key=zzz" }),
      response: makeResponse(),
    });
    expect(result.path).not.toContain("zzz");
    expect(result.path).not.toContain("api.example.com");
  });

  it("carries the mutation and category into the result", () => {
    const test = makeTest({ category: "security" });
    const result = evaluateSecurityTest({ test, request, response: makeResponse() });
    expect(result.category).toBe("security");
    expect(result.requestMutation).toEqual(test.mutation);
  });
});

describe("skippedResult", () => {
  it("marks a never-executed test as skipped with a reason", () => {
    const result = skippedResult(makeTest(), "mutation could not be applied");
    expect(result.status).toBe("skipped");
    expect(result.detail).toBe("mutation could not be applied");
    expect(result.actualStatus).toBeNull();
  });
});
