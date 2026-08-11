import { describe, expect, it } from "vitest";
import { isAssertedFormat, pointerToJsonPath, validateAgainstSchema } from "./jsonSchemaValidate.ts";
import type { ContractViolation, JsonSchema } from "./types.ts";

function check(schema: JsonSchema, instance: unknown): ContractViolation[] {
  return validateAgainstSchema(schema, undefined, instance, "response.body");
}

function paths(violations: ContractViolation[]): string[] {
  return violations.map((violation) => violation.path);
}

describe("pointerToJsonPath", () => {
  it("renders the root", () => {
    expect(pointerToJsonPath("#")).toBe("$");
  });

  it("renders nested object properties", () => {
    expect(pointerToJsonPath("#/data/user/profile/email")).toBe("$.data.user.profile.email");
  });

  it("renders array indices in brackets (spec §17)", () => {
    expect(pointerToJsonPath("#/users/2/id")).toBe("$.users[2].id");
  });

  it("bracket-quotes keys that are not plain identifiers", () => {
    expect(pointerToJsonPath("#/content-type")).toBe('$["content-type"]');
  });

  it("decodes JSON pointer escapes", () => {
    expect(pointerToJsonPath("#/a~1b")).toBe('$["a/b"]');
    expect(pointerToJsonPath("#/a~0b")).toBe('$["a~b"]');
  });
});

describe("type validation (spec §13)", () => {
  const schema = { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } };

  it("passes a conforming object", () => {
    expect(check(schema, { id: 123, name: "Test User" })).toEqual([]);
  });

  it("reports the precise path, expected and actual for a wrong type", () => {
    // Spec §13's worked example: {id: "123"} against {id: integer}.
    const violations = check(schema, { id: "123", name: "Test User" });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      location: "response.body",
      path: "$.id",
      keyword: "type",
      expected: "integer",
      actual: "string",
      severity: "error",
    });
  });

  it("distinguishes integer from number", () => {
    expect(check({ type: "integer" }, 1.5)).toHaveLength(1);
    expect(check({ type: "number" }, 1.5)).toEqual([]);
  });
});

describe("required properties (spec §15)", () => {
  it("names the missing property and points at its path", () => {
    const violations = check({ type: "object", required: ["id", "name"] }, { id: 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      path: "$.name",
      keyword: "required",
      expected: "present (required)",
      actual: "(absent)",
      message: "Missing required property: name",
    });
  });

  it("reports every missing property, not only the first (spec §16)", () => {
    const violations = check({ type: "object", required: ["a", "b", "c"] }, {});
    expect(paths(violations).sort()).toEqual(["$.a", "$.b", "$.c"]);
  });

  it("reports a nested missing property at its full path", () => {
    const violations = check(
      {
        type: "object",
        properties: { data: { type: "object", properties: { user: { type: "object", required: ["email"] } } } },
      },
      { data: { user: {} } },
    );
    expect(paths(violations)).toEqual(["$.data.user.email"]);
  });
});

describe("additionalProperties (spec §14)", () => {
  it("reports an undocumented property when additionalProperties is false", () => {
    const violations = check(
      { type: "object", properties: { id: { type: "integer" } }, additionalProperties: false },
      { id: 1, debug: true },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      path: "$.debug",
      keyword: "additionalProperties",
      expected: "no additional properties",
    });
    expect(violations[0]!.message).toContain('"debug"');
  });

  it("permits extra properties when the contract allows them", () => {
    // Spec §14: additional fields must NOT be universally rejected.
    expect(check({ type: "object", properties: { id: { type: "integer" } } }, { id: 1, debug: true })).toEqual([]);
    expect(
      check({ type: "object", properties: { id: { type: "integer" } }, additionalProperties: true }, { id: 1, x: 2 }),
    ).toEqual([]);
  });

  it("does not claim a documented property is undocumented when it fails its own schema", () => {
    // Regression: the validator reports `additionalProperties` against any
    // property that did not successfully match `properties`, including
    // documented ones that merely failed validation. Reporting that verbatim
    // told the user their documented `users` field was undocumented.
    const violations = check(
      {
        type: "object",
        properties: { users: { type: "array", items: { type: "object", properties: { id: { type: "integer" } } } } },
        additionalProperties: false,
      },
      { users: [{ id: 1 }, { id: "x" }] },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ path: "$.users[1].id", keyword: "type" });
  });

  it("still reports a genuinely undocumented property alongside other failures", () => {
    const violations = check(
      { type: "object", properties: { id: { type: "integer" } }, additionalProperties: false },
      { id: "wrong", debug: true },
    );
    expect(violations).toHaveLength(2);
    expect(paths(violations).sort()).toEqual(["$.debug", "$.id"]);
  });

  it("validates additional properties against a schema when one is given", () => {
    const schema = { type: "object", additionalProperties: { type: "string" } };
    expect(check(schema, { a: "x" })).toEqual([]);
    expect(check(schema, { a: 1 })).toHaveLength(1);
  });
});

describe("nested structures (spec §16)", () => {
  it("identifies the complete path to a deeply nested failure", () => {
    const violations = check(
      {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              user: { type: "object", properties: { profile: { type: "object", properties: { email: { type: "string" } } } } },
            },
          },
        },
      },
      { data: { user: { profile: { email: 42 } } } },
    );
    expect(paths(violations)).toEqual(["$.data.user.profile.email"]);
  });

  it("returns multiple violations across different branches in one result", () => {
    const violations = check(
      {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "integer" }, c: { type: "boolean" } },
      },
      { a: 1, b: "x", c: "y" },
    );
    expect(paths(violations).sort()).toEqual(["$.a", "$.b", "$.c"]);
  });
});

