import { createFinding } from "../findings.ts";
import type { Finding, SecurityResponseInput } from "../types.ts";

/**
 * Response security-header checks (spec §15).
 *
 * ## Why nothing is required by default
 *
 * Spec §15 says plainly: do not mark every missing header as a universal
 * vulnerability. That instruction reflects reality. `Strict-Transport-
 * Security` on a plaintext internal service does nothing.
 * `Content-Security-Policy` on a JSON API that never renders HTML protects
 * against nothing, and a tool that demands it teaches its users that its
 * output is boilerplate. Even `X-Content-Type-Options` — the most
 * universally applicable of them — is a defence-in-depth measure whose
 * absence is not, by itself, a finding.
 *
 * So `ExpectedBehavior.requiredSecurityHeaders` starts empty and the tester
 * populates it with the headers their own policy mandates. What is present
 * is always reported as `info` regardless; what the tester *required* and is
 * missing is `medium`. The tool supplies observation; the policy comes from
 * the person who knows the system.
 */

/** The headers this milestone knows how to talk about (spec §15). Offered as
 * checkboxes in the UI; none is enabled by default. */
export const KNOWN_SECURITY_HEADERS = [
  "Content-Security-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Cache-Control",
  "X-Frame-Options",
] as const;

export type KnownSecurityHeader = (typeof KNOWN_SECURITY_HEADERS)[number];

const REMEDIATION: Record<string, string> = {
  "content-security-policy":
    "Set a Content-Security-Policy. For a JSON API, `default-src 'none'; frame-ancestors 'none'` is usually sufficient and cheap.",
  "strict-transport-security":
    "Serve over HTTPS and set Strict-Transport-Security (for example `max-age=31536000`). Only meaningful on an HTTPS origin.",
  "x-content-type-options":
    "Set `X-Content-Type-Options: nosniff` so browsers do not re-interpret the declared content type.",
  "referrer-policy": "Set a Referrer-Policy such as `no-referrer` so URLs (which may contain identifiers) are not leaked onward.",
  "cache-control":
    "Set an explicit Cache-Control. Authenticated responses generally want `no-store` so per-user data is not retained by shared caches.",
  "x-frame-options": "Set `X-Frame-Options: DENY`, or express the same intent via the CSP `frame-ancestors` directive.",
};

function remediationFor(header: string): string {
  return REMEDIATION[header.toLowerCase()] ?? `Set the ${header} response header in line with your organisation's policy.`;
}

function findHeader(response: SecurityResponseInput, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

export function checkSecurityHeaders(response: SecurityResponseInput, required: string[]): { findings: Finding[] } {
  const findings: Finding[] = [];

  for (const header of required) {
    const value = findHeader(response, header);

    if (value === undefined) {
      findings.push(
        createFinding({
          rule: "security.response.missing-security-header",
          severity: "medium",
          location: `response.header.${header}`,
          message: `The response does not set ${header}, which this test required.`,
          remediation: remediationFor(header),
          evidence: `${header} absent`,
        }),
      );
      continue;
    }

    findings.push(
      createFinding({
        rule: "security.response.security-header-present",
        severity: "info",
        location: `response.header.${header}`,
        message: `${header} is present.`,
        remediation: "No action required.",
        // A security header's value is configuration, not a secret, and
        // seeing it is the entire point of having asked.
        evidence: value.slice(0, 200),
      }),
    );
  }

  return { findings };
}
