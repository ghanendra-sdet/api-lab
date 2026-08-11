import { MAX_PATTERN_LENGTH } from "./limits.ts";

/**
 * Static safety screening for JSON Schema `pattern` keywords (spec §41).
 *
 * ## Why this exists
 *
 * A `pattern` in an OpenAPI document is an attacker-controlled regular
 * expression that API Lab would otherwise hand straight to JavaScript's
 * backtracking regex engine. This is not a theoretical concern: while
 * choosing the schema validator for Milestone 11, the pattern `^(a+)+$`
 * matched against a 31-character non-matching string blocked the thread for
 * **60 seconds**. In a browser that is the UI thread. There is no timeout
 * option and no way to interrupt a running `RegExp.test` in JavaScript, so
 * the only effective mitigation is to never start the match.
 *
 * Milestone 7 identified the same class of risk for the `matches` assertion
 * operator, where the regex is authored by the user themselves. Here the
 * regex arrives inside an imported third-party document, so the argument for
 * screening it is strictly stronger.
 *
 * ## What it does
 *
 * It rejects the shapes that cause catastrophic backtracking, rather than
 * attempting to prove a pattern safe (which is undecidable in general for
 * backtracking engines). Rejection is conservative and deliberately allows
 * false positives: a rejected pattern produces a **warning** violation
 * saying the check was skipped, never a silent pass (spec §23) and never a
 * spurious failure. Over-rejecting costs a little validation coverage;
 * under-rejecting costs a frozen browser tab.
 *
 * The dangerous shape is a group that can repeat unboundedly whose body can
 * itself match the same input in more than one way — classically a nested
 * quantifier (`(a+)+`) or an ambiguous alternation (`(a|ab)*`).
 */

export type PatternSafety = { safe: true } | { safe: false; reason: string };

/** Quantifiers that permit more than one repetition. `?` is excluded on
 * purpose: an at-most-once group cannot drive exponential backtracking. */
function readOuterQuantifier(source: string, index: number): { length: number; repeats: boolean } | null {
  const char = source[index];
  if (char === "*" || char === "+") return { length: 1, repeats: true };
  if (char === "?") return { length: 1, repeats: false };
  if (char !== "{") return null;

  const close = source.indexOf("}", index);
  if (close === -1) return null;
  const body = source.slice(index + 1, close);
  if (!/^\d*(,\d*)?$/.test(body) || body === "") return null;

  const [minText, maxText] = body.split(",");
  const min = Number(minText ?? "0");
  // `{2}` repeats exactly twice, `{1,}` is unbounded, `{0,1}` is really `?`.
  const max = maxText === undefined ? min : maxText === "" ? Infinity : Number(maxText);
  return { length: close - index + 1, repeats: max > 1 };
}

/**
 * True when `body` contains an unescaped quantifier or alternation at the
 * top level of a group — the two ways a repeated group's body becomes
 * ambiguous. Character-class contents are skipped, since `+` inside `[a+]`
 * is a literal plus, not a quantifier.
 */
function bodyIsAmbiguous(body: string): boolean {
  let inClass = false;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];

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
    if (char === "|") return true;
    if (char === "*" || char === "+") return true;
    if (char === "{" && readOuterQuantifier(body, i)?.repeats === true) return true;
  }

  return false;
}

/**
 * Screens a `pattern` before it is ever compiled or executed.
 *
 * Rejects, in order: over-long sources (a cheap bound on the search space),
 * patterns JavaScript cannot even compile, and repeated groups with an
 * ambiguous body.
 */
export function checkPatternSafety(source: string): PatternSafety {
  if (source.length > MAX_PATTERN_LENGTH) {
    return {
      safe: false,
      reason: `pattern is longer than the ${MAX_PATTERN_LENGTH}-character limit`,
    };
  }

  try {
    new RegExp(source);
  } catch {
    return { safe: false, reason: "pattern is not a valid JavaScript regular expression" };
  }

  const groupStarts: number[] = [];
  let inClass = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (char === "\\") {
      i++;
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
      groupStarts.push(i);
      continue;
    }
    if (char !== ")") continue;

    const start = groupStarts.pop();
    if (start === undefined) continue; // Unbalanced; `new RegExp` already vetted this.

    const quantifier = readOuterQuantifier(source, i + 1);
    if (!quantifier?.repeats) continue;

    // Strip a leading group modifier — `(?:`, `(?=`, `(?!`, `(?<name>` — so
    // the body examined is the actual matched content.
    let body = source.slice(start + 1, i);
    const modifier = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(body);
    if (modifier) body = body.slice(modifier[0].length);

    if (bodyIsAmbiguous(body)) {
      return {
        safe: false,
        reason: "pattern nests a quantifier or alternation inside a repeated group, which can cause catastrophic backtracking",
      };
    }
  }

  return { safe: true };
}
