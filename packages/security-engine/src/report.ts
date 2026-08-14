import { worstSeverity } from "./findings.ts";
import { classifyTarget } from "./target.ts";
import type { FindingSeverity, SecurityReport, SecurityRunSummary, SecurityTestResult } from "./types.ts";

/**
 * Security report assembly and export (spec §25, §42).
 *
 * ## What a report may contain
 *
 * Every value written here has already passed through redact.ts on its way
 * into a `SecurityTestResult` — paths are credential-stripped, findings carry
 * field *names* rather than values, and no request or response body is
 * retained at all. This module therefore has one job it must not get wrong:
 * do not introduce anything new. It formats what it is given and adds no
 * lookups back into live request state.
 *
 * The host appears exactly once, in the header. Repeating it on every row
 * would multiply the exposure of an internal hostname across a document that
 * is likely to be pasted into a ticket, for no diagnostic gain.
 */

export function summarizeSecurityRun(results: SecurityTestResult[]): SecurityRunSummary {
  const findingsBySeverity: Record<FindingSeverity, number> = { info: 0, low: 0, medium: 0, high: 0 };

  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let errors = 0;
  let skipped = 0;

  for (const result of results) {
    switch (result.status) {
      case "passed":
        passed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "warning":
        warnings += 1;
        break;
      case "error":
        errors += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
    }
    for (const finding of result.findings) findingsBySeverity[finding.severity] += 1;
  }

  return { total: results.length, passed, failed, warnings, errors, skipped, findingsBySeverity };
}

export interface BuildReportInput {
  results: SecurityTestResult[];
  /** Any URL from the run, used to name the host in the header. */
  targetUrl: string;
  specificationTitle?: string;
  generatedAt?: string;
}

export function buildSecurityReport(input: BuildReportInput): SecurityReport {
  const classification = classifyTarget(input.targetUrl);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    targetHost: classification.host === "" ? "(unknown)" : classification.origin,
    specificationTitle: input.specificationTitle,
    summary: summarizeSecurityRun(input.results),
    results: input.results,
  };
}

// ---------------------------------------------------------------------------
// JSON export (spec §42)
// ---------------------------------------------------------------------------

export function exportSecurityReportJson(report: SecurityReport): string {
  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// CSV export (spec §42)
// ---------------------------------------------------------------------------

export const SECURITY_CSV_COLUMNS = [
  "test",
  "category",
  "status",
  "severity",
  "finding",
  "location",
  "expected",
  "actual",
  "mutation",
] as const;

/**
 * Escapes one CSV field.
 *
 * Two separate problems are handled here, and the second is the interesting
 * one.
 *
 * 1. **RFC 4180 quoting** — wrap in quotes, double any embedded quote.
 *
 * 2. **Formula injection** — a field beginning `=`, `+`, `-`, `@`, or a
 *    leading tab/carriage return is interpreted as a *formula* by Excel,
 *    Google Sheets, and LibreOffice when the file is opened. A finding
 *    message is derived from response content, so an API could return a
 *    field name that lands in this column and becomes a formula on the
 *    machine of whoever opens the report. Prefixing with an apostrophe
 *    neutralises it while leaving the text readable.
 *
 *    This is not hypothetical for this particular feature: the entire point
 *    of a security report is that it summarises hostile or malformed input,
 *    so its cells are the most likely in the whole product to contain
 *    something crafted. A security tool whose report format is itself an
 *    injection vector would be an embarrassing irony.
 */
export function escapeCsvField(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const prepared = dangerous ? `'${value}` : value;
  return `"${prepared.replace(/"/g, '""')}"`;
}

function row(values: string[]): string {
  return values.map(escapeCsvField).join(",");
}

/**
 * One CSV row per finding, plus one row per result that produced no findings
 * — otherwise a clean PASS would vanish from the export and the file would
 * only ever show bad news, misrepresenting a run of 100 tests with 2 findings
 * as a run of 2 tests.
 */
export function exportSecurityReportCsv(report: SecurityReport): string {
  const lines: string[] = [row([...SECURITY_CSV_COLUMNS])];

  for (const result of report.results) {
    const actual = result.actualStatus === null ? "" : String(result.actualStatus);
    const mutation = `${result.requestMutation.location} ${result.requestMutation.operation} ${result.requestMutation.target}`.trim();

    if (result.findings.length === 0) {
      lines.push(
        row([
          result.testName,
          result.category,
          result.status,
          worstSeverity(result.findings) ?? "",
          result.detail ?? "",
          result.path,
          result.expectedStatus,
          actual,
          mutation,
        ]),
      );
      continue;
    }

    for (const finding of result.findings) {
      lines.push(
        row([
          result.testName,
          result.category,
          result.status,
          finding.severity,
          finding.message,
          finding.location,
          result.expectedStatus,
          actual,
          mutation,
        ]),
      );
    }
  }

  return lines.join("\n");
}
