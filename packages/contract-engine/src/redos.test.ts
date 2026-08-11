import { describe, expect, it } from "vitest";
import { checkPatternSafety } from "./redos.ts";
import { MAX_PATTERN_LENGTH } from "./limits.ts";

describe("checkPatternSafety", () => {
  it("accepts the ordinary patterns real specifications use", () => {
    const safe = [
      "^[a-z0-9-]+$",
      "^\\d{4}-\\d{2}-\\d{2}$",
      "^(GET|POST|PUT)$",
      "^[A-Z]{2,4}$",
      "[0-9]+",
      "^\\+?[1-9]\\d{1,14}$",
      "^#[0-9a-fA-F]{6}$",
    ];
    for (const pattern of safe) {
      expect(checkPatternSafety(pattern), pattern).toEqual({ safe: true });
    }
  });

  it("rejects the nested-quantifier shape that froze the thread for 60 seconds", () => {
    // This is the exact pattern measured during Milestone 11's validator
    // research: `^(a+)+$` against 31 characters blocked for ~60s.
    const result = checkPatternSafety("^(a+)+$");
    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toContain("catastrophic backtracking");
  });

  it("rejects the other classic catastrophic shapes", () => {
    const unsafe = [
      "^(a*)*$",
      "^(a+)*$",
      "(x+x+)+y",
      "^(?:a+)+$",
      "^(a|a)+$",
      "^(a|ab)*$",
      "^([a-z]+)+$",
      "^(\\w+\\s?)*$",
      "^(a{1,3})+$",
    ];
    for (const pattern of unsafe) {
      expect(checkPatternSafety(pattern).safe, pattern).toBe(false);
    }
  });

  it("allows a quantified group when the group repeats at most once", () => {
    // `?` cannot drive exponential backtracking, so `(a+)?` is not rejected.
    expect(checkPatternSafety("^(a+)?$")).toEqual({ safe: true });
    expect(checkPatternSafety("^(a|ab)?$")).toEqual({ safe: true });
  });

  it("treats quantifier characters inside a character class as literals", () => {
    // `[+*]` are literal characters, not quantifiers, so this is safe.
    expect(checkPatternSafety("^([+*])+$")).toEqual({ safe: true });
  });

  it("treats escaped quantifier characters as literals", () => {
    expect(checkPatternSafety("^(a\\+)+$")).toEqual({ safe: true });
  });

  it("rejects patterns longer than the configured limit", () => {
    const long = `^${"a".repeat(MAX_PATTERN_LENGTH)}$`;
    const result = checkPatternSafety(long);
    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toContain("limit");
  });

  it("rejects patterns JavaScript cannot compile", () => {
    const result = checkPatternSafety("^(unclosed$");
    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toContain("valid JavaScript regular expression");
  });

  it("returns quickly even for the pathological input it rejects", () => {
    // The whole point: screening must be cheap, because it runs before every
    // pattern is used.
    const start = Date.now();
    checkPatternSafety("^(a+)+(b+)+(c+)+$");
    expect(Date.now() - start).toBeLessThan(50);
  });
});
