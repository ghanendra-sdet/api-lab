import { MAX_SCHEMA_DEPTH, MAX_VETTED_PATTERNS } from "./limits.ts";

/**
 * Dynamic pattern vetting — the third and final ReDoS defence layer
 * (Milestone 12, spec §37).
 *
 * ## Why static screening cannot be the whole answer
 *
 * Milestone 11 screens patterns by shape; Milestone 12's patternComplexity.ts
 * adds blunt structural caps. Both are static, both are heuristics, and both
 * are documented as such. Spec §37 says: "Do not assume static screening
 * alone is perfect. If regex evaluation remains potentially blocking, move it
 * into an isolated worker with a hard timeout."
 *
 * It does remain potentially blocking, for a reason that is worth stating
 * exactly: **JavaScript cannot interrupt a running regex.** There is no
 * timeout option on `RegExp.test`, no cancellation, and no yield point. Once
 * the engine starts backtracking, the thread is gone until it finishes — the
 * 60 seconds Milestone 11 measured for `^(a+)+$` against 31 characters. On
 * the main thread, that is the whole application frozen.
 *
 * The only mechanism in the platform that can actually stop it is
 * `Worker.terminate()`, which kills the thread outright. So the real
 * mitigation has exactly one shape: run the pattern somewhere disposable,
 * and dispose of it if it does not come back.
 *
 * ## The division of labour
 *
 * This module is pure and framework-independent, like the rest of
 * contract-engine — it does not create a Worker, because it has no idea
 * whether it is running in a browser, in Node, or in a test. It supplies the
 * three pure pieces a host needs:
 *
 * - `collectPatterns` — enumerate the patterns in an untrusted document
 * - `buildProbeInputs` — the bounded adversarial inputs to try
 * - `evaluatePatternSafety` — the function the *worker* calls, which is the
 *   only thing here that ever executes a regex
 *
 * …and a registry the host writes verdicts back into. `apps/web` owns the
 * actual Worker, the timeout, and the `terminate()` call. See
 * `apps/web/src/lib/patternVetting.ts`.
 *
 * ## Pre-flight, not inline
 *
 * Vetting happens once per document, when a specification is imported or
 * loaded — not during validation. Validation is synchronous and sits in the
 * request pipeline; it cannot await a worker round-trip. By the time any
 * request is validated, every pattern in the contract has already been
 * vetted, and `redos.ts` consults the registry before it consults anything
 * else. A pattern that timed out in the worker is never executed on the main
 * thread at all.
 */

export type PatternVerdict = "safe" | "unsafe" | "timeout";

// ---------------------------------------------------------------------------
// Pattern collection
// ---------------------------------------------------------------------------

/**
 * Enumerates every distinct `pattern` string in a parsed document.
 *
 * Walks the raw document rather than the normalized contract model, because
 * normalization is exactly where unsafe patterns get *removed* — by then the
 * dangerous ones are gone and there is nothing left to vet. Depth- and
 * count-bounded, since the document is untrusted (spec §38).
 */
export function collectPatterns(raw: unknown): string[] {
  const found = new Set<string>();

  function walk(node: unknown, depth: number): void {
    if (found.size >= MAX_VETTED_PATTERNS || depth > MAX_SCHEMA_DEPTH) return;

    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, depth + 1);
      return;
    }
    if (typeof node !== "object" || node === null) return;

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (found.size >= MAX_VETTED_PATTERNS) return;
      // Both keywords take a regular expression. `patternProperties` keys are
      // themselves patterns, which is easy to forget and just as exploitable.
      if (key === "pattern" && typeof value === "string") {
        found.add(value);
        continue;
      }
      if (key === "patternProperties" && typeof value === "object" && value !== null) {
        for (const propertyPattern of Object.keys(value as Record<string, unknown>)) found.add(propertyPattern);
      }
      walk(value, depth + 1);
    }
  }

  walk(raw, 0);
  return [...found];
}

// ---------------------------------------------------------------------------
// Probe inputs
// ---------------------------------------------------------------------------

/** Probe length. Chosen so that an exponential pattern needs roughly 2^40
 * steps — instantly fatal — while a linear one finishes in microseconds.
 * Longer probes would not make detection more reliable, only slower. */
