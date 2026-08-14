import { createFinding } from "../findings.ts";
import { classifyTarget } from "../target.ts";
import type { Finding } from "../types.ts";

/**
 * Transport checks (spec §16).
 *
 * Deliberately the smallest module in this package. Spec §16 asks for "basic
 * checks: HTTP vs HTTPS" and explicitly rules out certificate scanning and
 * TLS exploitation — so this reads the scheme off the URL and stops.
 *
 * There is a real technical reason the boundary sits exactly there, beyond
 * the spec saying so: API Lab's requests go out through the browser's
 * `fetch`, which exposes no information about the negotiated TLS version,
 * cipher suite, or certificate chain. Anything this module claimed about
 * transport security beyond the scheme would be invention.
 *
 * `http://localhost` is not flagged. Plaintext to loopback never leaves the
 * machine, and flagging it would make the check fire on every single local
 * mock-server test — the fastest way to train a user to ignore a warning.
 */

export function checkTransport(url: string): { findings: Finding[] } {
  const classification = classifyTarget(url);

  if (classification.protocol === "https:") {
    return {
      findings: [
        createFinding({
          rule: "security.transport.https",
          severity: "info",
          location: "request.url",
          message: `The request was sent over HTTPS to ${classification.host}.`,
          remediation: "No action required. Certificate and cipher inspection are out of scope for API Lab.",
          evidence: `scheme https, host ${classification.host}`,
        }),
      ],
    };
  }

  if (classification.protocol === "http:" && classification.scope === "local") {
    return {
      findings: [
        createFinding({
          rule: "security.transport.plaintext-loopback",
          severity: "info",
          location: "request.url",
          message: "The request was sent over plaintext HTTP to a loopback address, which does not traverse the network.",
          remediation: "No action required for local testing.",
          evidence: `scheme http, host ${classification.host}`,
        }),
      ],
    };
  }

  if (classification.protocol === "http:") {
    return {
      findings: [
        createFinding({
          rule: "security.transport.plaintext",
          severity: "medium",
          location: "request.url",
          message: `The request was sent over plaintext HTTP to ${classification.host}. Credentials and response data traverse the network unencrypted.`,
          remediation: "Serve this API over HTTPS and redirect or reject plaintext requests.",
          evidence: `scheme http, host ${classification.host}`,
        }),
      ],
    };
  }

  return {
    findings: [
      createFinding({
        rule: "security.transport.unknown",
        severity: "low",
        location: "request.url",
        message: "The request target could not be classified as HTTP or HTTPS.",
        remediation: "Check the resolved URL — an unresolved variable or a malformed base URL is the usual cause.",
      }),
    ],
  };
}
