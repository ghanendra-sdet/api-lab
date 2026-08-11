import { describe, expect, it } from "vitest";
import { computeCoverage } from "./coverage.ts";
import { detectDrift, type DriftInputEndpoint } from "./drift.ts";
import { parseContract } from "./parse.ts";
import { SPEC_30 } from "./testFixtures.ts";
import type { ContractModel } from "./types.ts";

function contractFrom(text: string): ContractModel {
  const result = parseContract(text);
  if (!result.ok) throw new Error(result.detail);
  return result.contract;
}

const contract = contractFrom(SPEC_30); // 4 operations
const BASE = "http://localhost:4010/api";

function endpoint(id: string, url: string, method: DriftInputEndpoint["method"] = "GET"): DriftInputEndpoint {
  return { id, name: id, method, url, queryParameterNames: ["status"], hasBody: method === "POST" };
}

describe("computeCoverage (spec §37)", () => {
  it("reports zero coverage for an empty collection", () => {
    const drift = detectDrift(contract, []);
    const coverage = computeCoverage(contract, drift, new Set());

    expect(coverage.totalOperations).toBe(4);
    expect(coverage.coveredOperations).toBe(0);
    expect(coverage.operationCoveragePercent).toBe(0);
    expect(coverage.uncovered).toHaveLength(4);
  });

  it("reports operation coverage as a percentage of documented operations", () => {
    const drift = detectDrift(contract, [endpoint("a", `${BASE}/users/1`), endpoint("b", `${BASE}/users`)]);
    const coverage = computeCoverage(contract, drift, new Set());

    expect(coverage.coveredOperations).toBe(2);
    expect(coverage.operationCoveragePercent).toBe(50);
  });

  it("keeps validation coverage separate from, and independent of, operation coverage", () => {
    // A collection can cover every operation while having validated none —
    // the whole reason the two figures are reported separately.
    const drift = detectDrift(contract, [
      endpoint("a", `${BASE}/users/1`),
      endpoint("b", `${BASE}/users`),
      endpoint("c", `${BASE}/users/list`),
      endpoint("d", `${BASE}/users`, "POST"),
    ]);

    const none = computeCoverage(contract, drift, new Set());
    expect(none.operationCoveragePercent).toBe(100);
    expect(none.validatedOperations).toBe(0);
    expect(none.validationCoveragePercent).toBe(0);

    const some = computeCoverage(contract, drift, new Set(["GET /users/{id}"]));
    expect(some.operationCoveragePercent).toBe(100);
    expect(some.validatedOperations).toBe(1);
    expect(some.validationCoveragePercent).toBe(25);
  });

  it("counts a validated operation as covered even without a matching saved request", () => {
    const drift = detectDrift(contract, []);
    const coverage = computeCoverage(contract, drift, new Set(["GET /users/{id}"]));

    expect(coverage.coveredOperations).toBe(1);
    expect(coverage.validatedOperations).toBe(1);
  });

  it("ignores validated ids that are not in this specification", () => {
    const drift = detectDrift(contract, []);
    const coverage = computeCoverage(contract, drift, new Set(["GET /not-in-this-spec"]));

    expect(coverage.coveredOperations).toBe(0);
    expect(coverage.validatedOperations).toBe(0);
  });

  it("never exceeds 100% however many requests hit the same operation", () => {
    const drift = detectDrift(contract, [
      endpoint("a", `${BASE}/users/1`),
      endpoint("b", `${BASE}/users/2`),
      endpoint("c", `${BASE}/users/3`),
    ]);
    const coverage = computeCoverage(contract, drift, new Set(["GET /users/{id}"]));

    expect(coverage.coveredOperations).toBe(1);
    expect(coverage.operationCoveragePercent).toBe(25);
  });

  it("rounds percentages to one decimal place", () => {
    const seven = contractFrom(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        servers: [{ url: BASE }],
        paths: Object.fromEntries(
          Array.from({ length: 7 }, (_unused, index) => [`/p${index}`, { get: { responses: {} } }]),
        ),
      }),
    );
    const drift = detectDrift(seven, [endpoint("a", `${BASE}/p0`)]);
    const coverage = computeCoverage(seven, drift, new Set());

    expect(coverage.operationCoveragePercent).toBe(14.3);
  });

  it("does not divide by zero for a specification with no operations", () => {
    const empty = contractFrom(JSON.stringify({ openapi: "3.0.3", info: { title: "t" }, paths: {} }));
    const coverage = computeCoverage(empty, detectDrift(empty, []), new Set());

    expect(coverage.totalOperations).toBe(0);
    expect(coverage.operationCoveragePercent).toBe(0);
    expect(coverage.validationCoveragePercent).toBe(0);
  });

  it("lists exactly the operations that are not covered", () => {
    const drift = detectDrift(contract, [endpoint("a", `${BASE}/users/1`)]);
    const coverage = computeCoverage(contract, drift, new Set());

    expect(coverage.uncovered.map((entry) => `${entry.method} ${entry.path}`).sort()).toEqual([
      "GET /users",
      "GET /users/list",
      "POST /users",
    ]);
  });
});