const PROBE_LENGTH = 40;

/**
 * Bounded adversarial inputs for one pattern.
 *
 * Catastrophic backtracking needs two things: an input the pattern *almost*
 * matches, and a final character that forces failure. A matching input
 * returns early and proves nothing; that is why every probe ends in a
 * character chosen to be outside the usual pattern alphabets.
 *
 * These are fixed and derived only from the pattern's own alphabet — this is
 * not a fuzzer, and it never sends anything anywhere. Spec §43 also requires
 * that the *test suite* not run genuinely unbounded catastrophic regexes;
 * probes stay at 40 characters precisely so a pathological pattern is caught
 * by the timeout in milliseconds rather than actually being allowed to run
 * to completion.
 */
export function buildProbeInputs(pattern: string): string[] {
  const probes = ["a".repeat(PROBE_LENGTH) + "!", "0".repeat(PROBE_LENGTH) + "!", " ".repeat(PROBE_LENGTH) + "!"];

  // If the pattern names a specific literal character, repeating *that* is a
  // far more effective probe than a generic "a" — `^(x+)+$` does not
  // backtrack on a's at all.
  const literal = /[A-Za-z0-9]/.exec(pattern.replace(/\\[A-Za-z]/g, ""));
  if (literal !== null && literal[0] !== "a" && literal[0] !== "0") {
    probes.push(literal[0].repeat(PROBE_LENGTH) + "!");
  }

  return probes;
}

// ---------------------------------------------------------------------------
// Evaluation — WORKER ONLY
// ---------------------------------------------------------------------------

/**
 * Executes a pattern against its probes and reports whether it completed.
 *
 * **This is the only function in contract-engine that runs an untrusted
 * regular expression, and it must only ever be called from inside a
 * disposable worker.** Calling it on the main thread reintroduces exactly
 * the freeze this whole subsystem exists to prevent — there is no timeout
 * inside this function, and there cannot be one, because JavaScript provides
 * no way to interrupt a regex. The timeout is enforced *outside*, by the host
 * terminating the worker.
 *
 * A pattern that returns from here has demonstrably completed against inputs
 * designed to be its worst case, which is a materially stronger statement
 * than any static check can make.
 */
export function evaluatePatternSafety(pattern: string): PatternVerdict {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return "unsafe";
  }

  for (const probe of buildProbeInputs(pattern)) {
    try {
      regex.test(probe);
    } catch {
      return "unsafe";
    }
  }

  return "safe";
}

// ---------------------------------------------------------------------------
// Verdict registry
// ---------------------------------------------------------------------------

/**
 * Verdicts written back by the host after worker vetting.
 *
 * Module-level mutable state, which is unusual for this codebase and worth
 * justifying. The alternative — threading a verdict map through
 * `normalizeSchema` → `parseContract` → `validateContract` → every call site
 * in apps/web — would put a security-critical parameter in the hands of a
 * dozen callers, any one of which could omit it and silently lose the
 * protection. A registry consulted at the single point where patterns are
 * screened cannot be bypassed by forgetting an argument.
 *
 * Only `unsafe`/`timeout` verdicts change behaviour. A `safe` verdict does
 * not *loosen* the static checks — a pattern that survives the probes but
 * trips the complexity cap stays rejected. The layers are AND-ed, never OR-ed:
 * any one of them may veto.
 */
const verdicts = new Map<string, PatternVerdict>();

export function registerPatternVerdicts(entries: Array<{ pattern: string; verdict: PatternVerdict }>): void {
  for (const entry of entries) {
    if (verdicts.size >= MAX_VETTED_PATTERNS && !verdicts.has(entry.pattern)) continue;
    verdicts.set(entry.pattern, entry.verdict);
  }
}

export function getRegisteredVerdict(pattern: string): PatternVerdict | undefined {
  return verdicts.get(pattern);
}

export function clearPatternVerdicts(): void {
  verdicts.clear();
}

/** Diagnostic accessor for the UI's security panel and for tests. */
export function registeredVerdictCount(): number {
  return verdicts.size;
}
