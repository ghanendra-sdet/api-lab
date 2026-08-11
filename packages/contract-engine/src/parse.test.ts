import { describe, expect, it } from "vitest";
import { detectSourceFormat, parseContract, parseSpecSource } from "./parse.ts";
import { MAX_OPERATIONS, MAX_SPEC_FILE_SIZE_BYTES } from "./limits.ts";
import { SPEC_30, SPEC_30_YAML, SPEC_31 } from "./testFixtures.ts";

function mustParse(text: string) {
  const result = parseContract(text);
  if (!result.ok) throw new Error(`expected a parseable contract, got: ${result.detail}`);
  return result.contract;
}

describe("parseContract — OpenAPI 3.0", () => {
  it("builds a contract model with operations, parameters, and responses", () => {
    const contract = mustParse(SPEC_30);

    expect(contract.title).toBe("Users API 3.0");
    expect(contract.version).toBe("3.0");
    expect(contract.openapiVersionString).toBe("3.0.3");
    expect(contract.servers).toEqual(["http://localhost:4010/api"]);
    expect(contract.operations.map((operation) => operation.id).sort()).toEqual([
      "GET /users",
      "GET /users/list",
      "GET /users/{id}",
      "POST /users",
    ]);
  });

  it("marks path parameters required even when the document omits the flag", () => {
    const contract = mustParse(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: { "/a/{id}": { get: { parameters: [{ name: "id", in: "path", schema: { type: "string" } }], responses: {} } } },
      }),
    );
    expect(contract.operations[0]!.parameters[0]!.required).toBe(true);
  });

  it("merges path-level parameters into each operation, letting the operation win", () => {
    const contract = mustParse(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: {
          "/a": {
            parameters: [
              { name: "shared", in: "query", schema: { type: "string" } },
              { name: "override", in: "query", required: false, schema: { type: "string" } },
            ],
            get: {
              parameters: [{ name: "override", in: "query", required: true, schema: { type: "integer" } }],
              responses: {},
            },
          },
        },
      }),
    );

    const parameters = contract.operations[0]!.parameters;
    expect(parameters).toHaveLength(2);
    expect(parameters.find((p) => p.name === "shared")?.required).toBe(false);
    const override = parameters.find((p) => p.name === "override")!;
    expect(override.required).toBe(true);
    expect(override.schema).toMatchObject({ type: "integer" });
  });

  it("captures declared response headers and content types", () => {
    const contract = mustParse(SPEC_30);
    const listUsers = contract.operations.find((operation) => operation.id === "GET /users")!;
    const ok = listUsers.responses.find((response) => response.statusKey === "200")!;

    expect(ok.headers).toEqual([{ name: "X-Request-ID", required: true, schema: { type: "string" } }]);
    expect(ok.content.map((entry) => entry.contentType)).toEqual(["application/json"]);
  });

  it("retains components so $ref pointers still resolve", () => {
    const contract = mustParse(SPEC_30);
    expect(contract.components?.schemas).toHaveProperty("User");
  });

  it("reads security schemes", () => {
    const contract = mustParse(SPEC_30);
    expect(contract.securitySchemes).toEqual([
      { name: "bearerAuth", type: "http", scheme: "bearer", location: undefined, parameterName: undefined },
    ]);
  });
});

describe("parseContract — OpenAPI 3.1", () => {
  it("parses a 3.1 document and records the version distinctly", () => {
    const contract = mustParse(SPEC_31);
    expect(contract.version).toBe("3.1");
    expect(contract.openapiVersionString).toBe("3.1.0");
    expect(contract.operations).toHaveLength(2);
  });
});

