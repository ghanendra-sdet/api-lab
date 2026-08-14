import { describe, expect, it } from "vitest";
import { collectSchemaFields } from "./schemaFields.ts";
import { boundaryCases, emptyValue, invalidEnumValue, invalidParameterValue, primaryType, wrongTypeValue } from "./values.ts";
import { generateFromContract } from "./fromContract.ts";
import { generateAuthTests } from "./auth.ts";
import { generateHeuristic } from "./heuristic.ts";
import { generateNegativeTests } from "./index.ts";
import { createDefaultGenerationExpectations } from "./expectations.ts";
import { makeOperation, makePathOperation, makeRequest } from "../testFixtures.ts";
import { createDefaultGeneratorCategories, type GeneratorCategories } from "../types.ts";
import { MAX_GENERATED_TESTS, MAX_MUTATED_STRING_LENGTH } from "../limits.ts";
import { INVALID_ENUM_VALUE } from "../credentials.ts";

const ALL_CATEGORIES: GeneratorCategories = {
  missingRequiredFields: true,
  invalidTypes: true,
  nullValues: true,
  emptyValues: true,
  boundaryValues: true,
  invalidEnums: true,
  malformedJson: true,
  invalidContentType: true,
  missingAuthentication: true,
  invalidAuthentication: true,
};

const NONE: GeneratorCategories = {
  missingRequiredFields: false,
  invalidTypes: false,
  nullValues: false,
  emptyValues: false,
  boundaryValues: false,
  invalidEnums: false,
  malformedJson: false,
  invalidContentType: false,
  missingAuthentication: false,
  invalidAuthentication: false,
};

// ---------------------------------------------------------------------------
// Schema field collection
// ---------------------------------------------------------------------------

describe("collectSchemaFields", () => {
  it("reads required flags, types, bounds and enums from the schema", () => {
    const schema = makeOperation().requestBody!.content[0]!.schema!;
    const { fields } = collectSchemaFields(schema, undefined);

    const name = fields.find((field) => field.name === "name")!;
    expect(name.required).toBe(true);
    expect(name.types).toEqual(["string"]);
    expect(name.minLength).toBe(2);
    expect(name.maxLength).toBe(50);

    const role = fields.find((field) => field.name === "role")!;
    expect(role.required).toBe(false);
    expect(role.enumValues).toEqual(["admin", "user"]);

    const nickname = fields.find((field) => field.name === "nickname")!;
    expect(nickname.types).toEqual(["string", "null"]);
  });

  it("resolves a local $ref through components", () => {
    const schema = { $ref: "#/components/schemas/User" };
    const components = {
      schemas: { User: { type: "object", required: ["id"], properties: { id: { type: "integer" } } } },
    };
    const { fields } = collectSchemaFields(schema, components);
    expect(fields.map((field) => field.name)).toEqual(["id"]);
    expect(fields[0]!.required).toBe(true);
  });

  it("terminates on a recursive $ref", () => {
    const schema = { $ref: "#/components/schemas/Node" };
    const components = {
      schemas: {
        Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" }, name: { type: "string" } } },
      },
    };
    expect(() => collectSchemaFields(schema, components)).not.toThrow();
  });

  it("does not follow an external $ref", () => {
    // Resolving one would mean fetching a URL that came out of an imported
    // document — an SSRF primitive handed to whoever wrote the spec.
    const { fields, warnings } = collectSchemaFields({ $ref: "https://evil.example.com/schema.json" }, undefined);
    expect(fields).toHaveLength(0);
    expect(warnings.join(" ")).toContain("could not be resolved");
  });

  it("warns rather than descending into anyOf/oneOf", () => {
    const { warnings } = collectSchemaFields({ oneOf: [{ type: "object" }] }, undefined);
    expect(warnings.join(" ")).toContain("anyOf/oneOf");
  });

  it("merges allOf branches", () => {
    const schema = {
      allOf: [
        { type: "object", required: ["a"], properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "integer" } } },
      ],
    };
    const { fields } = collectSchemaFields(schema, undefined);
    expect(fields.map((field) => field.name).sort()).toEqual(["a", "b"]);
  });

  it("skips __proto__ property names", () => {
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"ok":{"type":"string"}}}') as never;
    const { fields } = collectSchemaFields(schema, undefined);
    expect(fields.map((field) => field.name)).toEqual(["ok"]);
  });
});

