import type { ContractOperation } from "@api-lab/contract-engine";
import { createNegativeTestId } from "../id.ts";
import { MAX_GENERATED_TESTS } from "../limits.ts";
import type { GenerationResult, GeneratorCategories, NegativeTest, SecurityRequestInput, TestSource } from "../types.ts";
import { generateAuthTests } from "./auth.ts";
import type { TestDraft } from "./draft.ts";
import { createDefaultGenerationExpectations, type GenerationExpectations } from "./expectations.ts";
import { generateFromContract } from "./fromContract.ts";
import { generateHeuristic } from "./heuristic.ts";

export * from "./draft.ts";
export * from "./expectations.ts";
export * from "./schemaFields.ts";
export * from "./values.ts";
export { generateFromContract } from "./fromContract.ts";
export { generateHeuristic } from "./heuristic.ts";
export { generateAuthTests } from "./auth.ts";

/**
 * The generation entry point (spec §20, §27, §28, §29).
 *
 * Takes one or more target requests, produces a bounded, previewable list of
 * negative tests, and **sends nothing**. Spec §28 requires the user to
 * explicitly start execution after reviewing the preview, so generation and
 * execution are separate functions in separate files with no path between
 * them — there is deliberately no `generateAndRun`.
 */

export interface GenerationTarget {
  requestId: string;
  requestName: string;
  /** Fully resolved — variables substituted, auth applied. */
  request: SecurityRequestInput;
  /** The matched contract operation, when the request maps onto one. */
  operation: ContractOperation | undefined;
  /** The contract's components, for `$ref` resolution. */
  components: Record<string, unknown> | undefined;
}

export interface GenerateInput {
  targets: GenerationTarget[];
  categories: GeneratorCategories;
  expectations?: GenerationExpectations;
}

function toNegativeTest(draft: TestDraft, target: GenerationTarget, source: TestSource, createdAt: string): NegativeTest {
  return {
    id: createNegativeTestId(),
    name: draft.name,
    category: draft.category,
    targetRequestId: target.requestId,
    targetRequestName: target.requestName,
    mutation: draft.mutation,
    expected: draft.expected,
    enabled: true,
    metadata: {
      source,
      ruleId: draft.ruleId,
      operationId: draft.operationId,
      createdAt,
    },
  };
}

export function generateNegativeTests(input: GenerateInput): GenerationResult {
  const expectations = input.expectations ?? createDefaultGenerationExpectations();
  const categories: GeneratorCategories = input.categories;
  const createdAt = new Date().toISOString();

  const tests: NegativeTest[] = [];
  const warnings: string[] = [];
  let truncated = false;

  for (const target of input.targets) {
    if (tests.length >= MAX_GENERATED_TESTS) {
      truncated = true;
      break;
    }

    const label = target.operation ? `${target.operation.method} ${target.operation.path}` : target.requestName;
    const source: TestSource = target.operation ? "contract" : "heuristic";

    const drafts: TestDraft[] = [];

    if (target.operation) {
      const result = generateFromContract({
        operation: target.operation,
        components: target.components,
        categories,
        expectations,
        hasAuth: target.request.auth.kind !== "none",
        hasBody: target.request.body !== undefined && target.request.body.trim() !== "",
      });
      drafts.push(...result.drafts);
      warnings.push(...result.warnings);
    } else {
      const result = generateHeuristic({ request: target.request, categories, expectations, label });
      drafts.push(...result.drafts);
      warnings.push(...result.warnings);
    }

    // Authentication tests are generated identically in both modes: they
    // depend on where the credential sits, not on whether a schema exists.
    const auth = generateAuthTests({
      auth: target.request.auth,
      categories,
      expectations,
      label,
      operationId: target.operation?.id,
    });
    drafts.push(...auth.drafts);
    warnings.push(...auth.warnings);

    for (const draft of drafts) {
      if (tests.length >= MAX_GENERATED_TESTS) {
        truncated = true;
        break;
      }
      if (draft.warning !== undefined) warnings.push(draft.warning);
      tests.push(toNegativeTest(draft, target, source, createdAt));
    }
  }

  if (truncated) {
    warnings.push(
      `Generation stopped at the ${MAX_GENERATED_TESTS}-test limit. Narrow the selected categories or target fewer requests to cover the rest.`,
    );
  }

  // De-duplicated warnings: one message per distinct cause, however many
  // operations produced it. A preview whose warning list is longer than its
  // test list does not get read.
  return { tests, warnings: [...new Set(warnings)], truncated };
}
