import {
  MAX_PATTERN_ALTERNATIONS,
  MAX_PATTERN_GROUP_DEPTH,
  MAX_PATTERN_QUANTIFIERS,
  MAX_PATTERN_REPETITION,
} from "./limits.ts";

/**
 * Regex complexity limits — the second ReDoS defence layer (Milestone 12,
 * spec §37).
 *
 * ## Why a second layer was needed
 *
 * Milestone 11's `redos.ts` screens by *shape*: it rejects a repeated group
 * whose body is ambiguous, which is the classic `(a+)+` construction. Its own
 * documentation is candid that this is a conservative heuristic and not a
 * proof, and Milestone 12 §37 explicitly requires the mitigation to be
 * strengthened rather than assumed sufficient.
 *
 * Shape screening has a real blind spot. Consider `(a?)(a?)(a?)…a{20}` — no
 * single group is ambiguous, no quantifier is nested, and M11's check passes
 * it. Matching it against a non-matching string of a's still explores an
 * exponential number of assignments, because the ambiguity is *distributed
 * across* the groups rather than contained in one. Reasoning about that in
 * general is equivalent to solving the ambiguity problem for backtracking
 * engines, which is not something a screening function is going to do.
 *
 * So this module does not try. It measures four blunt quantities and refuses
 * anything unusual:
 *
 * - **quantifier count** — the number of independently-variable positions
 * - **group nesting depth** — nesting multiplies the ways an input can match
 * - **alternation count** — each `|` is another branch to try
 * - **explicit repetition bounds** — `a{1,50000}` compiles instantly and
 *   expands to fifty thousand states at match time
 *
 * ## The cost, stated honestly
 *
 * These caps reject some perfectly safe patterns. A hand-written email or
 * ISO-8601 regex can legitimately carry a dozen quantifiers, and an elaborate
 * one will be refused. That is an acceptable price here and only here,
 * because a refused pattern does not fail validation — it produces a
 * *warning* saying the check was skipped (contract-engine's established
 * rule, and never a silent pass). The trade is a little lost validation
 * coverage against a frozen browser tab, and the tab wins.
 *
 * This layer is still static. The dynamic layer that actually executes the
 * pattern under a hard timeout lives in patternVetting.ts.
 */

export type ComplexityVerdict = { ok: true; metrics: PatternMetrics } | { ok: false; reason: string; metrics: PatternMetrics };

export interface PatternMetrics {
  quantifiers: number;
  maxGroupDepth: number;
  alternations: number;
  /** The largest explicit `{n,m}` bound found, or 0 when there is none. */
  maxRepetition: number;
}

/**
 * Walks a pattern source once, counting structure while correctly skipping
 * escapes and character-class interiors.
 *
 * The skipping matters: `[a+|b]` contains no quantifier and no alternation —
 * inside a class both characters are literals. Counting them would make the
 * limits fire on ordinary patterns and push users toward disabling the
 * screening entirely, which is the worst available outcome.
 */
export function measurePattern(source: string): PatternMetrics {
  let quantifiers = 0;
  let alternations = 0;
  let depth = 0;
  let maxGroupDepth = 0;
  let maxRepetition = 0;
  let inClass = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (char === "\\") {
      i++; // Skip the escaped character.
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }

    if (char === "(") {
      depth += 1;
      if (depth > maxGroupDepth) maxGroupDepth = depth;
      continue;
    }
    if (char === ")") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (char === "|") {
      alternations += 1;
      continue;
    }
    if (char === "*" || char === "+" || char === "?") {
      quantifiers += 1;
      continue;
    }
    if (char === "{") {
      const close = source.indexOf("}", i);
      if (close === -1) continue; // A literal brace.
      const body = source.slice(i + 1, close);
      if (!/^\d*(,\d*)?$/.test(body) || body === "") continue;

      quantifiers += 1;
      for (const part of body.split(",")) {
        if (part === "") continue;
        const bound = Number(part);
        if (Number.isFinite(bound) && bound > maxRepetition) maxRepetition = bound;
      }
      // An open-ended `{2,}` is unbounded; treat it as exceeding any cap so
      // it is measured as the risk it is rather than as its lower bound.
      if (body.endsWith(",")) maxRepetition = Math.max(maxRepetition, MAX_PATTERN_REPETITION + 1);
      i = close;
      continue;
    }
  }

  return { quantifiers, maxGroupDepth, alternations, maxRepetition };
}

export function checkPatternComplexity(source: string): ComplexityVerdict {
  const metrics = measurePattern(source);

  if (metrics.quantifiers > MAX_PATTERN_QUANTIFIERS) {
    return {
      ok: false,
      reason: `pattern contains ${metrics.quantifiers} quantifiers, above the limit of ${MAX_PATTERN_QUANTIFIERS}`,
      metrics,
    };
  }
  if (metrics.maxGroupDepth > MAX_PATTERN_GROUP_DEPTH) {
    return {
      ok: false,
      reason: `pattern nests groups ${metrics.maxGroupDepth} deep, above the limit of ${MAX_PATTERN_GROUP_DEPTH}`,
      metrics,
    };
  }
  if (metrics.alternations > MAX_PATTERN_ALTERNATIONS) {
    return {
      ok: false,
      reason: `pattern contains ${metrics.alternations} alternations, above the limit of ${MAX_PATTERN_ALTERNATIONS}`,
      metrics,
    };
  }
  if (metrics.maxRepetition > MAX_PATTERN_REPETITION) {
    return {
      ok: false,
      reason: `pattern repeats up to ${metrics.maxRepetition > MAX_PATTERN_REPETITION ? "an unbounded number of" : String(metrics.maxRepetition)} times, above the limit of ${MAX_PATTERN_REPETITION}`,
      metrics,
    };
  }

  return { ok: true, metrics };
}
