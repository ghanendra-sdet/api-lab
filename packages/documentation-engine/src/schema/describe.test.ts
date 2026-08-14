import { describe, expect, it } from "vitest";
import { buildContractModel, parseSpecSource } from "@api-lab/contract-engine";
import { MAX_SCHEMA_PROPERTIES } from "../limits.ts";
import { RECURSIVE_DOCUMENT } from "../testFixtures.ts";
import {
  collectNamedSchemas,
  describeSchema,
  resolveRef,
  schemaTypeLabel,
  type SchemaResolutionContext,
} from "./describe.ts";

const EMPTY: SchemaResolutionContext = { components: undefined };

function contextFor(source: string): SchemaResolutionContext {
  const parsed = parseSpecSource(source);
  if (!parsed.ok) throw new Error(parsed.detail);
  const built = buildContractModel(parsed.raw);
  if (!built.ok) throw new Error(built.detail);
  return { components: built.contract.components };
}

describe("describeSchema — scalars", () => {
  it("describes a plain string", () => {
    const result = describeSchema({ type: "string" }, EMPTY);
    expect(result).toMatchObject({ kind: "scalar", type: "string" });
  });

  it("carries format, enum and constraints", () => {
    const result = describeSchema(
      { type: "integer", format: "int64", minimum: 1, maximum: 10, enum: [1, 2] },
      EMPTY,
    );
    expect(result.kind).toBe("scalar");
    if (result.kind !== "scalar") return;
    expect(result.format).toBe("int64");
    expect(result.constraints).toContain("minimum: 1");
    expect(result.constraints).toContain("maximum: 10");
    expect(result.enumValues).toEqual(["1", "2"]);
  });

  it("renders a 3.1 nullable type union as a readable string", () => {
    const result = describeSchema({ type: ["string", "null"] }, EMPTY);
    expect(result).toMatchObject({ kind: "scalar", type: "string | null" });
  });

  it("prints a pattern without ever compiling it", () => {
    // A hostile pattern is safe to *print*. Only execution is dangerous, and
    // this package never executes one.
    const evil = "^(a+)+$";
    const result = describeSchema({ type: "string", pattern: evil }, EMPTY);
    expect(result.kind).toBe("scalar");
    if (result.kind !== "scalar") return;
    expect(result.constraints).toContain(`pattern: ${evil}`);
  });

  it("handles boolean schemas", () => {
    expect(describeSchema(true, EMPTY)).toMatchObject({ kind: "unknown" });
    expect(describeSchema(false, EMPTY)).toMatchObject({ kind: "unknown" });
  });

  it("handles an absent schema", () => {
    expect(describeSchema(undefined, EMPTY)).toMatchObject({ kind: "unknown" });
  });
});

describe("describeSchema — objects and arrays", () => {
  it("marks required properties and sorts them first", () => {
    const result = describeSchema(
      {
        type: "object",
        required: ["id"],
        properties: { zeta: { type: "string" }, id: { type: "string" }, alpha: { type: "string" } },
      },
      EMPTY,
    );
    expect(result.kind).toBe("object");
    if (result.kind !== "object") return;
    expect(result.properties.map((p) => p.name)).toEqual(["id", "alpha", "zeta"]);
    expect(result.properties[0]?.required).toBe(true);
    expect(result.properties[1]?.required).toBe(false);
  });

  it("describes arrays through to their item type", () => {
    const result = describeSchema({ type: "array", items: { type: "string" } }, EMPTY);
    expect(result.kind).toBe("array");
    expect(schemaTypeLabel(result)).toBe("array of string");
  });

  it("describes combinators without collapsing them", () => {
    const result = describeSchema(
      { oneOf: [{ type: "string" }, { type: "integer" }] },
      EMPTY,
    );
    expect(result).toMatchObject({ kind: "union", combinator: "oneOf" });
    expect(schemaTypeLabel(result)).toBe("string | integer");
  });

  it("caps and reports an enormous property list", () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < MAX_SCHEMA_PROPERTIES + 50; i += 1) {
      properties[`p${String(i).padStart(4, "0")}`] = { type: "string" };
    }
    const result = describeSchema({ type: "object", properties }, EMPTY);
    expect(result.kind).toBe("object");
    if (result.kind !== "object") return;
    expect(result.properties).toHaveLength(MAX_SCHEMA_PROPERTIES);
    // The omission is stated, never silent.
    expect(result.truncated).toBe(true);
  });
});

