import { createFinding } from "../findings.ts";
import { MAX_SCANNED_RESPONSE_BYTES } from "../limits.ts";
import type { Finding, SecurityResponseInput } from "../types.ts";

/**
 * Response information-disclosure detection (spec §18) and error-handling
 * robustness (spec §19).
 *
 * ## A small, deterministic signature set — on purpose
 *
 * Spec §18 says: "Use a small deterministic pattern set. Do not build a giant
 * vulnerability signature database." Both halves of that matter.
 *
 * *Small* because the value here is concentrated in a handful of unmistakable
 * markers. `Traceback (most recent call last):` in an HTTP response body is
 * essentially never intentional. The hundredth signature in a large database
 * is always some substring that appears innocently in real payloads, and it
 * is the one that generates the false positive that gets the whole feature
 * turned off.
 *
 * *Deterministic* because a signature database is a maintenance burden and a
 * distribution problem — it needs updating, versioning, and a trust story.
 * API Lab is a QA tool; it should not acquire a threat-intelligence feed.
 *
 * ## Every signature is a literal substring
 *
 * There is not one regular expression in this file, and that is deliberate.
 * Milestone 11 discovered a 60-second thread block from a hostile regex
 * (`^(a+)+$` against 31 characters), and Milestone 12 §37 requires that class
 * of risk to be *reduced*, not reproduced somewhere new. Matching with
 * `String.prototype.includes` against a lowercased body is linear, has no
 * backtracking, and cannot be made to behave otherwise regardless of what
 * the response contains. The scan is additionally bounded by
 * `MAX_SCANNED_RESPONSE_BYTES`.
 *
 * ## Severity
 *
 * Stack traces and raw database errors are `high` — they are concrete,
 * evidenced, and very rarely intended in a client-facing response. Internal
 * filesystem paths are `medium`: they leak deployment layout, which is real
 * but less immediately actionable. Framework debug banners are `high`
 * because they usually mean debug mode is enabled in a deployed environment,
 * which implies much more than the banner itself.
 */

export interface DisclosureSignature {
  id: string;
  /** Lowercased literal substring searched for in the response body. */
  token: string;
  /** Shown as evidence. Never includes surrounding response content. */
  label: string;
  category: "stack-trace" | "internal-path" | "database-error" | "framework-debug";
}

export const DISCLOSURE_SIGNATURES: DisclosureSignature[] = [
  // --- Stack traces ---------------------------------------------------
  { id: "python-traceback", token: "traceback (most recent call last)", label: "Python traceback header", category: "stack-trace" },
  { id: "java-stack", token: "\n\tat ", label: "Java stack frame", category: "stack-trace" },
  { id: "java-exception", token: "java.lang.", label: "Java exception class name", category: "stack-trace" },
  { id: "node-stack", token: "\n    at ", label: "Node.js stack frame", category: "stack-trace" },
  { id: "dotnet-stack", token: "system.nullreferenceexception", label: ".NET exception class name", category: "stack-trace" },
  { id: "generic-stack", token: "stack trace:", label: "explicit stack trace label", category: "stack-trace" },

  // --- Internal filesystem paths --------------------------------------
  { id: "path-var-www", token: "/var/www/", label: "internal path /var/www/", category: "internal-path" },
  { id: "path-usr-local", token: "/usr/local/lib/", label: "internal path /usr/local/lib/", category: "internal-path" },
  { id: "path-home", token: "/home/", label: "internal path /home/", category: "internal-path" },
  { id: "path-srv", token: "/srv/app/", label: "internal path /srv/app/", category: "internal-path" },
  { id: "path-windows", token: "c:\\inetpub\\", label: "internal path C:\\inetpub\\", category: "internal-path" },

  // --- Database errors -------------------------------------------------
  { id: "sqlstate", token: "sqlstate[", label: "SQLSTATE error code", category: "database-error" },
  { id: "postgres-syntax", token: "syntax error at or near", label: "PostgreSQL syntax error", category: "database-error" },
  { id: "postgres-duplicate", token: "duplicate key value violates unique constraint", label: "PostgreSQL constraint violation", category: "database-error" },
  { id: "oracle", token: "ora-0", label: "Oracle error code", category: "database-error" },
  { id: "mysql-syntax", token: "you have an error in your sql syntax", label: "MySQL syntax error", category: "database-error" },
  { id: "mongo", token: "mongoerror", label: "MongoDB driver error", category: "database-error" },

  // --- Framework debug output -----------------------------------------
  { id: "werkzeug", token: "werkzeug debugger", label: "Werkzeug debugger", category: "framework-debug" },
  { id: "django-debug", token: "django.core.exceptions", label: "Django exception module", category: "framework-debug" },
  { id: "rails-debug", token: "actioncontroller::", label: "Rails ActionController error", category: "framework-debug" },
  { id: "symfony-debug", token: "symfony\\component\\", label: "Symfony component trace", category: "framework-debug" },
  { id: "whoops", token: "whoops, looks like something went wrong", label: "Whoops error page", category: "framework-debug" },
];