describe("arrays (spec §17)", () => {
  it("identifies the failing element precisely", () => {
    const violations = check(
      { type: "object", properties: { users: { type: "array", items: { type: "object", properties: { id: { type: "integer" } } } } } },
      { users: [{ id: 1 }, { id: 2 }, { id: "three" }] },
    );
    expect(paths(violations)).toEqual(["$.users[2].id"]);
  });

  it("enforces minItems, maxItems and uniqueItems", () => {
    const schema = { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 3, uniqueItems: true };
    expect(check(schema, [1, 2])).toEqual([]);
    expect(check(schema, [1])[0]).toMatchObject({ keyword: "minItems", expected: "2" });
    expect(check(schema, [1, 2, 3, 4])[0]).toMatchObject({ keyword: "maxItems" });
    expect(check(schema, [1, 1])[0]).toMatchObject({ keyword: "uniqueItems" });
  });
});

describe("enums, const and bounds", () => {
  it("reports an enum mismatch with the permitted values", () => {
    const violations = check({ type: "string", enum: ["active", "banned"] }, "root");
    expect(violations[0]).toMatchObject({ keyword: "enum" });
    expect(violations[0]!.expected).toContain("active");
  });

  it("enforces const", () => {
    expect(check({ const: 5 }, 5)).toEqual([]);
    expect(check({ const: 5 }, 6)[0]).toMatchObject({ keyword: "const", expected: "5" });
  });

  it("enforces numeric and string bounds", () => {
    expect(check({ type: "integer", minimum: 1 }, 0)[0]).toMatchObject({ keyword: "minimum", expected: "1" });
    expect(check({ type: "integer", maximum: 10 }, 11)[0]).toMatchObject({ keyword: "maximum" });
    expect(check({ type: "string", minLength: 2 }, "a")[0]).toMatchObject({ keyword: "minLength" });
    expect(check({ type: "string", maxLength: 2 }, "abc")[0]).toMatchObject({ keyword: "maxLength" });
    expect(check({ type: "string", pattern: "^[a-z]+$" }, "ABC")[0]).toMatchObject({ keyword: "pattern" });
    expect(check({ type: "number", multipleOf: 5 }, 7)[0]).toMatchObject({ keyword: "multipleOf" });
  });
});

describe("composition keywords", () => {
  it("evaluates oneOf, reporting at the composed level rather than per branch", () => {
    const schema = { oneOf: [{ type: "string" }, { type: "number" }] };
    expect(check(schema, "a")).toEqual([]);
    const violations = check(schema, true);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ keyword: "oneOf", path: "$" });
  });

  it("evaluates anyOf", () => {
    const schema = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(check(schema, 1)).toEqual([]);
    expect(check(schema, true)).toHaveLength(1);
  });

  it("evaluates allOf", () => {
    const schema = { allOf: [{ type: "object", required: ["a"] }, { type: "object", required: ["b"] }] };
    expect(check(schema, { a: 1, b: 2 })).toEqual([]);
    expect(paths(check(schema, { a: 1 }))).toEqual(["$.b"]);
  });

  it("evaluates not", () => {
    expect(check({ not: { type: "string" } }, 1)).toEqual([]);
    expect(check({ not: { type: "string" } }, "a")).toHaveLength(1);
  });
});

describe("$ref resolution", () => {
  it("resolves a components pointer through the assembled validation root", () => {
    const components = { schemas: { User: { type: "object", required: ["id"], properties: { id: { type: "integer" } } } } };
    const schema = { type: "object", properties: { user: { $ref: "#/components/schemas/User" } } };

    expect(validateAgainstSchema(schema, components, { user: { id: 1 } }, "response.body")).toEqual([]);
    const violations = validateAgainstSchema(schema, components, { user: { id: "x" } }, "response.body");
    expect(paths(violations)).toEqual(["$.user.id"]);
  });

  it("degrades to a warning rather than throwing on an unresolvable $ref", () => {
    const violations = validateAgainstSchema({ $ref: "#/components/schemas/Missing" }, undefined, {}, "response.body");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("warning");
  });
});

describe("format assertion surface (spec §10, §23)", () => {
  it("knows which formats the validator actually asserts", () => {
    expect(isAssertedFormat("email")).toBe(true);
    expect(isAssertedFormat("uuid")).toBe(true);
    expect(isAssertedFormat("date-time")).toBe(true);
    // OpenAPI's own numeric formats are NOT asserted by the validator.
    expect(isAssertedFormat("int32")).toBe(false);
    expect(isAssertedFormat("binary")).toBe(false);
    expect(isAssertedFormat("date")).toBe(false);
  });

  it("enforces the formats it does assert", () => {
    expect(check({ type: "string", format: "email" }, "not-an-email")).toHaveLength(1);
    expect(check({ type: "string", format: "email" }, "a@b.co")).toEqual([]);
    expect(check({ type: "string", format: "uuid" }, "nope")).toHaveLength(1);
  });
});

describe("boolean schemas", () => {
  it("accepts everything under `true` and nothing under `false`", () => {
    expect(check(true, { anything: 1 })).toEqual([]);
    expect(check(false, 1)).toHaveLength(1);
  });
});
