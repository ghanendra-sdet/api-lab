import { describe, expect, it } from "vitest";
import { checkPatternComplexity, measurePattern } from "./patternComplexity.ts";
import {
  MAX_PATTERN_ALTERNATIONS,
  MAX_PATTERN_GROUP_DEPTH,
  MAX_PATTERN_QUANTIFIERS,
  MAX_PATTERN_REPETITION,
} from "./limits.ts";

describe("measurePattern", () => {
  it("counts quantifiers, groups and alternations", () => {
    const metrics = measurePattern("^(ab+|cd*)+$");
    expect(metrics.quantifiers).toBe(3); // +, *, and the outer +
    expect(metrics.maxGroupDepth).toBe(1);
    expect(metrics.alternations).toBe(1);
  });

  it("tracks the deepest group nesting, not the final depth", () => {
    expect(measurePattern("((((a))))b").maxGroupDepth).toBe(4);
  });

  it("ignores quantifier and alternation characters inside a character class", () => {
    // Inside [] these are literals. Counting them would reject ordinary
    // patterns and push users to disable screening entirely.
    const metrics = measurePattern("^[a+*|?]$");
    expect(metrics.quantifiers).toBe(0);
    expect(metrics.alternations).toBe(0);
  });

  it("ignores escaped metacharacters", () => {
    const metrics = measurePattern("^a\\+b\\*c\\|d$");
    expect(metrics.quantifiers).toBe(0);
    expect(metrics.alternations).toBe(0);
  });

  it("reads explicit repetition bounds", () => {
    expect(measurePattern("a{2,50}").maxRepetition).toBe(50);
    expect(measurePattern("a{7}").maxRepetition).toBe(7);
  });

  it("treats an open-ended repetition as exceeding any bound", () => {
    // `a{2,}` is unbounded; measuring it as 2 would understate it entirely.
    expect(measurePattern("a{2,}").maxRepetition).toBeGreaterThan(MAX_PATTERN_REPETITION);
  });

  it("does not treat a literal brace as a quantifier", () => {
    const metrics = measurePattern("^\\{hello\\}$");
    expect(metrics.quantifiers).toBe(0);
  });
});

describe("checkPatternComplexity", () => {
  it("accepts ordinary patterns", () => {
    for (const pattern of ["^[a-z]+$", "^\\d{4}-\\d{2}-\\d{2}$", "^(cat|dog)$", "^user_[0-9]+$"]) {
      expect(checkPatternComplexity(pattern).ok, pattern).toBe(true);
    }
  });

  it("rejects a pattern with too many quantifiers", () => {
    // The distributed-ambiguity shape M11's shape screening cannot see: no
    // nested quantifier, no ambiguous group body, still exponential.
    const pattern = "a?".repeat(MAX_PATTERN_QUANTIFIERS + 1);
    const verdict = checkPatternComplexity(pattern);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("quantifiers");
  });

  it("rejects a pattern nested deeper than the group-depth limit", () => {
    const pattern = "(".repeat(MAX_PATTERN_GROUP_DEPTH + 1) + "a" + ")".repeat(MAX_PATTERN_GROUP_DEPTH + 1);
    const verdict = checkPatternComplexity(pattern);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("deep");
  });

  it("rejects a pattern with too many alternations", () => {
    const pattern = Array.from({ length: MAX_PATTERN_ALTERNATIONS + 2 }, (_, i) => `x${i}`).join("|");
    const verdict = checkPatternComplexity(pattern);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("alternations");
  });

  it("rejects an oversized explicit repetition", () => {
    const verdict = checkPatternComplexity(`a{1,${MAX_PATTERN_REPETITION + 1}}`);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("repeats");
  });

  it("rejects an unbounded explicit repetition", () => {
    expect(checkPatternComplexity("a{5,}").ok).toBe(false);
  });
});
