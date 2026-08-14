import { createFinding } from "../findings.ts";
import { MAX_SCANNED_RESPONSE_BYTES } from "../limits.ts";
import { collectFields } from "../pointer.ts";
import { describeSensitiveField, isSensitiveFieldName, isSensitiveHeaderName } from "../redact.ts";
import type { Finding, SecurityResponseInput } from "../types.ts";

/**
 * Sensitive-data exposure detection (spec §14).
 *
 * ## Detection, not adjudication
 *
 * Spec §14 is explicit that an occurrence must not be automatically
 * classified as a vulnerability. This module obeys that literally: every
 * finding it produces says "detected" or "potential exposure", and its
 * severity tops out at `medium` — the level meaning "the tester asked us to
 * flag this". Whether a `password` field in a response is a breach or a
 * feature depends on facts API Lab does not have. An admin endpoint echoing
 * a freshly generated initial password is correct behaviour; the same field
 * on a public profile endpoint is an incident. Same bytes, opposite verdicts.
 *
 * The tester decides, via `ExpectedBehavior.forbidSensitiveData`. When that
 * flag is off the finding is still reported — at `info` — because silently
 * dropping the observation would defeat the point of having looked.
 *
 * ## The value is never recorded
 *
 * Findings carry the field's *path* and nothing else (see redact.ts). This
 * is the single most important line in the module: a report that helpfully
 * quoted the `accessToken` it found would turn every shared security report
 * into a credential leak. `describeSensitiveField` is the only permitted way
 * to build evidence here.
 */

export interface SensitiveDataOptions {
  /** When true the tester declared these must not appear; findings escalate
   * from `info` (an observation) to `medium` (a violated expectation). */
  forbidden: boolean;
}

export function checkSensitiveData(
  response: SecurityResponseInput,
  options: SensitiveDataOptions,
): { findings: Finding[]; warnings: string[] } {
  const findings: Finding[] = [];
  const warnings: string[] = [];

  const severity = options.forbidden ? "medium" : "info";
  const verb = options.forbidden ? "must not be returned" : "was detected";

  // --- Response headers -----------------------------------------------
  //
  // A credential echoed back in a response header is a distinct problem from
  // one in the body: it survives in proxy logs and browser caches that never
  // touch the payload.
  for (const [name] of Object.entries(response.headers)) {
    if (!isSensitiveHeaderName(name) || name.toLowerCase() === "set-cookie") continue;
    findings.push(
      createFinding({
        rule: "security.response.sensitive-header",
        severity,
        location: `response.header.${name}`,
        message: `The response echoes the credential-bearing header "${name}", which ${verb}.`,
        remediation: "Do not reflect authorization or API-key headers back to the client. Strip them from the response before it leaves the service.",
        evidence: `header ${name} (value withheld)`,
      }),
    );
  }

  // --- Response body ---------------------------------------------------
  if (response.rawBody.length > MAX_SCANNED_RESPONSE_BYTES) {
    warnings.push(
      `The response body is larger than ${MAX_SCANNED_RESPONSE_BYTES} bytes and was not scanned for sensitive fields. This is not a pass — the check did not run.`,
    );
    return { findings, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.rawBody);
  } catch {
    // A non-JSON body is not scanned field-by-field. Substring-matching a
    // free-text body for the word "password" produces false positives at a
    // rate that trains people to ignore the check ("Password reset email
    // sent"), so the honest answer is to say the check did not run.
    if (response.rawBody.trim() !== "") {
      warnings.push("The response body is not JSON, so field-level sensitive-data detection did not run.");
    }
    return { findings, warnings };
  }

  for (const field of collectFields(parsed)) {
    const name = field.pointer.slice(field.pointer.lastIndexOf("/") + 1);
    if (!isSensitiveFieldName(name)) continue;

    // A null or empty value is the API doing the right thing — the field
    // exists in the schema and was deliberately blanked. Reporting it would
    // be noise, and noise is what makes these tools get switched off.
    if (field.value === null || field.value === "") continue;

    findings.push(
      createFinding({
        rule: "security.response.sensitive-field",
        severity,
        location: `response.body${field.pointer}`,
        message: `Potential sensitive-data exposure: the response contains a populated "${name}" field, which ${verb}.`,
        remediation: "Remove the field from this response representation, or null it server-side before serializing. Do not rely on clients ignoring it.",
        evidence: describeSensitiveField(`response.body${field.pointer}`),
      }),
    );
  }

  return { findings, warnings };
}
