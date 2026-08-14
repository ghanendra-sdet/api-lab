import { checkCors } from "./checks/cors.ts";
import { checkInformationDisclosure, checkServerErrorRobustness } from "./checks/disclosure.ts";
import { checkSecurityHeaders } from "./checks/securityHeaders.ts";
import { checkSensitiveData } from "./checks/sensitiveData.ts";
import { checkTransport } from "./checks/transport.ts";
import { finalizeFindings } from "./findings.ts";
import { toRedactedPath } from "./redact.ts";
import type {
  ExpectedBehavior,
  Finding,
  NegativeTest,
  SecurityRequestInput,
  SecurityResponseInput,
  SecurityTestResult,
  StatusClass,
} from "./types.ts";

/**
 * Turns one executed test into a verdict (spec §23).
 *
 * ## The three-way outcome is the important part
 *
 * A binary pass/fail would force every observation into one of two boxes, and
 * the honest answer for most security observations is "this is worth your
 * attention but I cannot tell you whether it is wrong". That is what
 * `warning` is for, and it is why spec §23 lists five statuses rather than
 * two.
 *
 * The rule applied here:
 *
 * - **failed**  — an expectation the tester *explicitly declared* was
 *                 violated. Every path to `failed` traces back to a field
 *                 the tester set in `ExpectedBehavior`.
 * - **warning** — something was observed that no declared expectation
 *                 covers. Never a silent pass (the same discipline
 *                 contract-engine applies to its own warnings).
 * - **error**   — the request did not complete, so nothing was tested. A
 *                 connection refused is not a passing security test.
 * - **passed**  — the request completed and every declared expectation held.
 *
 * Note the asymmetry that follows: the tool cannot fail a test for something
 * the tester never asked about. That is deliberate, and it is what keeps this
 * from becoming the kind of scanner that reports forty "vulnerabilities" on a
 * correctly configured service.
 */

export function statusClassOf(status: number): StatusClass | null {
  if (status >= 100 && status < 200) return null; // 1xx never terminates a fetch.
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return null;
}

/** Human-readable rendering of the status expectation, for reports (spec §23). */
export function describeExpectedStatus(expected: ExpectedBehavior): string {
  const parts: string[] = [];
  if (expected.statusCodes.length > 0) parts.push(expected.statusCodes.join(", "));
  if (expected.statusClasses.length > 0) parts.push(expected.statusClasses.join(", "));
  if (parts.length === 0) return "any status";
  return parts.join(" or ");
}

/**
 * Whether the observed status satisfies the expectation.
 *
 * Codes and classes are OR-ed, not AND-ed. A tester who writes "401 or 4xx"
 * means "401 ideally, any client error acceptable" — reading that as a
 * conjunction would make the more specific entry narrow the broader one,
 * which is the opposite of what anyone types it for.
 */
export function statusSatisfies(expected: ExpectedBehavior, status: number | null): boolean {
  if (expected.statusCodes.length === 0 && expected.statusClasses.length === 0) return true;
  if (status === null) return false;

  if (expected.statusCodes.includes(status)) return true;

  const statusClass = statusClassOf(status);
  return statusClass !== null && expected.statusClasses.includes(statusClass);
}

export interface EvaluateInput {
  test: NegativeTest;
  /** The request as actually sent, after mutation. */
  request: SecurityRequestInput;
  response: SecurityResponseInput;
  /** The `Origin` header the request carried, for the CORS check. */
  requestOrigin?: string;
}

