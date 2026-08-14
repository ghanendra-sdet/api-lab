import { afterEach, describe, expect, it } from "vitest";
import {
  buildProbeInputs,
  clearPatternVerdicts,
  collectPatterns,
  evaluatePatternSafety,
  getRegisteredVerdict,
  registerPatternVerdicts,
  registeredVerdictCount,
} from "./patternVetting.ts";
import { checkPatternSafety } from "./redos.ts";
import { normalizeSchema } from "./schemaNormalize.ts";
import { MAX_VETTED_PATTERNS } from "./limits.ts";

afterEach(() => {
  clearPatternVerdicts();
});

describe("collectPatterns", () => {
  it("finds patterns at any depth", () => {
    const document = {
      components: {
        schemas: {
          User: {
            type: "object",
            properties: {
              id: { type: "string", pattern: "^[0-9a-f]{8}$" },
              nested: { type: "object", properties: { code: { type: "string", pattern: "^[A-Z]{3}$" } } },
            },
          },
        },
      },
    };

    expect(collectPatterns(document).sort()).toEqual(["^[0-9a-f]{8}$", "^[A-Z]{3}$"]);
  });

  it("collects patternProperties keys, which are themselves regular expressions", () => {
    // Easy to overlook and exactly as exploitable as `pattern`.
    const document = { patternProperties: { "^x-(a+)+$": { type: "string" } } };
    expect(collectPatterns(document)).toContain("^x-(a+)+$");
  });

  it("walks arrays", () => {
    expect(collectPatterns({ allOf: [{ pattern: "^a$" }, { pattern: "^b$" }] }).sort()).toEqual(["^a$", "^b$"]);
  });

  it("de-duplicates repeated patterns", () => {
    expect(collectPatterns({ a: { pattern: "^x$" }, b: { pattern: "^x$" } })).toEqual(["^x$"]);
  });

  it("is bounded by MAX_VETTED_PATTERNS", () => {
    const document: Record<string, unknown> = {};
    for (let i = 0; i < MAX_VETTED_PATTERNS + 50; i++) document[`p${i}`] = { pattern: `^unique-${i}$` };
    expect(collectPatterns(document).length).toBeLessThanOrEqual(MAX_VETTED_PATTERNS);
  });

  it("does not recurse without bound on a deeply nested document", () => {
    let node: Record<string, unknown> = { pattern: "^deep$" };
    for (let i = 0; i < 500; i++) node = { child: node };
    expect(() => collectPatterns(node)).not.toThrow();
  });
});

describe("buildProbeInputs", () => {
  it("produces bounded probes that end in a non-matching character", () => {
    for (const probe of buildProbeInputs("^(a+)+$")) {
      expect(probe.length).toBeLessThanOrEqual(64);
      expect(probe.endsWith("!")).toBe(true);
    }
  });

  it("includes a probe built from a literal character named by the pattern", () => {
    // `^(x+)+$` does not backtrack on a string of a's at all.
    expect(buildProbeInputs("^(x+)+$").some((probe) => probe.startsWith("xxxx"))).toBe(true);
  });
});

describe("evaluatePatternSafety", () => {
  it("reports a linear pattern as safe", () => {
    expect(evaluatePatternSafety("^[a-z]+$")).toBe("safe");
  });

  it("reports an uncompilable pattern as unsafe", () => {
    expect(evaluatePatternSafety("^(unclosed")).toBe("unsafe");
  });

  it("completes quickly for safe patterns", () => {
    // Guards the probe budget itself: if PROBE_LENGTH ever grew enough to make
    // ordinary patterns slow, vetting would become the performance problem.
    const started = Date.now();
    for (let i = 0; i < 200; i++) evaluatePatternSafety("^\\d{4}-\\d{2}-\\d{2}$");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("verdict registry", () => {
  it("starts empty and reports no verdict for an unknown pattern", () => {
    expect(registeredVerdictCount()).toBe(0);
    expect(getRegisteredVerdict("^a$")).toBeUndefined();
  });

  it("records and clears verdicts", () => {
    registerPatternVerdicts([{ pattern: "^a$", verdict: "timeout" }]);
    expect(getRegisteredVerdict("^a$")).toBe("timeout");
    clearPatternVerdicts();
    expect(getRegisteredVerdict("^a$")).toBeUndefined();
  });
});

describe("checkPatternSafety layering (spec §37)", () => {
  it("rejects a pattern the worker reported as timing out, even though it is statically simple", () => {
    // `^[a-z]+$` passes every static check. The dynamic verdict must still be
    // able to veto — that is the whole point of the third layer.
    expect(checkPatternSafety("^[a-z]+$").safe).toBe(true);

    registerPatternVerdicts([{ pattern: "^[a-z]+$", verdict: "timeout" }]);

    const verdict = checkPatternSafety("^[a-z]+$");
    expect(verdict.safe).toBe(false);
    if (!verdict.safe) expect(verdict.reason).toContain("time budget");
  });

  it("a safe worker verdict does not override the static complexity cap", () => {
    // Layers are AND-ed, never OR-ed: surviving a 40-character probe is not
    // proof of safety against a 10,000-character body.
    const pattern = "a?".repeat(40);
    registerPatternVerdicts([{ pattern, verdict: "safe" }]);
    expect(checkPatternSafety(pattern).safe).toBe(false);
  });

  it("still rejects M11's original catastrophic shape", () => {
    const verdict = checkPatternSafety("^(a+)+$");
    expect(verdict.safe).toBe(false);
  });

  it("removes a worker-rejected pattern from a normalized schema", () => {
    // The end-to-end consequence: a vetoed pattern never reaches the
    // validator, so the main thread never executes it.
    registerPatternVerdicts([{ pattern: "^[a-z]+$", verdict: "timeout" }]);

    const result = normalizeSchema({ type: "string", pattern: "^[a-z]+$" }, "3.1");

    expect(result.schema).toEqual({ type: "string" });
    expect(result.warnings.join(" ")).toContain("Pattern validation skipped");
  });
});
