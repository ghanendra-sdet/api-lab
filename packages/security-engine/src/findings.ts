import { MAX_FINDINGS_PER_RESULT } from "./limits.ts";
import type { Finding, FindingSeverity } from "./types.ts";

/**
 * Finding construction and the severity discipline behind it (spec §24).
 *
 * ## The evidence rule
 *
 * Spec §24 says high severity "requires evidence". This module enforces that
 * literally: `createFinding` refuses to emit a `high` finding without an
 * evidence string, downgrading it to `medium` and appending a note instead.
 *
 * That is not bureaucracy. The failure mode for a QA security tool is
 * *credibility collapse* — one confident "HIGH: broken authorization" that
 * turns out to be the API's documented behaviour, and every subsequent
 * report gets skimmed and closed. Requiring the tool to show its working
 * before it shouts keeps the loud channel meaningful.
 *
 * Note also what is missing from `FindingSeverity`: there is no `critical`.
 * See types.ts.
 *
 * ## Severity assignment
 *
 * Severities here describe *confidence that something is worth a human
 * look*, not CVSS. API Lab observes one request/response pair; it has no
 * view of exploitability, blast radius, or compensating controls, and
 * pretending otherwise would be dishonest. The scale used throughout:
 *
 * - `info`   — an observation the tester asked for. Not a problem.
 * - `low`    — a deviation from a common convention that is often fine.
 * - `medium` — a deviation the tester explicitly declared they did not want.
 * - `high`   — a concrete, evidenced behaviour that is very rarely intended,
 *              e.g. a stack trace in a response body.
 */

export interface FindingInput {
  rule: string;
  severity: FindingSeverity;
  location: string;
  message: string;
  remediation: string;
  evidence?: string;
}

export function createFinding(input: FindingInput): Finding {
  const hasEvidence = input.evidence !== undefined && input.evidence.trim() !== "";

  if (input.severity === "high" && !hasEvidence) {
    return {
      rule: input.rule,
      severity: "medium",
      location: input.location,
      message: `${input.message} (reported at medium severity: no corroborating evidence was captured)`,
      remediation: input.remediation,
      evidence: undefined,
    };
  }

  return {
    rule: input.rule,
    severity: input.severity,
    location: input.location,
    message: input.message,
    remediation: input.remediation,
    evidence: hasEvidence ? input.evidence : undefined,
  };
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** Highest severity first, so a report's first line is its worst news. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * Caps and de-duplicates a result's findings.
 *
 * De-duplication is by rule+location, not by message: a response containing
 * forty `password` fields is one finding about a response, not forty. The cap
 * is then applied to what remains, sorted worst-first so truncation can only
 * ever drop the least important items.
 */
export function finalizeFindings(findings: Finding[]): { findings: Finding[]; warnings: string[] } {
  const seen = new Set<string>();
  const unique: Finding[] = [];

  for (const finding of sortFindings(findings)) {
    const key = `${finding.rule}::${finding.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }

  if (unique.length <= MAX_FINDINGS_PER_RESULT) return { findings: unique, warnings: [] };

  return {
    findings: unique.slice(0, MAX_FINDINGS_PER_RESULT),
    warnings: [
      `Only the ${MAX_FINDINGS_PER_RESULT} highest-severity findings are retained for this test; ${unique.length - MAX_FINDINGS_PER_RESULT} lower-severity findings were omitted.`,
    ],
  };
}

/** The worst severity present, or null for an empty list. */
export function worstSeverity(findings: Finding[]): FindingSeverity | null {
  let worst: FindingSeverity | null = null;
  for (const finding of findings) {
    if (worst === null || SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[worst]) worst = finding.severity;
  }
  return worst;
}
