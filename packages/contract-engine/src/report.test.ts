import { describe, expect, it } from "vitest";
import {
  buildContractReport,
  contractReportToCsv,
  contractReportToJson,
  formatContractReportSummary,
} from "./report.ts";
import type { ContractReportEntry, ContractViolation, CoverageReport } from "./types.ts";

const violation: ContractViolation = {
  location: "response.body",
  path: "$.id",
  keyword: "type",
  expected: "integer",
  actual: "string",
  message: "Expected integer, received string.",
  severity: "error",
};

const warning: ContractViolation = {
  location: "response.body",
  path: "$.email",
  keyword: "format",
  expected: "format: int64",
  actual: "not checked",
  message: "Format not validated.",
  severity: "warning",
};

const entries: ContractReportEntry[] = [
  { requestName: "Get User", method: "GET", path: "/users/{id}", valid: false, violations: [violation], warnings: [warning] },
  { requestName: "List Users", method: "GET", path: "/users", valid: true, violations: [], warnings: [] },
];

const coverage: CoverageReport = {
  totalOperations: 42,
  coveredOperations: 37,
  operationCoveragePercent: 88.1,
  validatedOperations: 31,
  validationCoveragePercent: 73.8,
  uncovered: [{ method: "DELETE", path: "/users/{id}" }],
};

describe("buildContractReport (spec §38)", () => {
  it("summarizes counts across every entry", () => {
    const report = buildContractReport("Users API", "3.0.3", entries, coverage);

    expect(report.totalRequests).toBe(2);
    expect(report.validCount).toBe(1);
    expect(report.violationCount).toBe(1);
    expect(report.warningCount).toBe(1);
    expect(report.specificationTitle).toBe("Users API");
    expect(new Date(report.generatedAt).toString()).not.toBe("Invalid Date");
  });

  it("handles an empty run", () => {
    const report = buildContractReport("Users API", "3.1.0", [], null);
    expect(report.totalRequests).toBe(0);
    expect(report.coverage).toBeNull();
  });
});

describe("contractReportToJson (spec §39)", () => {
  const json = JSON.parse(contractReportToJson(buildContractReport("Users API", "3.0.3", entries, coverage))) as Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >;

  it("carries the summary and both coverage figures under distinct names", () => {
    expect(json.summary.requests).toBe(2);
    expect(json.summary.contractValid).toBe(1);
    expect(json.summary.contractViolations).toBe(1);
    expect(json.summary.warnings).toBe(1);
    expect(json.summary.operationCoveragePercent).toBe(88.1);
    expect(json.summary.contractTestCoveragePercent).toBe(73.8);
  });

  it("keeps violations and warnings in separate arrays", () => {
    expect(json.results[0].violations).toHaveLength(1);
    expect(json.results[0].warnings).toHaveLength(1);
    expect(json.results[0].violations[0].path).toBe("$.id");
  });

  it("states plainly that the export contains no credentials", () => {
    expect(json.note).toContain("no request headers, credentials");
  });

  it("contains no request headers, bodies, or environment values by construction", () => {
    // The report type has no field for them; this asserts the shape stays
    // that way as the report evolves. The disclaimer `note` names those
    // concepts deliberately, so the data sections are checked rather than the
    // whole document.
    const report = buildContractReport("Users API", "3.0.3", entries, coverage);
    const { note: _note, ...data } = JSON.parse(contractReportToJson(report)) as Record<string, unknown>;
    const serialized = JSON.stringify(data);

    for (const forbidden of ["Authorization", "authorization", "rawBody", "environment", "cookie", "token"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("contractReportToCsv (spec §39)", () => {
  const csv = contractReportToCsv(buildContractReport("Users API", "3.0.3", entries, coverage));

  it("writes labelled sections rather than one misleading flat table", () => {
    expect(csv).toContain("Section,Metric,Value");
    expect(csv).toContain("Request,Method,Path,Result,Violations,Warnings");
    expect(csv).toContain("Request,Severity,Location,Path,Keyword,Expected,Actual,Message");
  });

  it("reports PASS and FAIL per request", () => {
    expect(csv).toContain("Get User,GET,/users/{id},FAIL,1,1");
    expect(csv).toContain("List Users,GET,/users,PASS,0,0");
  });

  it("includes both coverage figures with distinct labels", () => {
    expect(csv).toContain("Coverage,Operation coverage (%),88.1");
    expect(csv).toContain("Coverage,Contract test coverage (%),73.8");
  });

  it("escapes values containing commas and quotes", () => {
    const tricky = buildContractReport(
      "API",
      "3.0.3",
      [
        {
          requestName: 'Name, with "quotes"',
          method: "GET",
          path: "/a",
          valid: false,
          violations: [{ ...violation, message: "one, two" }],
          warnings: [],
        },
      ],
      null,
    );
    const output = contractReportToCsv(tricky);
    expect(output).toContain('"Name, with ""quotes"""');
    expect(output).toContain('"one, two"');
  });

  it("omits the coverage section when there is no coverage", () => {
    expect(contractReportToCsv(buildContractReport("API", "3.0.3", entries, null))).not.toContain("Coverage,");
  });
});

describe("formatContractReportSummary", () => {
  it("renders a compact block naming the specification and both coverage figures", () => {
    const summary = formatContractReportSummary(buildContractReport("Users API", "3.0.3", entries, coverage));

    expect(summary).toContain("Specification: Users API (OpenAPI 3.0.3)");
    expect(summary).toContain("Requests: 2");
    expect(summary).toContain("Contract valid: 1");
    expect(summary).toContain("Contract violations: 1");
    expect(summary).toContain("OpenAPI operations: 42");
    expect(summary).toContain("Covered by collection: 37 (88.1%)");
    expect(summary).toContain("Validated operations: 31 (73.8%)");
  });

  it("omits coverage lines when coverage is unavailable", () => {
    const summary = formatContractReportSummary(buildContractReport("Users API", "3.0.3", entries, null));
    expect(summary).not.toContain("OpenAPI operations");
  });
});
