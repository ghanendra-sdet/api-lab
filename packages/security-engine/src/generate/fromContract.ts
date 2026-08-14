import type { ContractOperation, ContractParameter } from "@api-lab/contract-engine";
import { isJsonMediaType } from "@api-lab/contract-engine";
import { UNEXPECTED_CONTENT_TYPE } from "../credentials.ts";
import { MAX_TESTS_PER_OPERATION } from "../limits.ts";
import type { GeneratorCategories, Mutation } from "../types.ts";
import type { TestDraft } from "./draft.ts";
import { expectInvalidInput, expectValidInput, type GenerationExpectations } from "./expectations.ts";
import { collectSchemaFields, type SchemaField } from "./schemaFields.ts";
import { boundaryCases, emptyValue, invalidEnumValue, invalidParameterValue, primaryType, wrongTypeValue } from "./values.ts";

/**
 * Contract-aware negative test generation — the headline feature of
 * Milestone 12 (spec §20).
 *
 * ## The pipeline
 *
 * `OpenAPI → Schema → Mutation → Invalid request → API → Expected 4xx`
 *
 * What makes this qualitatively better than generating tests from a request
 * body is that the specification carries the three facts a body cannot:
 * which fields are **required**, what **type** each one is, and what
 * **bounds** apply. Each of those turns a guess into an assertion the API
 * has already agreed to. When `age` is declared `integer, minimum: 18`, the
 * API has promised to reject `17` — so "send 17, expect 4xx" is checking a
 * commitment, not a hunch.
 *
 * ## What is deliberately not generated
 *
 * - Nothing for `anyOf`/`oneOf` branches (see schemaFields.ts): a field
 *   required in one branch and absent in another has no single correct
 *   expectation.
 * - No null mutation for a nullable field. The contract says `null` is
 *   valid, so asserting a rejection would be asserting the opposite of what
 *   was documented.
 * - No mutation for an untyped, unbounded, non-enum field. There is no value
 *   such a field is contractually obliged to reject.
 *
 * In every one of those cases the honest output is fewer tests, and the
 * reason is surfaced as a generation warning rather than silently producing
 * a test that fails against a conforming API.
 */

export interface ContractGenerationInput {
  operation: ContractOperation;
  components: Record<string, unknown> | undefined;
  categories: GeneratorCategories;
  expectations: GenerationExpectations;
  /** Whether the target request actually carries a credential, so auth
   * mutations are only generated when there is something to mutate. */
  hasAuth: boolean;
  /** Whether the target request has a body, for the malformed-JSON case. */
  hasBody: boolean;
}

export interface ContractGenerationResult {
  drafts: TestDraft[];
  warnings: string[];
}

function bodyMutation(
  operation: ContractOperation,
  operationName: string,
  ruleId: string,
  mutation: Mutation,
): Omit<TestDraft, "expected" | "warning"> {
  return {
    name: `${operationName} — ${mutation.description}`,
    category: "negative",
    mutation,
    ruleId,
    operationId: operation.id,
  };
}

function describeOperation(operation: ContractOperation): string {
  return `${operation.method} ${operation.path}`;
}

/** The JSON request-body schema, when the operation documents one. */
function jsonBodySchema(operation: ContractOperation): { schema: unknown; found: boolean } {
  const body = operation.requestBody;
  if (body === undefined) return { schema: undefined, found: false };
  const media = body.content.find((entry) => isJsonMediaType(entry.contentType));
  if (media === undefined) return { schema: undefined, found: false };
  return { schema: media.schema, found: true };
}

