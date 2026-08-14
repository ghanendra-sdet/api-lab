import { describe, expect, it } from "vitest";
import { checkSensitiveData } from "./sensitiveData.ts";
import { checkSecurityHeaders } from "./securityHeaders.ts";
import { checkCors } from "./cors.ts";
import { checkTransport } from "./transport.ts";
import { checkInformationDisclosure, checkServerErrorRobustness, DISCLOSURE_SIGNATURES } from "./disclosure.ts";
import { makeResponse } from "../testFixtures.ts";
import { MAX_SCANNED_RESPONSE_BYTES } from "../limits.ts";

// ---------------------------------------------------------------------------
// Sensitive data (spec §14)
// ---------------------------------------------------------------------------

describe("checkSensitiveData", () => {
  it("detects a populated sensitive field", () => {
    const response = makeResponse({ rawBody: JSON.stringify({ id: 1, password: "hunter2" }) });
    const result = checkSensitiveData(response, { forbidden: true });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.rule).toBe("security.response.sensitive-field");
    expect(result.findings[0]!.location).toBe("response.body/password");
  });

  it("never records the sensitive value itself", () => {
    // The single most important assertion in this file: a report that quoted
    // the token it found would turn every shared report into a credential leak.
    const response = makeResponse({ rawBody: JSON.stringify({ accessToken: "SUPER-SECRET-VALUE" }) });
    const result = checkSensitiveData(response, { forbidden: true });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SUPER-SECRET-VALUE");
    expect(result.findings[0]!.evidence).toContain("value withheld");
  });

  it("reports at info severity when the tester did not forbid it", () => {
    // Spec §14: detection, not adjudication. Still reported, just not a failure.
    const response = makeResponse({ rawBody: JSON.stringify({ password: "x" }) });
    expect(checkSensitiveData(response, { forbidden: false }).findings[0]!.severity).toBe("info");
    expect(checkSensitiveData(response, { forbidden: true }).findings[0]!.severity).toBe("medium");
  });

  it("ignores a null or empty sensitive field", () => {
    // The API doing the right thing — reporting it would be noise.
    const response = makeResponse({ rawBody: JSON.stringify({ password: null, secret: "" }) });
    expect(checkSensitiveData(response, { forbidden: true }).findings).toHaveLength(0);
  });

  it("detects a credential echoed in a response header", () => {
    const response = makeResponse({ headers: { authorization: "Bearer x" } });
    const result = checkSensitiveData(response, { forbidden: true });
    expect(result.findings.some((finding) => finding.rule === "security.response.sensitive-header")).toBe(true);
  });

  it("warns instead of scanning a non-JSON body", () => {
    // Substring-matching free text for "password" produces false positives
    // ("Password reset email sent") that train people to ignore the check.
    const result = checkSensitiveData(makeResponse({ rawBody: "Password reset email sent" }), { forbidden: true });
    expect(result.findings).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("not JSON");
  });

  it("warns rather than silently passing on an oversized body", () => {
    const rawBody = JSON.stringify({ password: "x", filler: "a".repeat(MAX_SCANNED_RESPONSE_BYTES) });
    const result = checkSensitiveData(makeResponse({ rawBody }), { forbidden: true });
    expect(result.warnings.join(" ")).toContain("not scanned");
    expect(result.warnings.join(" ")).toContain("not a pass");
  });

  it("finds sensitive fields nested inside the body", () => {
    const response = makeResponse({ rawBody: JSON.stringify({ user: { profile: { apiKey: "k" } } }) });
    const result = checkSensitiveData(response, { forbidden: true });
    expect(result.findings[0]!.location).toBe("response.body/user/profile/apiKey");
  });
});

// ---------------------------------------------------------------------------
// Security headers (spec §15)
// ---------------------------------------------------------------------------