export function evaluateSecurityTest(input: EvaluateInput): SecurityTestResult {
  const { test, request, response } = input;
  const expected = test.expected;

  const base = {
    testId: test.id,
    testName: test.name,
    category: test.category,
    requestMutation: test.mutation,
    method: request.method,
    path: toRedactedPath(request.url),
    expectedStatus: describeExpectedStatus(expected),
    durationMs: response.durationMs,
  };

  // A transport-level failure means the test did not run. Reporting it as
  // anything other than `error` would let an unreachable host produce a page
  // of green results.
  if (response.error !== null) {
    return {
      ...base,
      status: "error",
      actualStatus: response.status,
      findings: [],
      warnings: [],
      detail: response.error,
    };
  }

  const findings: Finding[] = [];
  const warnings: string[] = [];
  const failureReasons: string[] = [];

  // --- Status expectation ----------------------------------------------
  if (!statusSatisfies(expected, response.status)) {
    failureReasons.push(
      `expected ${describeExpectedStatus(expected)}, received ${response.status === null ? "no status" : String(response.status)}`,
    );
  }

  // --- Robustness: 5xx on deliberately invalid input (spec §19) ---------
  if (expected.forbidServerError) {
    const robustness = checkServerErrorRobustness(response.status);
    findings.push(...robustness.findings);
    if (robustness.findings.length > 0) failureReasons.push("the API returned a server error for invalid input");
  }

  // --- Information disclosure (spec §18) --------------------------------
  const disclosure = checkInformationDisclosure(response, { forbidden: expected.forbidInformationDisclosure });
  findings.push(...disclosure.findings);
  warnings.push(...disclosure.warnings);
  if (expected.forbidInformationDisclosure && disclosure.disclosed) {
    failureReasons.push("the response disclosed internal implementation detail");
  }

  // --- Sensitive data (spec §14) ----------------------------------------
  const sensitive = checkSensitiveData(response, { forbidden: expected.forbidSensitiveData });
  findings.push(...sensitive.findings);
  warnings.push(...sensitive.warnings);
  if (expected.forbidSensitiveData && sensitive.findings.length > 0) {
    failureReasons.push("the response contained sensitive fields");
  }

  // --- Security headers (spec §15) --------------------------------------
  if (expected.requiredSecurityHeaders.length > 0) {
    const headers = checkSecurityHeaders(response, expected.requiredSecurityHeaders);
    findings.push(...headers.findings);
    const missing = headers.findings.filter((finding) => finding.rule === "security.response.missing-security-header");
    if (missing.length > 0) {
      failureReasons.push(`required security header${missing.length > 1 ? "s were" : " was"} missing`);
    }
  }

  // --- CORS (spec §17) ---------------------------------------------------
  if (expected.checkCors) {
    const cors = checkCors(response, { requestOrigin: input.requestOrigin });
    findings.push(...cors.findings);
    // Only the wildcard-with-credentials case fails. Everything else CORS can
    // tell us from a single response is genuinely ambiguous (see cors.ts).
    if (cors.findings.some((finding) => finding.rule === "security.cors.wildcard-with-credentials")) {
      failureReasons.push("the CORS policy allows credentialed requests from any origin");
    }
  }

  // --- Transport (spec §16) ----------------------------------------------
  if (expected.checkTransport) {
    findings.push(...checkTransport(request.url).findings);
  }

  const finalized = finalizeFindings(findings);
  warnings.push(...finalized.warnings);

  if (failureReasons.length > 0) {
    return {
      ...base,
      status: "failed",
      actualStatus: response.status,
      findings: finalized.findings,
      warnings,
      detail: failureReasons.join("; "),
    };
  }

  // Anything above `info` that did not trip a declared expectation is a
  // warning: observed, reported, and explicitly not called a pass.
  const notable = finalized.findings.filter((finding) => finding.severity !== "info");
  if (notable.length > 0) {
    return {
      ...base,
      status: "warning",
      actualStatus: response.status,
      findings: finalized.findings,
      warnings,
      detail: `${notable.length} observation${notable.length > 1 ? "s" : ""} outside the declared expectations`,
    };
  }

  return {
    ...base,
    status: "passed",
    actualStatus: response.status,
    findings: finalized.findings,
    warnings,
    detail: undefined,
  };
}

/** The result recorded when a mutation could not be applied at all. A test
 * that never left the machine is `skipped`, never `passed` — see mutate.ts. */
export function skippedResult(test: NegativeTest, detail: string): SecurityTestResult {
  return {
    testId: test.id,
    testName: test.name,
    status: "skipped",
    category: test.category,
    requestMutation: test.mutation,
    method: "GET",
    path: "",
    actualStatus: null,
    expectedStatus: describeExpectedStatus(test.expected),
    findings: [],
    warnings: [],
    durationMs: 0,
    detail,
  };
}