// ---------------------------------------------------------------------------
// Value synthesis
// ---------------------------------------------------------------------------

describe("value synthesis", () => {
  it("ignores an accompanying null type when picking the primary type", () => {
    expect(primaryType({ types: ["string", "null"] })).toBe("string");
  });

  it("produces a value of a different type", () => {
    expect(wrongTypeValue({ types: ["integer"] })!.value).toBe("invalid");
    expect(wrongTypeValue({ types: ["string"] })!.value).toBe(12345);
  });

  it("produces no wrong-type value for an untyped field", () => {
    // Generating one would assert a rejection the contract never promised.
    expect(wrongTypeValue({ types: [] })).toBeNull();
  });

  it("produces the empty form of the field's own type", () => {
    expect(emptyValue({ types: ["string"] })!.value).toBe("");
    expect(emptyValue({ types: ["array"] })!.value).toEqual([]);
    expect(emptyValue({ types: ["object"] })!.value).toEqual({});
  });

  it("has no notion of empty for a number or boolean", () => {
    // `0` and `false` are ordinary values, not empty ones.
    expect(emptyValue({ types: ["integer"] })).toBeNull();
    expect(emptyValue({ types: ["boolean"] })).toBeNull();
  });

  it("produces a single fixed out-of-range enum token", () => {
    expect(invalidEnumValue({ types: ["string"], enumValues: ["a", "b"] })!.value).toBe(INVALID_ENUM_VALUE);
  });

  it("produces a numeric out-of-range value for a numeric enum", () => {
    // A string here would be caught by the type check first, and the test
    // would no longer be an enum test.
    expect(invalidEnumValue({ types: ["integer"], enumValues: [1, 2, 3] })!.value).toBe(4);
  });

  it("produces no enum value when there is no enum", () => {
    expect(invalidEnumValue({ types: ["string"], enumValues: undefined })).toBeNull();
  });

  it("derives numeric boundary cases with correct polarity", () => {
    const cases = boundaryCases({
      pointer: "/age", name: "age", required: true, types: ["integer"],
      enumValues: undefined, minimum: 18, maximum: 120, minLength: undefined, maxLength: undefined, format: undefined,
    });
    const labels = cases.map((entry) => `${entry.label}:${entry.expectValid}`);
    expect(labels).toContain("minimum - 1 (17):false");
    expect(labels).toContain("minimum (18):true");
    expect(labels).toContain("maximum (120):true");
    expect(labels).toContain("maximum + 1 (121):false");
  });

  it("derives string length boundary cases", () => {
    const cases = boundaryCases({
      pointer: "/name", name: "name", required: true, types: ["string"],
      enumValues: undefined, minimum: undefined, maximum: undefined, minLength: 2, maxLength: 5, format: undefined,
    });
    const maxPlus = cases.find((entry) => entry.label.startsWith("maxLength + 1"))!;
    expect(String(maxPlus.value)).toHaveLength(6);
    expect(maxPlus.expectValid).toBe(false);
  });

  it("clamps an absurd declared length and warns", () => {
    // A document declaring maxLength: 50000000 must not build a 50 MB body.
    const cases = boundaryCases({
      pointer: "/x", name: "x", required: false, types: ["string"],
      enumValues: undefined, minimum: undefined, maximum: undefined, minLength: undefined, maxLength: 50_000_000, format: undefined,
    });
    const maxPlus = cases.find((entry) => entry.label.startsWith("maxLength + 1"))!;
    expect(String(maxPlus.value).length).toBe(MAX_MUTATED_STRING_LENGTH);
    expect(maxPlus.warning).toContain("clamped");
  });

  it("produces no boundary cases for an unbounded field", () => {
    const cases = boundaryCases({
      pointer: "/x", name: "x", required: false, types: ["string"],
      enumValues: undefined, minimum: undefined, maximum: undefined, minLength: undefined, maxLength: undefined, format: undefined,
    });
    expect(cases).toHaveLength(0);
  });

  it("produces invalid parameter values by declared type and format", () => {
    expect(invalidParameterValue({ types: ["integer"], format: undefined, enumValues: undefined })!.value).toBe("abc");
    expect(invalidParameterValue({ types: ["string"], format: "uuid", enumValues: undefined })!.value).toBe("invalid-id");
    expect(invalidParameterValue({ types: ["string"], format: undefined, enumValues: ["a"] })!.value).toBe(INVALID_ENUM_VALUE);
  });

  it("produces no invalid value for a free-form string parameter", () => {
    // Anything is a valid string; only a format or enum makes one possible.
    expect(invalidParameterValue({ types: ["string"], format: undefined, enumValues: undefined })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Contract generation (spec §20)
// ---------------------------------------------------------------------------

describe("generateFromContract", () => {
  const base = { operation: makeOperation(), components: undefined, expectations: createDefaultGenerationExpectations(), hasAuth: true, hasBody: true };

  it("generates a removal test only for required fields", () => {
    const { drafts } = generateFromContract({ ...base, categories: { ...NONE, missingRequiredFields: true } });
    const targets = drafts.filter((draft) => draft.ruleId === "negative.body.required-missing").map((draft) => draft.mutation.target);
    expect(targets.sort()).toEqual(["/age", "/name"]);
  });

  it("expects a 4xx for an invalid-input mutation", () => {
    const { drafts } = generateFromContract({ ...base, categories: { ...NONE, missingRequiredFields: true } });
    expect(drafts[0]!.expected.statusCodes).toEqual([400, 422]);
    expect(drafts[0]!.expected.statusClasses).toEqual(["4xx"]);
  });

  it("does not generate a null mutation for a nullable field", () => {
    // The contract says null is valid, so asserting a rejection would assert
    // the opposite of what was documented.
    const { drafts } = generateFromContract({ ...base, categories: { ...NONE, nullValues: true } });
    const targets = drafts.map((draft) => draft.mutation.target);
    expect(targets).toContain("/name");
    expect(targets).not.toContain("/nickname");
  });

  it("generates boundary tests with inverted expectations for legal values", () => {
    const { drafts } = generateFromContract({ ...base, categories: { ...NONE, boundaryValues: true } });
    const onBoundary = drafts.find((draft) => draft.mutation.description.includes("minimum (18)"))!;
    const belowBoundary = drafts.find((draft) => draft.mutation.description.includes("minimum - 1"))!;

    expect(onBoundary.expected.statusClasses).toEqual(["2xx"]);
    expect(belowBoundary.expected.statusClasses).toEqual(["4xx"]);
  });

  it("generates an enum test for an enum field only", () => {
    const { drafts } = generateFromContract({ ...base, categories: { ...NONE, invalidEnums: true } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.mutation.target).toBe("/role");
  });

  it("generates a required query parameter removal", () => {
    const { drafts } = generateFromContract({ ...base, categories: { ...NONE, missingRequiredFields: true } });
    expect(drafts.some((draft) => draft.ruleId === "negative.query.required-missing" && draft.mutation.target === "tenant")).toBe(true);
  });

  it("generates a path parameter mutation for a typed path parameter", () => {
    const { drafts } = generateFromContract({
      ...base,
      operation: makePathOperation(),
      categories: { ...NONE, invalidTypes: true },
    });
    const pathDraft = drafts.find((draft) => draft.mutation.location === "request.path")!;
    expect(pathDraft.mutation.target).toBe("id");
    expect(pathDraft.mutation.value).toEqual({ kind: "text", text: "abc" });
  });

  it("expects 415 among the acceptable statuses for an unexpected content type", () => {
    const { drafts } = generateFromContract({ ...base, categories: { ...NONE, invalidContentType: true } });
    expect(drafts[0]!.expected.statusCodes).toContain(415);
  });

  it("generates nothing when no categories are selected", () => {
    expect(generateFromContract({ ...base, categories: NONE }).drafts).toHaveLength(0);
  });

  it("tags every draft with the operation id", () => {
    const { drafts } = generateFromContract({ ...base, categories: ALL_CATEGORIES });
    expect(drafts.every((draft) => draft.operationId === "POST /users")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Authentication generation (spec §12)
// ---------------------------------------------------------------------------

describe("generateAuthTests", () => {
  const bearer = { kind: "header", name: "Authorization", scheme: "bearer" } as const;
  const expectations = createDefaultGenerationExpectations();

  it("generates a missing-credential test categorised as security", () => {
    const { drafts } = generateAuthTests({
      auth: bearer, categories: { ...NONE, missingAuthentication: true }, expectations, label: "GET /x", operationId: undefined,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.category).toBe("security");
    expect(drafts[0]!.expected.statusCodes).toEqual([401, 403]);
  });

  it("accepts both 401 and 403 by default", () => {
    // Hardcoding 401 would generate false failures on conforming APIs.
    const { drafts } = generateAuthTests({
      auth: bearer, categories: { ...NONE, missingAuthentication: true }, expectations, label: "x", operationId: undefined,
    });
    expect(drafts[0]!.expected.statusCodes).toContain(403);
  });

  it("generates invalid, expired and malformed token tests for bearer auth", () => {
    const { drafts } = generateAuthTests({
      auth: bearer, categories: { ...NONE, invalidAuthentication: true }, expectations, label: "x", operationId: undefined,
    });
    expect(drafts.map((draft) => draft.ruleId).sort()).toEqual([
      "security.auth.expired-token",
      "security.auth.invalid-token",
      "security.auth.malformed-token",
    ]);
  });

  it("does not generate an expired-JWT test for basic auth", () => {
    // There is no expiry to violate.
    const { drafts } = generateAuthTests({
      auth: { kind: "header", name: "Authorization", scheme: "basic" },
      categories: { ...NONE, invalidAuthentication: true }, expectations, label: "x", operationId: undefined,
    });
    expect(drafts.map((draft) => draft.ruleId)).not.toContain("security.auth.expired-token");
  });

  it("generates a wrong-API-key test for a query-string credential", () => {
    const { drafts } = generateAuthTests({
      auth: { kind: "query", name: "api_key" },
      categories: { ...NONE, invalidAuthentication: true }, expectations, label: "x", operationId: undefined,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.ruleId).toBe("security.auth.wrong-api-key");
  });

  it("warns instead of generating when the request has no credential", () => {
    const { drafts, warnings } = generateAuthTests({
      auth: { kind: "none" }, categories: { ...NONE, missingAuthentication: true }, expectations, label: "GET /x", operationId: undefined,
    });
    expect(drafts).toHaveLength(0);
    expect(warnings.join(" ")).toContain("no authentication configured");
  });
});

// ---------------------------------------------------------------------------
// Heuristic generation (spec §27)
// ---------------------------------------------------------------------------

describe("generateHeuristic", () => {
  const expectations = createDefaultGenerationExpectations();

  it("generates wrong-type and null tests from the observed body", () => {
    const { drafts } = generateHeuristic({
      request: makeRequest(), categories: { ...NONE, invalidTypes: true, nullValues: true }, expectations, label: "Create user",
    });
    expect(drafts.some((draft) => draft.ruleId === "negative.body.wrong-type")).toBe(true);
    expect(drafts.some((draft) => draft.ruleId === "negative.body.null")).toBe(true);
  });

  it("refuses to guess required fields and says why", () => {
    // A body shows which fields are present, never which are mandatory.
    const { drafts, warnings } = generateHeuristic({
      request: makeRequest(), categories: { ...NONE, missingRequiredFields: true }, expectations, label: "Create user",
    });
    expect(drafts).toHaveLength(0);
    expect(warnings.join(" ")).toContain("cannot say which of its fields are mandatory");
  });

  it("refuses to guess bounds and enums", () => {
    const { warnings } = generateHeuristic({
      request: makeRequest(), categories: { ...NONE, boundaryValues: true, invalidEnums: true }, expectations, label: "x",
    });
    expect(warnings.join(" ")).toContain("bounds are only knowable from a schema");
    expect(warnings.join(" ")).toContain("permitted values are only knowable");
  });

  it("warns when the body is not JSON", () => {
    const { warnings } = generateHeuristic({
      request: makeRequest({ body: "not json" }), categories: { ...NONE, invalidTypes: true }, expectations, label: "x",
    });
    expect(warnings.join(" ")).toContain("not valid JSON");
  });
});

// ---------------------------------------------------------------------------
// Entry point (spec §28, §29)
// ---------------------------------------------------------------------------

describe("generateNegativeTests", () => {
  function target(overrides = {}) {
    return {
      requestId: "req-1",
      requestName: "Create user",
      request: makeRequest(),
      operation: makeOperation(),
      components: undefined,
      ...overrides,
    };
  }

  it("assigns unique ids and marks contract-sourced tests", () => {
    const result = generateNegativeTests({ targets: [target()], categories: ALL_CATEGORIES });
    expect(new Set(result.tests.map((test) => test.id)).size).toBe(result.tests.length);
    expect(result.tests.every((test) => test.metadata.source === "contract")).toBe(true);
  });

  it("marks tests as heuristic when no operation matched", () => {
    const result = generateNegativeTests({ targets: [target({ operation: undefined })], categories: ALL_CATEGORIES });
    expect(result.tests.every((test) => test.metadata.source === "heuristic")).toBe(true);
  });

  it("never embeds a credential in a generated definition", () => {
    // Spec §33: definitions are credential-free by construction.
    const result = generateNegativeTests({ targets: [target()], categories: ALL_CATEGORIES });
    expect(JSON.stringify(result.tests)).not.toContain("real-secret-token-value");
  });

  it("enables every generated test but sends nothing", () => {
    // Generation and execution are separate by design (spec §28).
    const result = generateNegativeTests({ targets: [target()], categories: ALL_CATEGORIES });
    expect(result.tests.every((test) => test.enabled)).toBe(true);
  });

  it("clamps to MAX_GENERATED_TESTS and reports the truncation", () => {
    const targets = Array.from({ length: 60 }, (_, i) => target({ requestId: `req-${i}` }));
    const result = generateNegativeTests({ targets, categories: ALL_CATEGORIES });

    expect(result.tests.length).toBeLessThanOrEqual(MAX_GENERATED_TESTS);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).toContain(`${MAX_GENERATED_TESTS}-test limit`);
  });

  it("de-duplicates warnings", () => {
    const targets = [target({ operation: undefined }), target({ requestId: "req-2", operation: undefined })];
    const result = generateNegativeTests({ targets, categories: { ...NONE, boundaryValues: true } });
    expect(new Set(result.warnings).size).toBe(result.warnings.length);
  });

  it("generates nothing from default categories against a request with no body or auth", () => {
    const request = makeRequest({ body: undefined, auth: { kind: "none" }, method: "GET" });
    const result = generateNegativeTests({
      targets: [target({ request, operation: undefined })],
      categories: createDefaultGeneratorCategories(),
    });
    expect(result.tests).toHaveLength(0);
  });
});