export function generateFromContract(input: ContractGenerationInput): ContractGenerationResult {
  const { operation, categories, expectations } = input;
  const drafts: TestDraft[] = [];
  const warnings: string[] = [];
  const label = describeOperation(operation);

  // -------------------------------------------------------------------
  // Request body (spec §7, §8)
  // -------------------------------------------------------------------
  const body = jsonBodySchema(operation);
  if (body.found) {
    const collected = collectSchemaFields(body.schema as never, input.components);
    warnings.push(...collected.warnings);

    for (const field of collected.fields) {
      const type = primaryType(field);

      // --- Required field removal (spec §7) ---------------------------
      if (categories.missingRequiredFields && field.required) {
        drafts.push({
          ...bodyMutation(operation, label, "negative.body.required-missing", {
            location: "request.body",
            operation: "remove",
            target: field.pointer,
            value: { kind: "none" },
            description: `remove required field ${field.pointer}`,
          }),
          expected: expectInvalidInput(expectations),
          warning: undefined,
        });
      }

      // --- Wrong type (spec §7) ---------------------------------------
      if (categories.invalidTypes) {
        const wrong = wrongTypeValue(field);
        if (wrong !== null) {
          drafts.push({
            ...bodyMutation(operation, label, "negative.body.wrong-type", {
              location: "request.body",
              operation: "set-wrong-type",
              target: field.pointer,
              value: { kind: "json", json: wrong.value },
              description: `send ${field.pointer} as ${wrong.describe}`,
            }),
            expected: expectInvalidInput(expectations),
            warning: undefined,
          });
        }
      }

      // --- Null (spec §7) ----------------------------------------------
      // Skipped when the contract declares the field nullable: `null` is a
      // documented legal value there, so a rejection would be the bug.
      if (categories.nullValues && !field.types.includes("null") && field.types.length > 0) {
        drafts.push({
          ...bodyMutation(operation, label, "negative.body.null", {
            location: "request.body",
            operation: "set-null",
            target: field.pointer,
            value: { kind: "json", json: null },
            description: `send ${field.pointer} as null`,
          }),
          expected: expectInvalidInput(expectations),
          warning: undefined,
        });
      }

      // --- Empty (spec §7) ----------------------------------------------
      if (categories.emptyValues) {
        const empty = emptyValue(field);
        // An empty string is only *invalid* when a minLength forbids it.
        // Without one the contract permits `""`, so the expectation flips.
        const forbidden = type === "string" ? (field.minLength ?? 0) > 0 : false;
        if (empty !== null) {
          drafts.push({
            ...bodyMutation(operation, label, "negative.body.empty", {
              location: "request.body",
              operation: "set-empty",
              target: field.pointer,
              value: { kind: "json", json: empty.value },
              description: `send ${field.pointer} as ${empty.describe}`,
            }),
            expected: forbidden ? expectInvalidInput(expectations) : expectValidInput(expectations),
            warning: undefined,
          });
        }
      }

      // --- Boundaries (spec §7) ------------------------------------------
      if (categories.boundaryValues) {
        for (const boundary of boundaryCases(field)) {
          drafts.push({
            ...bodyMutation(operation, label, "negative.body.boundary", {
              location: "request.body",
              operation: "set-boundary",
              target: field.pointer,
              value: { kind: "json", json: boundary.value },
              description: `send ${field.pointer} at ${boundary.label}`,
            }),
            expected: boundary.expectValid ? expectValidInput(expectations) : expectInvalidInput(expectations),
            warning: boundary.warning,
          });
        }
      }

      // --- Enum (spec §8) -------------------------------------------------
      if (categories.invalidEnums) {
        const invalid = invalidEnumValue(field);
        if (invalid !== null) {
          drafts.push({
            ...bodyMutation(operation, label, "negative.body.invalid-enum", {
              location: "request.body",
              operation: "set-invalid-enum",
              target: field.pointer,
              value: { kind: "json", json: invalid.value },
              description: `send ${field.pointer} as ${invalid.describe}`,
            }),
            expected: expectInvalidInput(expectations),
            warning: undefined,
          });
        }
      }
    }

    // --- Malformed JSON (spec §7, §19) ----------------------------------
    if (categories.malformedJson && input.hasBody) {
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
        operationId: operation.id,
        warning: undefined,
      });
    }
  } else if (categories.missingRequiredFields || categories.invalidTypes) {
    warnings.push(`${label} documents no JSON request body, so no body mutations were generated for it.`);
  }

  // -------------------------------------------------------------------
  // Parameters (spec §9, §10, §11)
  // -------------------------------------------------------------------
  for (const parameter of operation.parameters) {
    const asField = parameterAsField(parameter);

    if (parameter.location === "path") {
      // Spec §9: an invalid path parameter. Only generated when the contract
      // declares a type or format that makes a value *wrong* — a free-form
      // string path parameter has no invalid value.
      // The enum case and the type case are gated separately. Selecting only
      // "invalid enums" must not also produce a *type* mutation on an
      // unrelated integer parameter — the preview would then contain tests
      // the tester did not ask for, which undermines the whole point of the
      // approval step in spec §28.
      if (parameterCategoryEnabled(asField, categories)) {
        const invalid = invalidParameterValue(asField);
        if (invalid !== null) {
          drafts.push({
            name: `${label} — path parameter ${parameter.name} = ${invalid.describe}`,
            category: "negative",
            mutation: {
              location: "request.path",
              operation: asField.enumValues !== undefined ? "set-invalid-enum" : "set-wrong-type",
              target: parameter.name,
              value: { kind: "text", text: invalid.value },
              description: `send path parameter ${parameter.name} as ${invalid.describe}`,
            },
            expected: expectInvalidInput(expectations),
            ruleId: "negative.path.invalid-value",
            operationId: operation.id,
            warning: undefined,
          });
        }
      }
      continue;
    }

    if (parameter.location === "query") {
      if (categories.missingRequiredFields && parameter.required) {
        drafts.push({
          name: `${label} — remove required query parameter ${parameter.name}`,
          category: "negative",
          mutation: {
            location: "request.query",
            operation: "remove",
            target: parameter.name,
            value: { kind: "none" },
            description: `remove required query parameter ${parameter.name}`,
          },
          expected: expectInvalidInput(expectations),
          ruleId: "negative.query.required-missing",
          operationId: operation.id,
          warning: undefined,
        });
      }

      if (parameterCategoryEnabled(asField, categories)) {
        const invalid = invalidParameterValue(asField);
        if (invalid !== null) {
          drafts.push({
            name: `${label} — query parameter ${parameter.name} = ${invalid.describe}`,
            category: "negative",
            mutation: {
              location: "request.query",
              operation: asField.enumValues !== undefined ? "set-invalid-enum" : "set-wrong-type",
              target: parameter.name,
              value: { kind: "text", text: invalid.value },
              description: `send query parameter ${parameter.name} as ${invalid.describe}`,
            },
            expected: expectInvalidInput(expectations),
            ruleId: "negative.query.invalid-value",
            operationId: operation.id,
            warning: undefined,
          });
        }
      }

      if (categories.emptyValues) {
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
          // An empty query value is only invalid when the contract says so.
          expected: asField.types.length > 0 && primaryType(asField) !== "string"
            ? expectInvalidInput(expectations)
            : expectValidInput(expectations),
          ruleId: "negative.query.empty",
          operationId: operation.id,
          warning: undefined,
        });
      }
      continue;
    }

    // --- Headers (spec §11) ---------------------------------------------
    if (parameter.location === "header" && categories.missingRequiredFields && parameter.required) {
      drafts.push({
        name: `${label} — remove required header ${parameter.name}`,
        category: "negative",
        mutation: {
          location: "request.header",
          operation: "remove",
          target: parameter.name,
          value: { kind: "none" },
          description: `remove required header ${parameter.name}`,
        },
        expected: expectInvalidInput(expectations),
        ruleId: "negative.header.required-missing",
        operationId: operation.id,
        warning: undefined,
      });
    }
  }

  // --- Unexpected content type (spec §11) --------------------------------
  if (categories.invalidContentType && input.hasBody) {
    drafts.push({
      name: `${label} — unexpected Content-Type`,
      category: "negative",
      mutation: {
        location: "request.header",
        operation: "set-content-type",
        target: "Content-Type",
        value: { kind: "text", text: UNEXPECTED_CONTENT_TYPE },
        description: `send Content-Type: ${UNEXPECTED_CONTENT_TYPE}`,
      },
      // 415 is the correct answer here and is not in the default invalid-input
      // list, so the class expectation carries it.
      expected: { ...expectInvalidInput(expectations), statusCodes: [400, 415, 422] },
      ruleId: "negative.header.unexpected-content-type",
      operationId: operation.id,
      warning: undefined,
    });
  }

  if (drafts.length > MAX_TESTS_PER_OPERATION) {
    warnings.push(
      `${label} produced ${drafts.length} candidate tests; only the first ${MAX_TESTS_PER_OPERATION} were kept so one large operation does not consume the whole budget.`,
    );
    return { drafts: drafts.slice(0, MAX_TESTS_PER_OPERATION), warnings };
  }

  return { drafts, warnings };
}

