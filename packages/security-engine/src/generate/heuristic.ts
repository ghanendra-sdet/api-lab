import { MAX_TESTS_PER_OPERATION } from "../limits.ts";
import { collectFields, type CollectedField } from "../pointer.ts";
import type { GeneratorCategories, SecurityRequestInput } from "../types.ts";
import type { TestDraft } from "./draft.ts";
import { expectInvalidInput, expectValidInput, type GenerationExpectations } from "./expectations.ts";
import { emptyValue, wrongTypeValue } from "./values.ts";

/**
 * Generation without a contract (spec §27).
 *
 * ## Deliberately weaker, and honest about it
 *
 * When no OpenAPI operation matches the request, the only description of its
 * shape available is the request body the user typed. That supports exactly
 * two reliable mutation families — wrong type and null/empty — because those
 * are derivable from the *observed* value. Everything else the contract
 * generator does depends on facts a body cannot express:
 *
 * - **Required fields**: a body shows which fields are present, never which
 *   are mandatory. Removing an optional field and asserting a 400 would fail
 *   against a perfectly correct API.
 * - **Boundaries**: `{"age": 25}` says nothing about whether 17 is legal.
 * - **Enums**: `{"role": "admin"}` does not tell us the permitted set.
 *
 * So those categories emit a warning explaining that a specification is
 * needed, rather than generating tests that assert rules nobody stated. A
 * negative test that fails against a conforming API is worse than no test:
 * it costs a developer an afternoon and then gets muted.
 *
 * Every draft from here is tagged `source: "heuristic"` so reports can show
 * which assertions are schema-backed and which are inferred.
 */

export interface HeuristicGenerationInput {
  request: SecurityRequestInput;
  categories: GeneratorCategories;
  expectations: GenerationExpectations;
  label: string;
}

/** Maps an observed JSON value onto the `types` shape values.ts expects. */
function typesOf(field: CollectedField): string[] {
  switch (field.kind) {
    case "number":
      return ["number"];
    case "string":
      return ["string"];
    case "boolean":
      return ["boolean"];
    case "array":
      return ["array"];
    case "object":
      return ["object"];
    case "null":
      return ["null"];
    default:
      return [];
  }
}

export function generateHeuristic(input: HeuristicGenerationInput): { drafts: TestDraft[]; warnings: string[] } {
  const { request, categories, expectations, label } = input;
  const drafts: TestDraft[] = [];
  const warnings: string[] = [];

  if (categories.missingRequiredFields) {
    warnings.push(
      `${label} did not match an OpenAPI operation, so required-field tests were not generated — a request body cannot say which of its fields are mandatory. Attach a specification to generate them.`,
    );
  }
  if (categories.boundaryValues) {
    warnings.push(
      `${label} did not match an OpenAPI operation, so boundary tests were not generated — bounds are only knowable from a schema.`,
    );
  }
  if (categories.invalidEnums) {
    warnings.push(
      `${label} did not match an OpenAPI operation, so enum tests were not generated — the permitted values are only knowable from a schema.`,
    );
  }

  let parsed: unknown;
  const hasBody = request.body !== undefined && request.body.trim() !== "";
  if (hasBody) {
    try {
      parsed = JSON.parse(request.body!);
    } catch {
      warnings.push(`${label} has a body that is not valid JSON, so no field-level mutations were generated.`);
      parsed = undefined;
    }
  }

  if (parsed !== undefined) {
    for (const field of collectFields(parsed)) {
      const types = typesOf(field);

      if (categories.invalidTypes) {
        const wrong = wrongTypeValue({ types });
        if (wrong !== null) {
          drafts.push({
            name: `${label} — send ${field.pointer} as ${wrong.describe}`,
            category: "negative",
            mutation: {
              location: "request.body",
              operation: "set-wrong-type",
              target: field.pointer,
              value: { kind: "json", json: wrong.value },
              description: `send ${field.pointer} as ${wrong.describe}`,
            },
            expected: expectInvalidInput(expectations),
            ruleId: "negative.body.wrong-type",
            operationId: undefined,
            warning: undefined,
          });
        }
      }

      if (categories.nullValues && field.kind !== "null") {
        drafts.push({
          name: `${label} — send ${field.pointer} as null`,
          category: "negative",
          mutation: {
            location: "request.body",
            operation: "set-null",
            target: field.pointer,
            value: { kind: "json", json: null },
            description: `send ${field.pointer} as null`,
          },
          expected: expectInvalidInput(expectations),
          ruleId: "negative.body.null",
          operationId: undefined,
          warning: undefined,
        });
      }

      if (categories.emptyValues) {
        const empty = emptyValue({ types });
        if (empty !== null && field.value !== empty.value) {
          drafts.push({
            name: `${label} — send ${field.pointer} as ${empty.describe}`,
            category: "negative",
            mutation: {
              location: "request.body",
              operation: "set-empty",
              target: field.pointer,
              value: { kind: "json", json: empty.value },
              description: `send ${field.pointer} as ${empty.describe}`,
            },
            // Without a schema there is no basis for asserting a rejection —
            // an empty string may be entirely legal. Reported as "should not
            // crash" rather than "should be rejected".
            expected: expectValidInput(expectations),
            ruleId: "negative.body.empty",
            operationId: undefined,
            warning: undefined,
          });
        }
      }
    }
  }

  if (categories.malformedJson && hasBody) {
    drafts.push({
      name: `${label} — malformed JSON body`,
      category: "negative",
      mutation: {
        location: "request.body",
        operation: "malform-json",
        target: "",
        value: { kind: "none" },
        description: "truncate the JSON body so it no longer parses",
      },
      expected: expectInvalidInput(expectations),
      ruleId: "negative.body.malformed-json",
      operationId: undefined,
      warning: undefined,
    });
  }

  if (categories.emptyValues) {
    for (const parameter of request.query) {
      if (parameter.value === "") continue;
      drafts.push({
        name: `${label} — empty query parameter ${parameter.name}`,
        category: "negative",
        mutation: {
          location: "request.query",
          operation: "set-empty",
          target: parameter.name,
          value: { kind: "text", text: "" },
          description: `send query parameter ${parameter.name} with an empty value`,
        },
        expected: expectValidInput(expectations),
        ruleId: "negative.query.empty",
        operationId: undefined,
        warning: undefined,
      });
    }
  }

  if (drafts.length > MAX_TESTS_PER_OPERATION) {
    warnings.push(
      `${label} produced ${drafts.length} candidate tests; only the first ${MAX_TESTS_PER_OPERATION} were kept.`,
    );
    return { drafts: drafts.slice(0, MAX_TESTS_PER_OPERATION), warnings };
  }

  return { drafts, warnings };
}
