import { describe, expect, it } from "vitest";
import { detectDrift, filterDrift, type DriftInputEndpoint } from "./drift.ts";
import { parseContract } from "./parse.ts";
import { SPEC_30 } from "./testFixtures.ts";
import type { ContractModel } from "./types.ts";
import type { HttpMethod } from "@api-lab/shared";

function contractFrom(text: string): ContractModel {
  const result = parseContract(text);
  if (!result.ok) throw new Error(result.detail);
  return result.contract;
}

const contract = contractFrom(SPEC_30);
const BASE = "http://localhost:4010/api";

function endpoint(overrides: Partial<DriftInputEndpoint> = {}): DriftInputEndpoint {
  return {
    id: "r1",
    name: "Request",
    method: "GET" as HttpMethod,
    url: `${BASE}/users/1`,
    queryParameterNames: [],
    hasBody: false,
    ...overrides,
  };
}

/** Every operation in SPEC_30, so "missing from collection" is empty by default. */
function fullCoverage(): DriftInputEndpoint[] {
  return [
    endpoint({ id: "a", name: "Get User", url: `${BASE}/users/1` }),
    endpoint({ id: "b", name: "List Users", url: `${BASE}/users`, queryParameterNames: ["status"] }),
    endpoint({ id: "c", name: "Users List", url: `${BASE}/users/list` }),
    endpoint({ id: "d", name: "Create User", method: "POST", url: `${BASE}/users`, hasBody: true }),
  ];
}

describe("detectDrift (spec §34, §46)", () => {
  it("reports a fully matching collection with no problems", () => {
    const report = detectDrift(contract, fullCoverage());

    expect(report.matched).toBe(4);
    expect(report.missingFromSpec).toBe(0);
    expect(report.missingFromCollection).toBe(0);
    expect(report.mismatched).toBe(0);
  });

  it("matches a concrete value against a templated path", () => {
    const report = detectDrift(contract, [endpoint({ url: `${BASE}/users/999` })]);
    expect(report.entries.some((entry) => entry.kind === "matched" && entry.path === "/users/{id}")).toBe(true);
  });

  it("matches an API Lab variable against a templated path", () => {
    // `{{userId}}` could resolve to anything, so it cannot be a mismatch.
    const report = detectDrift(contract, [endpoint({ url: `${BASE}/users/{{userId}}` })]);
    expect(report.entries.some((entry) => entry.kind === "matched" && entry.path === "/users/{id}")).toBe(true);
  });

  it("reports a collection request with no matching operation", () => {
    const report = detectDrift(contract, [endpoint({ id: "x", name: "Ghost", url: `${BASE}/ghost` })]);
    const entry = report.entries.find((candidate) => candidate.kind === "missing-from-spec")!;

    expect(entry).toMatchObject({ severity: "error", requestName: "Ghost", path: "/ghost" });
    expect(entry.reason).toBe("Request exists in collection, missing from specification.");
  });

  it("reports an operation with no collection request", () => {
    const report = detectDrift(contract, [endpoint({ url: `${BASE}/users/1` })]);
    const missing = report.entries.filter((entry) => entry.kind === "missing-from-collection");

    expect(missing).toHaveLength(3);
    expect(missing.every((entry) => entry.severity === "error")).toBe(true);
    expect(missing[0]!.reason).toBe("Operation exists in specification, missing from collection.");
  });

  it("treats a method mismatch as a missing operation on both sides", () => {
    // PUT /users is not documented, and POST /users has no request.
    const report = detectDrift(contract, [endpoint({ id: "p", name: "Put", method: "PUT", url: `${BASE}/users` })]);

    expect(report.entries.some((entry) => entry.kind === "missing-from-spec" && entry.method === "PUT")).toBe(true);
    expect(report.entries.some((entry) => entry.kind === "missing-from-collection" && entry.method === "POST")).toBe(true);
  });

  it("reports a missing required query parameter as an error", () => {
    const report = detectDrift(contract, [
      endpoint({ id: "b", name: "List Users", url: `${BASE}/users`, queryParameterNames: [] }),
    ]);
    const mismatch = report.entries.find((entry) => entry.kind === "parameter-mismatch")!;

    expect(mismatch.severity).toBe("error");
    expect(mismatch.reason).toContain('"status"');
    expect(mismatch.reason).toContain("not present in the collection request");
  });

  it("reports an undocumented query parameter as a warning, not a breaking change", () => {
    const report = detectDrift(contract, [
      endpoint({ id: "b", name: "List Users", url: `${BASE}/users`, queryParameterNames: ["status", "sort"] }),
    ]);
    const mismatch = report.entries.find((entry) => entry.kind === "parameter-mismatch")!;

    expect(mismatch.severity).toBe("warning");
    expect(mismatch.reason).toContain('"sort"');
  });

  it("reports a required request body the collection does not send", () => {
    const report = detectDrift(contract, [
      endpoint({ id: "d", name: "Create User", method: "POST", url: `${BASE}/users`, hasBody: false }),
    ]);
    const mismatch = report.entries.find((entry) => entry.kind === "request-body-mismatch")!;

    expect(mismatch.severity).toBe("error");
    expect(mismatch.reason).toContain("requires a request body");
  });

  it("reports an undocumented request body as a warning", () => {
    const report = detectDrift(contract, [endpoint({ url: `${BASE}/users/1`, hasBody: true })]);
    const mismatch = report.entries.find((entry) => entry.kind === "request-body-mismatch")!;

    expect(mismatch.severity).toBe("warning");
  });

  it("never inspects descriptions or summaries (spec §36)", () => {
    // A specification whose descriptions all differ from the collection's
    // request names must still report zero mismatches.
    const described = contractFrom(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        servers: [{ url: BASE }],
        paths: {
          "/a": { get: { summary: "Completely different wording", description: "Also different", responses: {} } },
        },
      }),
    );
    const report = detectDrift(described, [endpoint({ url: `${BASE}/a`, name: "Nothing like the summary" })]);
    expect(report.mismatched).toBe(0);
    expect(report.matched).toBe(1);
  });

  it("counts an operation as covered only once even with duplicate requests", () => {
    const report = detectDrift(contract, [
      endpoint({ id: "1", url: `${BASE}/users/1` }),
      endpoint({ id: "2", url: `${BASE}/users/2` }),
    ]);
    expect(report.missingFromCollection).toBe(3);
  });
});

describe("filterDrift (spec §35)", () => {
  const report = detectDrift(contract, [
    endpoint({ id: "x", name: "Ghost", url: `${BASE}/ghost` }),
    endpoint({ id: "b", name: "List Users", url: `${BASE}/users`, queryParameterNames: [] }),
  ]);

  it("returns everything for 'all'", () => {
    expect(filterDrift(report, "all")).toEqual(report.entries);
  });

  it("filters to requests missing from the specification", () => {
    const filtered = filterDrift(report, "missing-from-spec");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.requestName).toBe("Ghost");
  });

  it("filters to operations missing from the collection", () => {
    const filtered = filterDrift(report, "missing-from-collection");
    expect(filtered.every((entry) => entry.kind === "missing-from-collection")).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it("filters to changed operations, covering both mismatch kinds", () => {
    const filtered = filterDrift(report, "changed");
    expect(filtered.every((entry) => entry.kind === "parameter-mismatch" || entry.kind === "request-body-mismatch")).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });
});