/**
 * Whether the selected categories cover the mutation this parameter would
 * receive. A parameter with an `enum` is mutated by the enum category; one
 * without is mutated by the invalid-type category. Conflating the two makes
 * a narrow selection produce broad output.
 */
function parameterCategoryEnabled(field: SchemaField, categories: GeneratorCategories): boolean {
  const hasEnum = field.enumValues !== undefined && field.enumValues.length > 0;
  return hasEnum ? categories.invalidEnums : categories.invalidTypes;
}

/** Adapts a contract parameter's schema into the field shape values.ts reads. */
function parameterAsField(parameter: ContractParameter): SchemaField {
  const schema = typeof parameter.schema === "object" && parameter.schema !== null ? (parameter.schema as Record<string, unknown>) : {};
  const rawType = schema["type"];

  return {
    pointer: `/${parameter.name}`,
    name: parameter.name,
    required: parameter.required,
    types: typeof rawType === "string" ? [rawType] : Array.isArray(rawType) ? rawType.filter((entry): entry is string => typeof entry === "string") : [],
    enumValues: Array.isArray(schema["enum"]) ? schema["enum"] : undefined,
    minimum: typeof schema["minimum"] === "number" ? schema["minimum"] : undefined,
    maximum: typeof schema["maximum"] === "number" ? schema["maximum"] : undefined,
    minLength: typeof schema["minLength"] === "number" ? schema["minLength"] : undefined,
    maxLength: typeof schema["maxLength"] === "number" ? schema["maxLength"] : undefined,
    format: typeof schema["format"] === "string" ? schema["format"] : undefined,
  };
}
