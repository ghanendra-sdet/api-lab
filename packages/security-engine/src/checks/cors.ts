import { createFinding } from "../findings.ts";
import type { Finding, SecurityResponseInput } from "../types.ts";

/**
 * CORS configuration checks (spec §17).
 *
 * ## The one genuinely dangerous combination
 *
 * `Access-Control-Allow-Origin: *` is, on its own, completely ordinary — it
 * is what every public, unauthenticated API sends, and flagging it would be
 * flagging the correct configuration.
 *
 * What is dangerous is `Access-Control-Allow-Origin: *` **together with**
 * `Access-Control-Allow-Credentials: true`. That combination asks browsers to
 * let any origin on the internet make credentialed requests and read the
 * replies. Browsers actually refuse this specific pair, which is why it
 * matters that a server sending it is expressing an intent its author almost
 * certainly did not mean to express — and the same intent expressed via
 * origin *reflection* (echoing back whatever `Origin` arrived) is not
 * refused by browsers and is the real vulnerability.
 *
 * API Lab reports the pair at `high` with evidence, because unlike most
 * checks in this milestone it is genuinely close to unambiguous. Reflection
 * it can only *suspect*, since observing one response cannot distinguish
 * "reflects any origin" from "this origin is on the allowlist" — so that is
 * reported at `low` with the ambiguity stated, rather than asserted.
 *
 * ## Not an exploitation engine
 *
 * Spec §17 draws the line here and so does this module: it reads the headers
 * that came back and describes them. It does not replay the request with
 * forged `Origin` values to probe the allowlist. Doing that would be
 * unsolicited traffic aimed at characterising someone's security controls,
 * which is exactly the activity §2 puts out of scope.
 */

export interface CorsCheckOptions {
  /** The `Origin` the request was sent with, when known. Lets the check tell
   * a reflected origin from a statically configured one. */
  requestOrigin: string | undefined;
}

function header(response: SecurityResponseInput, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

export function checkCors(response: SecurityResponseInput, options: CorsCheckOptions): { findings: Finding[] } {
  const findings: Finding[] = [];

  const allowOrigin = header(response, "access-control-allow-origin");
  const allowCredentials = header(response, "access-control-allow-credentials");

  if (allowOrigin === undefined) {
    findings.push(
      createFinding({
        rule: "security.cors.absent",
        severity: "info",
        location: "response.header.Access-Control-Allow-Origin",
        message: "The response sets no CORS headers. Browsers will not permit cross-origin reads of this response.",
        remediation: "No action required unless this endpoint is intended to be called from a browser on another origin.",
      }),
    );
    return { findings };
  }

  const credentialsEnabled = allowCredentials?.trim().toLowerCase() === "true";
  const wildcard = allowOrigin.trim() === "*";

  if (wildcard && credentialsEnabled) {
    findings.push(
      createFinding({
        rule: "security.cors.wildcard-with-credentials",
        severity: "high",
        location: "response.header.Access-Control-Allow-Origin",
        message:
          "The response combines `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`. This asks browsers to allow credentialed cross-origin requests from any origin.",
        remediation:
          "Send an explicit allowlisted origin instead of `*` whenever credentials are enabled, or disable Access-Control-Allow-Credentials if the endpoint does not need cookies or authorization headers.",
        evidence: "Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true",
      }),
    );
    return { findings };
  }

  if (wildcard) {
    findings.push(
      createFinding({
        rule: "security.cors.wildcard-origin",
        severity: "info",
        location: "response.header.Access-Control-Allow-Origin",
        message: "The response allows any origin (`*`) without credentials. This is the normal configuration for a public, unauthenticated API.",
        remediation: "No action required if this endpoint is intended to be public. If it returns per-user data, restrict the allowed origins.",
        evidence: "Access-Control-Allow-Origin: *",
      }),
    );
    return { findings };
  }

  // A specific origin was returned. If it is exactly the origin we sent, the
  // server may be reflecting — or we may simply be on its allowlist. One
  // response cannot tell these apart, and this check will not send more
  // requests to find out.
  const reflected = options.requestOrigin !== undefined && allowOrigin.trim() === options.requestOrigin;

  if (reflected && credentialsEnabled) {
    findings.push(
      createFinding({
        rule: "security.cors.reflected-origin-with-credentials",
        severity: "low",
        location: "response.header.Access-Control-Allow-Origin",
        message:
          "The response returned this request's own Origin together with `Access-Control-Allow-Credentials: true`. This is expected if the origin is allowlisted, but indistinguishable from unconditional origin reflection, which would permit credentialed access from any site.",
        remediation:
          "Confirm the server validates Origin against a fixed allowlist rather than echoing whatever it receives. Verify by hand with an origin that should not be permitted.",
        evidence: `Access-Control-Allow-Origin echoed the request origin with credentials enabled`,
      }),
    );
    return { findings };
  }

  findings.push(
    createFinding({
      rule: "security.cors.explicit-origin",
      severity: "info",
      location: "response.header.Access-Control-Allow-Origin",
      message: `The response allows a specific origin${credentialsEnabled ? " with credentials enabled" : ""}.`,
      remediation: "No action required.",
      evidence: `Access-Control-Allow-Origin: ${allowOrigin.slice(0, 200)}`,
    }),
  );

  return { findings };
}