describe("resolveRef", () => {
  const context = contextFor(RECURSIVE_DOCUMENT);

  it("resolves an internal component pointer", () => {
    expect(resolveRef("#/components/schemas/Node", context)?.name).toBe("Node");
  });

  it("refuses external pointers", () => {
    // Resolving these would mean fetching an attacker-controlled URL during
    // documentation generation.
    expect(resolveRef("https://evil.example.com/schema.json", context)).toBeUndefined();
    expect(resolveRef("./common.yaml#/User", context)).toBeUndefined();
  });

  it("returns undefined for a pointer that does not exist", () => {
    expect(resolveRef("#/components/schemas/Missing", context)).toBeUndefined();
  });

  it("decodes RFC 6901 escapes in the right order", () => {
    const escaped: SchemaResolutionContext = {
      components: { schemas: { "a/b": { type: "string" } } },
    };
    expect(resolveRef("#/components/schemas/a~1b", escaped)?.name).toBe("a/b");
  });
});

describe("describeSchema — recursion (spec §14)", () => {
  const context = contextFor(RECURSIVE_DOCUMENT);

  it("terminates on a directly self-referencing schema", () => {
    const result = describeSchema(
      { $ref: "#/components/schemas/Node" },
      context,
      undefined,
      new Set(["#/components/schemas/Node"]),
    );
    expect(result).toMatchObject({ kind: "reference", name: "Node", note: "see Node" });
  });

  it("terminates on a mutually recursive User → Manager → User cycle", () => {
    // The exact example spec §14 names.
    const { schemas } = collectNamedSchemas(context, 50);
    const user = schemas.find((schema) => schema.name === "User");
    expect(user).toBeDefined();

    const manager = user?.description.kind === "object" ? user.description.properties[0] : undefined;
    expect(manager?.name).toBe("manager");

    // Manager expands, and its `reports` array terminates back at User.
    expect(manager?.schema.kind).toBe("object");
    if (manager?.schema.kind !== "object") return;
    const reports = manager.schema.properties.find((property) => property.name === "reports");
    expect(reports?.schema.kind).toBe("array");
    if (reports?.schema.kind !== "array") return;
    expect(reports.schema.items).toMatchObject({ kind: "reference", name: "User", note: "see User" });
  });

  it("produces finite output for a recursive document, in bounded time", () => {
    // The regression this pins: an unguarded walk here never returns.
    const started = Date.now();
    const { schemas } = collectNamedSchemas(context, 50);
    const serialized = JSON.stringify(schemas);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(serialized.length).toBeLessThan(200_000);
    expect(serialized).toContain("see Node");
  });

  it("expands sibling reuse rather than collapsing it", () => {
    // Two uses of the same schema side by side are not a cycle, and collapsing
    // them would make most fields unexplained cross-references.
    const context2: SchemaResolutionContext = {
      components: { schemas: { Address: { type: "object", properties: { city: { type: "string" } } } } },
    };
    const result = describeSchema(
      {
        type: "object",
        properties: {
          home: { $ref: "#/components/schemas/Address" },
          work: { $ref: "#/components/schemas/Address" },
        },
      },
      context2,
    );
    expect(result.kind).toBe("object");
    if (result.kind !== "object") return;
    // Both expand to real objects, neither is a bare reference.
    expect(result.properties.map((p) => p.schema.kind)).toEqual(["object", "object"]);
  });

  it("stops at the depth cap for a deep but non-circular schema", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 40; i += 1) {
      schema = { type: "object", properties: { child: schema } };
    }
    const result = describeSchema(schema, EMPTY);
    expect(JSON.stringify(result)).toContain("not expanded");
  });

  it("labels an unresolvable reference rather than dropping it", () => {
    const result = describeSchema({ $ref: "#/components/schemas/Missing" }, context);
    expect(result).toMatchObject({ kind: "reference", name: "Missing" });
    expect(JSON.stringify(result)).toContain("not resolvable");
  });
});

describe("collectNamedSchemas", () => {
  const context = contextFor(RECURSIVE_DOCUMENT);

  it("returns schemas sorted by name, for determinism", () => {
    const { schemas } = collectNamedSchemas(context, 50);
    expect(schemas.map((schema) => schema.name)).toEqual(["Manager", "Node", "User"]);
  });

  it("caps and reports", () => {
    const { schemas, truncated } = collectNamedSchemas(context, 2);
    expect(schemas).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it("returns nothing for a document with no components", () => {
    expect(collectNamedSchemas(EMPTY, 50)).toEqual({ schemas: [], truncated: false });
  });
});
