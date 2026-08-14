import { describe, expect, it } from "vitest";
import { checkPatternSafety } from "./redos.ts";
import { checkPatternComplexity } from "./patternComplexity.ts";
import { clearPatternVerdicts, registerPatternVerdicts } from "./patternVetting.ts";

/**
 * The concrete blind spot that motivates worker isolation (Milestone 12,
 * spec §37).
 *
 * `^[a-z]+[a-z]+…[a-z]+$` with ten consecutive quantified groups is
 * catastrophic: matched against a 40-character non-matching string it was
 * measured still running after **8 seconds** during Milestone 12 validation.
 *
 * And yet it passes every static check API Lab has:
 *
 *  - Milestone 11's shape screening sees no *nested* quantifier and no
 *    alternation inside a repeated group, so it has nothing to object to.
 *  - Milestone 12's complexity caps see ten quantifiers (limit 20), zero
 *    group nesting (limit 5), and zero alternations (limit 20).
 *
 * The ambiguity is distributed *across* the groups rather than contained in
 * one, which is precisely the class no shape heuristic catches. This test
 * pins that reality down, so nobody later concludes the static layers are
 * sufficient and removes the worker.
 */
const DISTRIBUTED_AMBIGUITY = `^${"[a-z]+".repeat(10)}$`;

describe("the static-screening blind spot (spec §37)", () => {
  it("is not caught by the complexity caps", () => {
    expect(checkPatternComplexity(DISTRIBUTED_AMBIGUITY).ok).toBe(true);
  });

  it("is not caught by the combined static screening either", () => {
    clearPatternVerdicts();
    expect(checkPatternSafety(DISTRIBUTED_AMBIGUITY).safe).toBe(true);
  });

  it("IS caught once the isolated worker reports it timed out", () => {
    // This is the layer that closes the gap. Without it, this pattern would
    // reach the main thread and freeze the tab.
    registerPatternVerdicts([{ pattern: DISTRIBUTED_AMBIGUITY, verdict: "timeout" }]);

    const verdict = checkPatternSafety(DISTRIBUTED_AMBIGUITY);
    expect(verdict.safe).toBe(false);
    if (!verdict.safe) expect(verdict.reason).toContain("time budget");

    clearPatternVerdicts();
  });
});