describe("checkSecurityHeaders", () => {
  it("reports nothing when nothing was required", () => {
    // Spec §15: a missing header is not a universal vulnerability.
    expect(checkSecurityHeaders(makeResponse(), []).findings).toHaveLength(0);
  });

  it("flags a required header that is absent", () => {
    const result = checkSecurityHeaders(makeResponse(), ["X-Content-Type-Options"]);
    expect(result.findings[0]!.rule).toBe("security.response.missing-security-header");
    expect(result.findings[0]!.severity).toBe("medium");
    expect(result.findings[0]!.remediation).toContain("nosniff");
  });

  it("reports a present required header at info severity", () => {
    const response = makeResponse({ headers: { "x-content-type-options": "nosniff" } });
    const result = checkSecurityHeaders(response, ["X-Content-Type-Options"]);
    expect(result.findings[0]!.severity).toBe("info");
    expect(result.findings[0]!.evidence).toBe("nosniff");
  });

  it("matches header names case-insensitively", () => {
    const response = makeResponse({ headers: { "STRICT-TRANSPORT-SECURITY": "max-age=1" } });
    expect(checkSecurityHeaders(response, ["Strict-Transport-Security"]).findings[0]!.severity).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// CORS (spec §17)
// ---------------------------------------------------------------------------

describe("checkCors", () => {
  it("flags wildcard origin combined with credentials at high severity", () => {
    const response = makeResponse({
      headers: { "access-control-allow-origin": "*", "access-control-allow-credentials": "true" },
    });
    const result = checkCors(response, { requestOrigin: undefined });

    expect(result.findings[0]!.rule).toBe("security.cors.wildcard-with-credentials");
    expect(result.findings[0]!.severity).toBe("high");
    expect(result.findings[0]!.evidence).toBeDefined();
  });

  it("does not flag a plain wildcard origin", () => {
    // The normal configuration for a public API. Flagging it would be
    // flagging correctness.
    const response = makeResponse({ headers: { "access-control-allow-origin": "*" } });
    const result = checkCors(response, { requestOrigin: undefined });
    expect(result.findings[0]!.severity).toBe("info");
  });

  it("reports a reflected origin with credentials at low severity, stating the ambiguity", () => {
    // One response cannot distinguish reflection from an allowlist hit, and
    // this check will not send more requests to find out.
    const response = makeResponse({
      headers: { "access-control-allow-origin": "https://app.example.com", "access-control-allow-credentials": "true" },
    });
    const result = checkCors(response, { requestOrigin: "https://app.example.com" });

    expect(result.findings[0]!.rule).toBe("security.cors.reflected-origin-with-credentials");
    expect(result.findings[0]!.severity).toBe("low");
    expect(result.findings[0]!.message).toContain("indistinguishable");
  });

  it("reports absence of CORS headers as info", () => {
    expect(checkCors(makeResponse({ headers: {} }), { requestOrigin: undefined }).findings[0]!.rule).toBe("security.cors.absent");
  });
});

// ---------------------------------------------------------------------------
// Transport (spec §16)
// ---------------------------------------------------------------------------

describe("checkTransport", () => {
  it("reports HTTPS as information, not a finding to act on", () => {
    const result = checkTransport("https://api.example.com/x");
    expect(result.findings[0]!.severity).toBe("info");
    expect(result.findings[0]!.rule).toBe("security.transport.https");
  });

  it("flags plaintext HTTP to a remote host", () => {
    const result = checkTransport("http://api.example.com/x");
    expect(result.findings[0]!.severity).toBe("medium");
  });

  it("does not flag plaintext HTTP to loopback", () => {
    // Otherwise the check fires on every local mock-server test, which is the
    // fastest way to train a user to ignore a warning.
    const result = checkTransport("http://localhost:4010/x");
    expect(result.findings[0]!.severity).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// Information disclosure (spec §18) and robustness (spec §19)
// ---------------------------------------------------------------------------

describe("checkInformationDisclosure", () => {
  it("detects a Python traceback", () => {
    const response = makeResponse({ status: 500, rawBody: "Traceback (most recent call last):\n  File x" });
    const result = checkInformationDisclosure(response, { forbidden: true });

    expect(result.disclosed).toBe(true);
    expect(result.findings[0]!.severity).toBe("high");
    expect(result.findings[0]!.rule).toBe("security.response.disclosure.stack-trace");
  });

  it("detects a database error", () => {
    const response = makeResponse({ rawBody: '{"error":"SQLSTATE[42000] syntax error at or near \\"FROM\\""}' });
    const result = checkInformationDisclosure(response, { forbidden: true });
    expect(result.findings.some((finding) => finding.rule.endsWith("database-error"))).toBe(true);
  });

  it("detects an internal filesystem path at medium severity", () => {
    const response = makeResponse({ rawBody: '{"error":"cannot open /var/www/app/config.php"}' });
    const result = checkInformationDisclosure(response, { forbidden: true });
    const finding = result.findings.find((entry) => entry.rule.endsWith("internal-path"))!;
    expect(finding.severity).toBe("medium");
  });

  it("does not reproduce the disclosing content in its evidence", () => {
    // Quoting the trace would reproduce whatever the trace itself leaked.
    const response = makeResponse({ rawBody: "Traceback (most recent call last):\n  secret=hunter2" });
    const result = checkInformationDisclosure(response, { forbidden: true });
    expect(JSON.stringify(result.findings)).not.toContain("hunter2");
  });

  it("still reports at lower severity when not forbidden", () => {
    const response = makeResponse({ rawBody: "Traceback (most recent call last):" });
    expect(checkInformationDisclosure(response, { forbidden: false }).findings[0]!.severity).toBe("low");
  });

  it("finds nothing in a clean response", () => {
    const result = checkInformationDisclosure(makeResponse(), { forbidden: true });
    expect(result.disclosed).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it("warns rather than scanning an oversized body", () => {
    const result = checkInformationDisclosure(
      makeResponse({ rawBody: "x".repeat(MAX_SCANNED_RESPONSE_BYTES + 1) }),
      { forbidden: true },
    );
    expect(result.warnings.join(" ")).toContain("not a pass");
  });

  it("uses only literal substrings, never regular expressions", () => {
    // The structural guarantee behind spec §37: no pattern in this signature
    // set can backtrack, whatever the response contains.
    for (const signature of DISCLOSURE_SIGNATURES) {
      expect(typeof signature.token).toBe("string");
      expect(signature.token).toBe(signature.token.toLowerCase());
    }
  });

  it("scans a large hostile body in linear time", () => {
    const started = Date.now();
    checkInformationDisclosure(makeResponse({ rawBody: "a".repeat(200_000) }), { forbidden: true });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("checkServerErrorRobustness", () => {
  it("flags a 5xx returned for deliberately invalid input", () => {
    const result = checkServerErrorRobustness(500);
    expect(result.findings[0]!.rule).toBe("security.robustness.server-error");
    expect(result.findings[0]!.remediation).toContain("400 or 422");
  });

  it("does not flag a 4xx", () => {
    expect(checkServerErrorRobustness(422).findings).toHaveLength(0);
  });

  it("does not flag a missing status", () => {
    expect(checkServerErrorRobustness(null).findings).toHaveLength(0);
  });
});