describe("parseContract — invalid and unsupported documents", () => {
  it("rejects a document that is not JSON or YAML at all", () => {
    const result = parseContract("{ this is not json");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("invalid-syntax");
  });

  it("rejects a structurally valid document that is not OpenAPI", () => {
    const result = parseContract(JSON.stringify({ hello: "world" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("unrecognized");
  });

  it("rejects Swagger 2.0 by version rather than misreading it", () => {
    const result = parseContract(JSON.stringify({ swagger: "2.0", info: { title: "old" }, paths: {} }));
    expect(result.ok).toBe(false);
    // No `openapi` field at all, so it fails the structural gate first.
    expect(result.ok === false && result.reason).toBe("unrecognized");
  });

  it("rejects an unsupported OpenAPI major version explicitly", () => {
    const result = parseContract(JSON.stringify({ openapi: "4.0.0", info: { title: "future" }, paths: {} }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("unsupported-version");
    expect(result.ok === false && result.detail).toContain("3.0.x and 3.1.x");
  });

  it("rejects a specification over the size limit before parsing it", () => {
    const oversized = `{"openapi":"3.0.0","padding":"${"x".repeat(MAX_SPEC_FILE_SIZE_BYTES)}"}`;
    const result = parseContract(oversized);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("too-large");
  });

  it("skips a malformed operation with a warning instead of failing the whole document", () => {
    const contract = mustParse(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: {
          "/good": { get: { responses: { "200": { description: "OK" } } } },
          "/bad": { get: { parameters: "not-an-array" } },
        },
      }),
    );
    expect(contract.operations.map((operation) => operation.id)).toEqual(["GET /good"]);
    expect(contract.warnings.some((warning) => warning.includes("GET /bad"))).toBe(true);
  });

  it("ignores non-method keys in a path item", () => {
    const contract = mustParse(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: { "/a": { summary: "ignored", description: "ignored", get: { responses: {} } } },
      }),
    );
    expect(contract.operations).toHaveLength(1);
  });

  it("truncates a document declaring more operations than the limit", () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OPERATIONS + 10; i++) paths[`/p${i}`] = { get: { responses: {} } };
    const contract = mustParse(JSON.stringify({ openapi: "3.0.3", info: { title: "t" }, paths }));

    expect(contract.operations).toHaveLength(MAX_OPERATIONS);
    expect(contract.warnings.some((warning) => warning.includes("only the first"))).toBe(true);
  });

  it("never throws on a deeply nested document", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 400; i++) schema = { type: "object", properties: { next: schema } };
    const result = parseContract(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: { "/a": { get: { responses: { "200": { description: "d", content: { "application/json": { schema } } } } } } },
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseSpecSource — YAML support (spec §43)", () => {
  it("detects the source format from the text", () => {
    expect(detectSourceFormat(SPEC_30)).toBe("json");
    expect(detectSourceFormat(SPEC_30_YAML)).toBe("yaml");
  });

  it("parses a YAML specification into the same contract model shape", () => {
    const contract = mustParse(SPEC_30_YAML);
    expect(contract.title).toBe("YAML Users API");
    expect(contract.version).toBe("3.0");
    expect(contract.operations.map((operation) => operation.id)).toEqual(["GET /users/{id}"]);
    expect(contract.operations[0]!.parameters[0]).toMatchObject({ name: "id", location: "path", required: true });
  });

  it("reports malformed YAML as a typed failure rather than throwing", () => {
    const result = parseContract("openapi: '3.0.0'\n  bad indentation: [");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("invalid-syntax");
  });

  it("rejects an empty specification", () => {
    const result = parseSpecSource("\n\n");
    expect(result.ok).toBe(false);
  });

  it("does not execute or instantiate anything from a YAML document", () => {
    // js-yaml's historical `load` would honour custom tags here. The `yaml`
    // package's parse does not — the tagged value is not turned into a
    // function or a constructed object.
    const result = parseSpecSource("openapi: '3.0.3'\ninfo:\n  title: !!js/function 'function(){return 1}'\n");
    if (result.ok) {
      const info = (result.raw as { info?: { title?: unknown } }).info;
      expect(typeof info?.title).not.toBe("function");
    } else {
      // Refusing the unknown tag outright is an equally acceptable outcome.
      expect(result.detail).toContain("YAML");
    }
  });
});
