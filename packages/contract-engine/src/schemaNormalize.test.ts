import { describe, expect, it } from "vitest";
import { normalizeComponents, normalizeSchema } from "./schemaNormalize.ts";
import { validateAgainstSchema } from "./jsonSchemaValidate.ts";
import { MAX_SCHEMA_DEPTH } from "./limits.ts";

describe("normalizeSchema — OpenAPI 3.0 nullable (spec §11)", () => {
  it("translates nullable:true into a JSON Schema null type union", () => {
    const { schema } = normalizeSchema({ type: "string", nullable: true }, "3.0");
    expect(schema).toEqual({ type: ["string", "null"] });
  });

  it("makes null actually validate — the reason the translation exists", () => {
    // Without the translation the validator ignores `nullable` as an unknown
    // annotation and rejects null, producing a false contract violation on
    // every nullable field in every 3.0 document.
    const raw = { type: "string", nullable: true };
    expect(validateAgainstSchema(raw, undefined, null, "response.body")).not.toHaveLength(0);

    const { schema } = normalizeSchema(raw, "3.0");
    expect(validateAgainstSchema(schema!, undefined, null, "response.body")).toEqual([]);
    expect(validateAgainstSchema(schema!, undefined, "hello", "response.body")).toEqual([]);
    expect(validateAgainstSchema(schema!, undefined, 42, "response.body")).not.toHaveLength(0);
  });

  it("appends null to an existing type array without duplicating it", () => {
    expect(normalizeSchema({ type: ["string", "number"], nullable: true }, "3.0").schema).toEqual({
      type: ["string", "number", "null"],
    });
    expect(normalizeSchema({ type: ["string", "null"], nullable: true }, "3.0").schema).toEqual({
      type: ["string", "null"],
    });
  });

  it("treats nullable without a declared type as a no-op rather than inventing one", () => {
    // In 3.0 a schema with no `type` constrains nothing; turning it into
    // `type: ["null"]` would wrongly reject every non-null value.
    expect(normalizeSchema({ nullable: true }, "3.0").schema).toEqual({});
  });

  it("does NOT apply 3.0 nullable semantics to a 3.1 document", () => {
    // Spec §11: applying one version's rules to the other is the specific
    // mistake to avoid. In 3.1, `nullable` is not a keyword at all.
    const { schema } = normalizeSchema({ type: "string", nullable: true }, "3.1");
    expect(schema).toEqual({ type: "string" });
  });

  it("handles the 3.1 null union natively, with no translation needed", () => {
    const { schema } = normalizeSchema({ type: ["string", "null"] }, "3.1");
    expect(validateAgainstSchema(schema!, undefined, null, "response.body")).toEqual([]);
  });

  it("translates nullable inside nested properties and array items", () => {
    const { schema } = normalizeSchema(
      {
        type: "object",
        properties: {
          user: { type: "object", properties: { nickname: { type: "string", nullable: true } } },
          tags: { type: "array", items: { type: "string", nullable: true } },
        },
      },
      "3.0",
    );
    expect(validateAgainstSchema(schema!, undefined, { user: { nickname: null }, tags: [null, "a"] }, "response.body")).toEqual([]);
  });
});

describe("normalizeSchema — OpenAPI 3.0 boolean exclusive bounds", () => {
  it("rewrites the draft-4 boolean form into the 2020-12 numeric form", () => {
    expect(normalizeSchema({ type: "number", minimum: 5, exclusiveMinimum: true }, "3.0").schema).toEqual({
      type: "number",
      exclusiveMinimum: 5,
    });
    expect(normalizeSchema({ type: "number", maximum: 10, exclusiveMaximum: true }, "3.0").schema).toEqual({
      type: "number",
      exclusiveMaximum: 10,
    });
  });

  it("keeps the inclusive bound when the exclusive flag is false", () => {
    expect(normalizeSchema({ type: "number", minimum: 5, exclusiveMinimum: false }, "3.0").schema).toEqual({
      type: "number",
      minimum: 5,
    });
  });

  it("enforces the rewritten bound", () => {
    const { schema } = normalizeSchema({ type: "number", minimum: 0, exclusiveMinimum: true }, "3.0");
    expect(validateAgainstSchema(schema!, undefined, 0, "response.body")).not.toHaveLength(0);
    expect(validateAgainstSchema(schema!, undefined, 0.1, "response.body")).toEqual([]);
  });

  it("leaves a 3.1 numeric exclusiveMinimum untouched", () => {
    expect(normalizeSchema({ type: "number", exclusiveMinimum: 0 }, "3.1").schema).toEqual({
      type: "number",
      exclusiveMinimum: 0,
    });
  });
});

