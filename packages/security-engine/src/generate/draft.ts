import type { ExpectedBehavior, Mutation, TestCategory } from "../types.ts";

/**
 * A generated test before it acquires an identity.
 *
 * Ids are assigned centrally in generate/index.ts, after the global
 * `MAX_GENERATED_TESTS` clamp has decided which drafts survive. Minting ids
 * inside each generator would burn them on drafts that get discarded and make
 * two generation runs over the same input produce differently-numbered
 * output for no reason.
 */
export interface TestDraft {
  name: string;
  category: TestCategory;
  mutation: Mutation;
  expected: ExpectedBehavior;
  /** Stable rule identifier, e.g. "negative.body.required-missing". */
  ruleId: string;
  operationId: string | undefined;
  /** Surfaced in the preview when this draft is a compromise (clamped bound,
   * unenumerated branch). */
  warning: string | undefined;
}
