import { describe, expect, it } from "vitest";
import { buildTestResult } from "./testResult.ts";
import type { AssertionResult } from "./types.ts";
import { createAssertion } from "./factory.ts";

function assertionResult(passed: boolean): AssertionResult {
  return { assertion: createAssertion("status"), passed, actual: "200", expected: "200", message: "" };
}

describe("buildTestResult", () => {
  it("is passed when all assertions pass", () => {
    const result = buildTestResult("r1", "Get Users", 100, [assertionResult(true), assertionResult(true)]);
    expect(result.status).toBe("passed");
  });

  it("is failed when any assertion fails", () => {
    const result = buildTestResult("r1", "Get Users", 100, [assertionResult(true), assertionResult(false)]);
    expect(result.status).toBe("failed");
  });

  it("is skipped when there are no assertions", () => {
    const result = buildTestResult("r1", "Get Users", 100, []);
    expect(result.status).toBe("skipped");
  });

  it("is error when an execution error is present, regardless of assertions", () => {
    const result = buildTestResult("r1", "Get Users", 100, [assertionResult(true)], "Network error");
    expect(result.status).toBe("error");
    expect(result.error).toBe("Network error");
  });
});