describe("normalizeSchema — pattern screening (spec §41)", () => {
  it("keeps a safe pattern", () => {
    const result = normalizeSchema({ type: "string", pattern: "^[a-z]+$" }, "3.1");
    expect(result.schema).toEqual({ type: "string", pattern: "^[a-z]+$" });
    expect(result.warnings).toEqual([]);
  });

  it("removes an unsafe pattern and warns instead of failing or hanging", () => {
    const result = normalizeSchema({ type: "string", pattern: "^(a+)+$" }, "3.1");
    expect(result.schema).toEqual({ type: "string" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Pattern validation skipped");
  });

  it("reports each distinct unsafe pattern once, however often it recurs", () => {
    const result = normalizeSchema(
      {
        type: "object",
        properties: {
          a: { type: "string", pattern: "^(a+)+$" },
          b: { type: "string", pattern: "^(a+)+$" },
        },
      },
      "3.1",
    );
    expect(result.warnings).toHaveLength(1);
  });

  it("screens patterns in both versions", () => {
    expect(normalizeSchema({ pattern: "^(a+)+$" }, "3.0").warnings).toHaveLength(1);
    expect(normalizeSchema({ pattern: "^(a+)+$" }, "3.1").warnings).toHaveLength(1);
  });
});

describe("normalizeSchema — structure and safety", () => {
  it("drops OpenAPI-only annotation keywords the validator would ignore", () => {
    const { schema } = normalizeSchema(
      { type: "string", example: "x", deprecated: true, xml: {}, discriminator: {}, readOnly: true },
      "3.0",
    );
    expect(schema).toEqual({ type: "string" });
  });

  it("preserves every composition keyword", () => {
    const source = {
      allOf: [{ type: "object" }],
      anyOf: [{ type: "string" }],
      oneOf: [{ type: "number" }],
      not: { type: "boolean" },
      if: { type: "string" },
      then: { minLength: 1 },
      else: { maximum: 3 },
    };
    expect(normalizeSchema(source, "3.1").schema).toEqual(source);
  });

  it("preserves boolean schemas", () => {
    expect(normalizeSchema({ type: "object", additionalProperties: false }, "3.1").schema).toEqual({
      type: "object",
      additionalProperties: false,
    });
    expect(normalizeSchema(true, "3.1").schema).toBe(true);
  });

  it("refuses to copy prototype-polluting keys out of an untrusted document", () => {
    const hostile = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"safe":{"type":"string"}}}') as unknown;
    const { schema } = normalizeSchema(hostile, "3.1");
    const properties = (schema as Record<string, Record<string, unknown>>).properties!;
    expect(Object.keys(properties)).toEqual(["safe"]);
    expect(({} as Record<string, unknown>).type).toBeUndefined();
  });

  it("stops walking at the depth limit and warns rather than overflowing the stack", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < MAX_SCHEMA_DEPTH + 20; i++) schema = { type: "object", properties: { next: schema } };
    const result = normalizeSchema(schema, "3.1");
    expect(result.warnings.some((warning) => warning.includes("nesting exceeded"))).toBe(true);
  });

  it("returns undefined for an absent schema", () => {
    expect(normalizeSchema(undefined, "3.0").schema).toBeUndefined();
    expect(normalizeSchema(null, "3.0").schema).toBeUndefined();
  });
});

describe("normalizeComponents", () => {
  it("normalizes schemas behind $ref exactly as it does inline ones", () => {
    const { components } = normalizeComponents(
      { schemas: { User: { type: "object", properties: { nickname: { type: "string", nullable: true } } } } },
      "3.0",
    );
    const user = (components!.schemas as Record<string, Record<string, unknown>>).User!;
    expect((user.properties as Record<string, unknown>).nickname).toEqual({ type: ["string", "null"] });
  });

  it("retains non-schema component sections verbatim so pointers still resolve", () => {
    const { components } = normalizeComponents(
      { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
      "3.0",
    );
    expect(components!.securitySchemes).toEqual({ bearerAuth: { type: "http", scheme: "bearer" } });
  });

  it("returns undefined when there are no components", () => {
    expect(normalizeComponents(undefined, "3.0").components).toBeUndefined();
  });
});
