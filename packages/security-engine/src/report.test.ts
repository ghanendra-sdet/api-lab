import { describe, expect, it } from "vitest";
import { buildSecurityReport, escapeCsvField, exportSecurityReportCsv, exportSecurityReportJson, summarizeSecurityRun } from "./report.ts";
import { createFinding, finalizeFindings, sortFindings, worstSeverity } from "./findings.ts";
import { createEmptySecurityWorkspace, deserializeSecurity, serializeSecurity } from "./schema.ts";
import { makeTest } from "./testFixtures.ts";
import { MAX_FINDINGS_PER_RESULT } from "./limits.ts";
import { SECURITY_FORMAT_VERSION, type SecurityTestResult } from "./types.ts";

function result(overrides: Partial<SecurityTestResult> = {}): SecurityTestResult {
  return {
    testId: "t1",
    testName: "example test",
    status: "passed",
    category: "negative",
    requestMutation: makeTest().mutation,
    method: "POST",
    path: "/users",
    actualStatus: 400,
    expectedStatus: "4xx",
    findings: [],
    warnings: [],
    durationMs: 10,
    detail: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Findings (spec §24)
// ---------------------------------------------------------------------------

describe("createFinding", () => {
  it("downgrades a high-severity finding that carries no evidence", () => {
    // Spec §24: high severity requires evidence. One confident "HIGH" that
    // turns out to be documented behaviour costs the tool its credibility.
    const finding = createFinding({
      rule: "x", severity: "high", location: "response.body", message: "Something", remediation: "Fix",
    });
    expect(finding.severity).toBe("medium");
    expect(finding.message).toContain("no corroborating evidence");
  });

  it("keeps high severity when evidence is present", () => {
    const finding = createFinding({
      rule: "x", severity: "high", location: "response.body", message: "Something", remediation: "Fix", evidence: "matched signature",
    });
    expect(finding.severity).toBe("high");
  });

  it("treats whitespace-only evidence as absent", () => {
    const finding = createFinding({
      rule: "x", severity: "high", location: "l", message: "m", remediation: "r", evidence: "   ",
    });
    expect(finding.severity).toBe("medium");
  });
});

describe("sortFindings / worstSeverity", () => {
  it("orders worst first so a report's first line is its worst news", () => {
    const findings = [
      createFinding({ rule: "a", severity: "info", location: "l", message: "m", remediation: "r" }),
      createFinding({ rule: "b", severity: "high", location: "l", message: "m", remediation: "r", evidence: "e" }),
      createFinding({ rule: "c", severity: "low", location: "l", message: "m", remediation: "r" }),
    ];
    expect(sortFindings(findings).map((finding) => finding.severity)).toEqual(["high", "low", "info"]);
    expect(worstSeverity(findings)).toBe("high");
  });

  it("returns null for an empty list", () => {
    expect(worstSeverity([])).toBeNull();
  });
});

describe("finalizeFindings", () => {
  it("de-duplicates by rule and location", () => {
    // Forty `password` fields is one finding about a response, not forty.
    const findings = Array.from({ length: 5 }, () =>
      createFinding({ rule: "r", severity: "low", location: "response.body", message: "m", remediation: "x" }),
    );
    expect(finalizeFindings(findings).findings).toHaveLength(1);
  });

  it("caps the list and says so", () => {
    const findings = Array.from({ length: MAX_FINDINGS_PER_RESULT + 10 }, (_, i) =>
      createFinding({ rule: `r${i}`, severity: "low", location: "l", message: "m", remediation: "x" }),
    );
    const finalized = finalizeFindings(findings);
    expect(finalized.findings).toHaveLength(MAX_FINDINGS_PER_RESULT);
    expect(finalized.warnings.join(" ")).toContain("omitted");
  });

  it("truncation drops only the least important findings", () => {
    const findings = [
      ...Array.from({ length: MAX_FINDINGS_PER_RESULT + 5 }, (_, i) =>
        createFinding({ rule: `low${i}`, severity: "info", location: "l", message: "m", remediation: "x" }),
      ),
      createFinding({ rule: "critical-ish", severity: "high", location: "l", message: "m", remediation: "x", evidence: "e" }),
    ];
    const finalized = finalizeFindings(findings);
    expect(finalized.findings[0]!.severity).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Report (spec §25)
// ---------------------------------------------------------------------------

describe("summarizeSecurityRun", () => {
  it("counts every status and every finding severity", () => {
    const summary = summarizeSecurityRun([
      result({ status: "passed" }),
      result({ status: "failed", findings: [createFinding({ rule: "a", severity: "high", location: "l", message: "m", remediation: "r", evidence: "e" })] }),
      result({ status: "warning" }),
      result({ status: "error" }),
      result({ status: "skipped" }),
    ]);

    expect(summary).toMatchObject({ total: 5, passed: 1, failed: 1, warnings: 1, errors: 1, skipped: 1 });
    expect(summary.findingsBySeverity.high).toBe(1);
  });
});

describe("buildSecurityReport", () => {
  it("names the host once, in the header", () => {
    const report = buildSecurityReport({ results: [result()], targetUrl: "https://api.example.com/users" });
    expect(report.targetHost).toBe("https://api.example.com");
  });

  it("handles an unparseable target", () => {
    expect(buildSecurityReport({ results: [], targetUrl: "nonsense" }).targetHost).toBe("(unknown)");
  });
});

describe("exportSecurityReportJson", () => {
  it("round-trips through JSON", () => {
    const report = buildSecurityReport({ results: [result()], targetUrl: "http://localhost:4010/x" });
    expect(JSON.parse(exportSecurityReportJson(report))).toEqual(JSON.parse(JSON.stringify(report)));
  });
});

// ---------------------------------------------------------------------------
// CSV export (spec §42)
// ---------------------------------------------------------------------------

describe("escapeCsvField", () => {
  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("neutralises formula injection", () => {
    // A security report's cells are the most likely in the product to contain
    // something crafted; the report format must not itself be a vector.
    for (const dangerous of ["=cmd()", "+1+1", "-1", "@SUM(A1)", "\tx"]) {
      expect(escapeCsvField(dangerous).startsWith("\"'"), dangerous).toBe(true);
    }
  });

  it("leaves ordinary text alone apart from quoting", () => {
    expect(escapeCsvField("ordinary")).toBe('"ordinary"');
  });
});

describe("exportSecurityReportCsv", () => {
  it("emits a header row with the documented columns", () => {
    const report = buildSecurityReport({ results: [], targetUrl: "http://localhost/x" });
    expect(exportSecurityReportCsv(report).split("\n")[0]).toBe(
      '"test","category","status","severity","finding","location","expected","actual","mutation"',
    );
  });

  it("emits one row per finding", () => {
    const report = buildSecurityReport({
      results: [
        result({
          status: "failed",
          findings: [
            createFinding({ rule: "a", severity: "high", location: "response.body", message: "m1", remediation: "r", evidence: "e" }),
            createFinding({ rule: "b", severity: "low", location: "response.header.X", message: "m2", remediation: "r" }),
          ],
        }),
      ],
      targetUrl: "http://localhost/x",
    });
    expect(exportSecurityReportCsv(report).split("\n")).toHaveLength(3);
  });

  it("still emits a row for a result with no findings", () => {
    // Otherwise a clean PASS vanishes and the file only ever shows bad news.
    const report = buildSecurityReport({ results: [result({ status: "passed" })], targetUrl: "http://localhost/x" });
    const lines = exportSecurityReportCsv(report).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("passed");
  });

  it("never exports a raw credential", () => {
    const report = buildSecurityReport({
      results: [result({ path: "/users?api_key=(redacted)" })],
      targetUrl: "http://localhost/x",
    });
    expect(exportSecurityReportCsv(report)).not.toContain("real-secret");
  });
});

// ---------------------------------------------------------------------------
// Persistence (spec §40)
// ---------------------------------------------------------------------------

describe("security workspace persistence", () => {
  it("round-trips a workspace", () => {
    const workspace = { tests: [makeTest()] };
    const parsed = deserializeSecurity(serializeSecurity(workspace));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.security.tests[0]!.id).toBe("test-1");
  });

  it("uses the versioned envelope convention", () => {
    expect(serializeSecurity(createEmptySecurityWorkspace()).version).toBe(SECURITY_FORMAT_VERSION);
  });

  it("rejects a missing envelope", () => {
    expect(deserializeSecurity({ tests: [] })).toMatchObject({ ok: false, reason: "invalid-envelope" });
  });

  it("rejects an unsupported version", () => {
    expect(deserializeSecurity({ version: 99, security: { tests: [] } })).toMatchObject({ ok: false, reason: "unsupported-version" });
  });

  it("rejects a mutation vocabulary the engine does not implement", () => {
    // A hand-edited localStorage entry must not be able to smuggle a new
    // mutation operation into the engine.
    const smuggled = {
      version: SECURITY_FORMAT_VERSION,
      security: { tests: [{ ...makeTest(), mutation: { ...makeTest().mutation, operation: "execute-shell" } }] },
    };
    expect(deserializeSecurity(smuggled)).toMatchObject({ ok: false, reason: "invalid-shape" });
  });

  it("rejects an unknown auth mutation kind", () => {
    const smuggled = {
      version: SECURITY_FORMAT_VERSION,
      security: {
        tests: [{ ...makeTest(), mutation: { ...makeTest().mutation, operation: "set-invalid-auth", value: { kind: "auth", auth: "steal-token" } } }],
      },
    };
    expect(deserializeSecurity(smuggled).ok).toBe(false);
  });
});