const CATEGORY_SEVERITY = {
  "stack-trace": "high",
  "database-error": "high",
  "framework-debug": "high",
  "internal-path": "medium",
} as const;

const CATEGORY_REMEDIATION: Record<DisclosureSignature["category"], string> = {
  "stack-trace":
    "Return a generic client-facing error and keep the stack trace server-side in your logs. Map unhandled exceptions to a 500 with a correlation id the client can quote.",
  "database-error":
    "Never surface driver or query errors to clients. Catch them at the data-access boundary and return a generic error; log the detail server-side.",
  "framework-debug":
    "Disable debug mode in this environment. A debug handler exposes source, configuration, and often environment variables well beyond the message shown here.",
  "internal-path":
    "Strip absolute filesystem paths from client-facing error messages. They disclose deployment layout and account names.",
};

export interface DisclosureResult {
  findings: Finding[];
  warnings: string[];
  /** True when any signature matched — used by the robustness verdict. */
  disclosed: boolean;
}

export function checkInformationDisclosure(
  response: SecurityResponseInput,
  options: { forbidden: boolean },
): DisclosureResult {
  const findings: Finding[] = [];
  const warnings: string[] = [];

  if (response.rawBody.length > MAX_SCANNED_RESPONSE_BYTES) {
    warnings.push(
      `The response body is larger than ${MAX_SCANNED_RESPONSE_BYTES} bytes and was not scanned for information disclosure. This is not a pass — the check did not run.`,
    );
    return { findings, warnings, disclosed: false };
  }

  const haystack = response.rawBody.toLowerCase();
  const matchedCategories = new Set<DisclosureSignature["category"]>();

  for (const signature of DISCLOSURE_SIGNATURES) {
    if (!haystack.includes(signature.token)) continue;
    matchedCategories.add(signature.category);

    findings.push(
      createFinding({
        rule: `security.response.disclosure.${signature.category}`,
        // When the tester did not ask us to forbid disclosure we still report
        // it — an unrequested stack trace is not less of a stack trace — but
        // at one level down, matching the convention in sensitiveData.ts.
        severity: options.forbidden ? CATEGORY_SEVERITY[signature.category] : "low",
        location: "response.body",
        message: `The response body contains ${signature.label}, which discloses internal implementation detail to the client.`,
        remediation: CATEGORY_REMEDIATION[signature.category],
        // The signature label, never the surrounding text: quoting the trace
        // would reproduce whatever the trace itself leaked.
        evidence: `matched signature "${signature.id}" (${signature.label})`,
      }),
    );
  }

  return { findings, warnings, disclosed: matchedCategories.size > 0 };
}

/**
 * Error-handling robustness (spec §19).
 *
 * The question this answers is narrow and worth stating precisely: given
 * input we deliberately malformed, did the API produce a *controlled*
 * rejection or did it fall over? A 400 or 422 is the API working correctly.
 * A 500 means our malformed input reached code that did not expect it.
 *
 * This is primarily a robustness signal rather than a security one, which is
 * why it is reported at `medium` rather than `high` on its own — but a 5xx
 * *accompanied* by a stack trace is a different matter, and `evaluate.ts`
 * combines the two.
 */
export function checkServerErrorRobustness(status: number | null): { findings: Finding[] } {
  if (status === null || status < 500) return { findings: [] };

  return {
    findings: [
      createFinding({
        rule: "security.robustness.server-error",
        severity: "medium",
        location: "response.status",
        message: `The API returned ${status} for deliberately invalid input. Malformed input should produce a controlled 4xx rejection, not a server error.`,
        remediation:
          "Validate and reject the request at the API boundary and return 400 or 422. A 5xx here means invalid input reached code that assumed it was valid.",
        evidence: `HTTP ${status}`,
      }),
    ],
  };
}
