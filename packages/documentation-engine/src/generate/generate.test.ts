import { describe, expect, it } from "vitest";
import type { CoverageReport, DriftReport } from "@api-lab/contract-engine";
import {
  OPENAPI_30_DOCUMENT,
  OPENAPI_31_DOCUMENT,
  OPENAPI_YAML_DOCUMENT,
  RECURSIVE_DOCUMENT,
  createCollectionRequest,
  createCollectionSource,
} from "../testFixtures.ts";
import type { DocEndpoint, Documentation } from "../types.ts";
import { generateDocumentation } from "./index.ts";

function generate(input: Partial<Parameters<typeof generateDocumentation>[0]> = {}): Documentation {
  const result = generateDocumentation({
    specificationSource: undefined,
    collection: undefined,
    grouping: "auto",
    includeCollectionExamples: true,
    coverage: undefined,
    drift: undefined,
    generatedAt: undefined,
    ...input,
  });
  if (!result.ok) throw new Error(result.detail);
  return result.documentation;
}

function allEndpoints(documentation: Documentation): DocEndpoint[] {
  return documentation.groups.flatMap((group) => group.endpoints);
}

function findEndpoint(documentation: Documentation, method: string, path: string): DocEndpoint {
  const endpoint = allEndpoints(documentation).find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  if (endpoint === undefined) throw new Error(`No endpoint ${method} ${path}`);
  return endpoint;
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

describe("generateDocumentation — inputs", () => {
  it("refuses when no source is supplied", () => {
    const result = generateDocumentation({
      specificationSource: undefined,
      collection: undefined,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    expect(result).toMatchObject({ ok: false, reason: "no-source" });
  });

  it("returns a typed failure for malformed source rather than throwing", () => {
    const result = generateDocumentation({
      specificationSource: "{ not json",
      collection: undefined,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-source" });
  });

  it("returns a typed failure for an unsupported OpenAPI version", () => {
    const result = generateDocumentation({
      specificationSource: JSON.stringify({ swagger: "2.0", info: { title: "Old" } }),
      collection: undefined,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI 3.0
// ---------------------------------------------------------------------------

describe("OpenAPI 3.0 documentation (spec §6)", () => {
  const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT });

  it("carries the API's identity from info", () => {
    expect(documentation.title).toBe("Orders API");
    expect(documentation.version).toBe("1.4.0");
    expect(documentation.description).toBe("Manages customer orders.");
    expect(documentation.metadata.openapiVersion).toBe("3.0.3");
  });

  it("documents servers with their descriptions", () => {
    expect(documentation.servers).toEqual([
      { url: "https://api.example.com/v1", description: "Production" },
    ]);
  });

  it("documents every operation, including less common methods (spec §9)", () => {
    const ids = allEndpoints(documentation).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(ids).toContain("GET /orders");
    expect(ids).toContain("POST /orders");
    expect(ids).toContain("DELETE /orders/{orderId}");
    // HEAD is exactly the method a generator is tempted to drop.
    expect(ids).toContain("HEAD /orders/{orderId}");
  });

  it("groups by declared tag order, not alphabetically (spec §28)", () => {
    expect(documentation.groups.map((group) => group.name)).toEqual(["Orders", "Customers"]);
    expect(documentation.groups[0]?.source).toBe("tag");
    expect(documentation.groups[0]?.description).toBe("Order lifecycle.");
  });

  it("documents parameters with type, requirement, default and example (spec §10)", () => {
    const endpoint = findEndpoint(documentation, "GET", "/orders");
    const status = endpoint.parameters.find((parameter) => parameter.name === "status");
    expect(status).toMatchObject({
      location: "query",
      required: false,
      type: "string",
      description: "Filter by order status.",
      defaultValue: "open",
      example: "shipped",
    });
    expect(status?.constraints).toContain("one of: open, shipped");

    const limit = endpoint.parameters.find((parameter) => parameter.name === "limit");
    expect(limit?.constraints).toEqual(expect.arrayContaining(["minimum: 1", "maximum: 100"]));
  });

  it("merges path-level parameters into every operation under the path", () => {
    const endpoint = findEndpoint(documentation, "DELETE", "/orders/{orderId}");
    const orderId = endpoint.parameters.find((parameter) => parameter.name === "orderId");
    expect(orderId).toMatchObject({ location: "path", required: true, description: "Order id." });
  });

  it("orders parameters path-first, then required, then alphabetically", () => {
    const endpoint = findEndpoint(documentation, "GET", "/orders");
    expect(endpoint.parameters.map((parameter) => parameter.name)).toEqual(["limit", "status"]);
  });

  it("documents the request body with content type and schema (spec §11)", () => {
    const endpoint = findEndpoint(documentation, "POST", "/orders");
    expect(endpoint.request?.required).toBe(true);
    expect(endpoint.request?.description).toBe("The order to create.");
    expect(endpoint.request?.content[0]?.contentType).toBe("application/json");
    expect(endpoint.request?.content[0]?.schema?.kind).toBe("object");
  });

  it("documents responses with description, headers and schema (spec §12)", () => {
    const endpoint = findEndpoint(documentation, "GET", "/orders");
    const ok = endpoint.responses.find((response) => response.status === "200");
    expect(ok?.description).toBe("A page of orders.");
    expect(ok?.headers[0]).toMatchObject({ name: "X-Total-Count", description: "Total orders." });
    expect(ok?.content[0]?.contentType).toBe("application/json");
  });

  it("orders responses success-first", () => {
    const endpoint = findEndpoint(documentation, "GET", "/orders");
    expect(endpoint.responses.map((response) => response.status)).toEqual(["200", "404"]);
  });

  it("marks a deprecated operation", () => {
    expect(findEndpoint(documentation, "DELETE", "/orders/{orderId}").deprecated).toBe(true);
    expect(findEndpoint(documentation, "GET", "/orders").deprecated).toBe(false);
  });

  it("documents declared examples (spec §11, §12)", () => {
    const endpoint = findEndpoint(documentation, "POST", "/orders");
    expect(endpoint.examples.some((example) => example.kind === "request")).toBe(true);

    const list = findEndpoint(documentation, "GET", "/orders");
    expect(list.examples.some((example) => example.kind === "response")).toBe(true);
  });

  it("documents named schemas, sorted (spec §13)", () => {
    expect(documentation.schemas.map((schema) => schema.name)).toEqual(["Customer", "Order"]);
    expect(documentation.metadata.schemaCount).toBe(2);
  });

  it("normalizes a 3.0 `nullable` into a readable union", () => {
    const order = documentation.schemas.find((schema) => schema.name === "Order");
    expect(order?.description.kind).toBe("object");
    if (order?.description.kind !== "object") return;
    const note = order.description.properties.find((property) => property.name === "note");
    // contract-engine normalizes 3.0 nullable to a 3.1 type array; this proves
    // the documentation reads the normalized model rather than the raw one.
    expect(JSON.stringify(note?.schema)).toContain("null");
  });

  it("labels everything as OpenAPI-derived", () => {
    for (const endpoint of allEndpoints(documentation)) {
      expect(endpoint.provenance).toBe("openapi");
    }
    expect(documentation.metadata.sources).toEqual(["openapi"]);
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe("authentication documentation (spec §15, §16)", () => {
  const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT });

  it("documents each declared security scheme", () => {
    expect(documentation.authentication.map((scheme) => scheme.name)).toEqual([
      "apiKeyAuth",
      "bearerAuth",
    ]);
  });

  it("describes a bearer scheme with a placeholder usage line, never a token", () => {
    const bearer = documentation.authentication.find((scheme) => scheme.name === "bearerAuth");
    expect(bearer).toMatchObject({ type: "http", scheme: "bearer" });
    expect(bearer?.usage).toBe("Authorization: Bearer {{token}}");
    expect(bearer?.description).toContain("Bearer format: JWT");
  });

  it("describes an apiKey scheme by header name, which is not a secret", () => {
    const apiKey = documentation.authentication.find((scheme) => scheme.name === "apiKeyAuth");
    expect(apiKey).toMatchObject({ type: "apiKey", location: "header", parameterName: "X-API-Key" });
    expect(apiKey?.usage).toBe("X-API-Key: {{apiKey}}");
  });

  it("applies document-level security to operations that declare none", () => {
    const endpoint = findEndpoint(documentation, "GET", "/orders");
    expect(endpoint.authentication.map((scheme) => scheme.name)).toEqual(["bearerAuth"]);
  });

  it("treats an operation's empty security array as public", () => {
    // The case implementations usually get wrong — an empty array overrides
    // the document level and means "no authentication".
    const endpoint = findEndpoint(documentation, "DELETE", "/orders/{orderId}");
    expect(endpoint.authentication).toEqual([]);
  });

  it("documents an OAuth2 scheme without claiming execution support", () => {
    const oauthDoc = generate({
      specificationSource: JSON.stringify({
        openapi: "3.0.0",
        info: { title: "OAuth API", version: "1.0" },
        paths: {},
        components: {
          securitySchemes: {
            oauth: {
              type: "oauth2",
              description: "Standard flow.",
              flows: { authorizationCode: { authorizationUrl: "https://a", tokenUrl: "https://t" } },
            },
          },
        },
      }),
    });
    const scheme = oauthDoc.authentication[0];
    expect(scheme?.type).toBe("oauth2");
    expect(scheme?.description).toContain("Flows: authorizationCode");
    expect(scheme?.description).toContain("does not perform OAuth2 token acquisition");
  });
});

// ---------------------------------------------------------------------------
// OpenAPI 3.1 and YAML
// ---------------------------------------------------------------------------

describe("OpenAPI 3.1 documentation (spec §6)", () => {
  const documentation = generate({ specificationSource: OPENAPI_31_DOCUMENT });

  it("reports the 3.1 version string", () => {
    expect(documentation.metadata.openapiVersion).toBe("3.1.0");
    expect(documentation.version).toBe("2.0.0");
  });

  it("documents a 3.1 nullable type array", () => {
    const order = documentation.schemas.find((schema) => schema.name === "Order");
    expect(order?.description.kind).toBe("object");
    if (order?.description.kind !== "object") return;
    const note = order.description.properties.find((property) => property.name === "note");
    expect(note?.schema).toMatchObject({ kind: "scalar", type: "string | null" });
  });
});

describe("YAML specifications", () => {
  it("generates from a YAML document through the shared safe parser", () => {
    const documentation = generate({ specificationSource: OPENAPI_YAML_DOCUMENT });
    expect(documentation.title).toBe("YAML API");
    expect(documentation.description).toBe("Defined in YAML.");
    expect(allEndpoints(documentation)).toHaveLength(1);
    expect(documentation.groups[0]?.name).toBe("Health");
  });
});

describe("recursive specifications end to end (spec §14)", () => {
  it("generates finite documentation", () => {
    const documentation = generate({ specificationSource: RECURSIVE_DOCUMENT });
    const serialized = JSON.stringify(documentation);
    expect(serialized.length).toBeLessThan(200_000);
    expect(serialized).toContain("see Node");
  });
});

// ---------------------------------------------------------------------------
// Collection-only
// ---------------------------------------------------------------------------

describe("collection-only documentation (spec §7)", () => {
  const collection = createCollectionSource([
    createCollectionRequest({
      id: "r1",
      name: "List orders",
      method: "GET",
      url: "https://api.example.com/v1/orders",
      queryParams: [{ name: "status", value: "open" }],
      headers: [{ name: "X-Tenant", value: "acme" }],
      folderName: "Orders",
    }),
    createCollectionRequest({
      id: "r2",
      name: "Create order",
      method: "POST",
      url: "{{baseUrl}}/orders",
      body: JSON.stringify({ total: 10 }),
      contentType: "application/json",
      folderName: "Orders",
      auth: { type: "bearer", location: undefined, parameterName: undefined },
    }),
    createCollectionRequest({
      id: "r3",
      name: "Get customer",
      method: "GET",
      url: "{{baseUrl}}/customers/{{customerId}}",
      folderName: "Customers",
    }),
  ]);

  const documentation = generate({ collection });

  it("uses the collection's identity", () => {
    expect(documentation.title).toBe("Orders Collection");
    expect(documentation.description).toBe("Saved requests for the Orders API.");
    expect(documentation.metadata.sources).toEqual(["collection"]);
  });

  it("labels every endpoint as collection-derived", () => {
    for (const endpoint of allEndpoints(documentation)) {
      expect(endpoint.provenance).toBe("collection");
    }
  });

  it("groups by folder when there are no tags (spec §28)", () => {
    expect(documentation.groups.map((group) => group.name)).toEqual(["Customers", "Orders"]);
    expect(documentation.groups[0]?.source).toBe("folder");
  });

  it("extracts paths, stripping a variable base URL", () => {
    const paths = allEndpoints(documentation).map((endpoint) => endpoint.path);
    // `{{baseUrl}}` is stripped because it is structurally a placeholder…
    expect(paths).toContain("/orders");
    expect(paths).toContain("/customers/{{customerId}}");
    // …but `/v1` is kept: with no specification, nothing says it is a base
    // path rather than part of the endpoint, and guessing would be invention.
    expect(paths).toContain("/v1/orders");
  });

  it("never claims a collection-derived parameter is required", () => {
    // The honesty constraint: a collection cannot know a field is required.
    const endpoint = findEndpoint(documentation, "GET", "/v1/orders");
    const query = endpoint.parameters.filter((parameter) => parameter.location === "query");
    expect(query.length).toBeGreaterThan(0);
    for (const parameter of query) {
      expect(parameter.required).toBe(false);
      expect(parameter.description).toContain("Not part of a contract");
    }
  });

  it("documents path variables as required, because the URL structurally needs them", () => {
    const endpoint = findEndpoint(documentation, "GET", "/customers/{{customerId}}");
    const pathParameter = endpoint.parameters.find((parameter) => parameter.location === "path");
    expect(pathParameter).toMatchObject({ name: "customerId", required: true });
  });

  it("omits headers that other sections already document", () => {
    const endpoint = findEndpoint(documentation, "POST", "/orders");
    expect(endpoint).toBeDefined();
    const names = endpoint.parameters.map((parameter) => parameter.name.toLowerCase());
    expect(names).not.toContain("content-type");
    expect(names).not.toContain("authorization");
  });

  it("invents no responses when none were recorded (spec §2)", () => {
    for (const endpoint of allEndpoints(documentation)) {
      expect(endpoint.responses).toEqual([]);
    }
  });

  it("invents no schemas", () => {
    expect(documentation.schemas).toEqual([]);
    expect(documentation.metadata.schemaCount).toBe(0);
  });

  it("documents only servers a request literally pointed at", () => {
    expect(documentation.servers.map((server) => server.url)).toEqual(["https://api.example.com"]);
  });

  it("describes collection auth without a credential field", () => {
    const endpoint = findEndpoint(documentation, "POST", "/orders");
    expect(endpoint.authentication[0]).toMatchObject({
      name: "bearer",
      usage: "Authorization: Bearer {{token}}",
      provenance: "collection",
    });
  });

  it("labels a mock-derived response as mock-derived (spec §19)", () => {
    const mockDocumentation = generate({
      collection: createCollectionSource([
        createCollectionRequest({
          url: "https://api.example.com/v1/orders",
          recordedResponses: [
            {
              status: 200,
              contentType: "application/json",
              headers: [],
              body: '{"ok":true}',
              origin: "mock",
            },
          ],
        }),
      ]),
    });
    const endpoint = allEndpoints(mockDocumentation)[0];
    expect(endpoint?.responses[0]?.provenance).toBe("mock");
    expect(endpoint?.responses[0]?.description).toContain("Not a response from the real API");
    expect(endpoint?.examples.find((example) => example.kind === "response")?.provenance).toBe("mock");
  });

  it("omits examples when the caller turns them off", () => {
    const without = generate({ collection, includeCollectionExamples: false });
    for (const endpoint of allEndpoints(without)) {
      expect(endpoint.examples).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

describe("combined documentation (spec §5)", () => {
  const collection = createCollectionSource([
    createCollectionRequest({
      id: "r1",
      name: "Collection name for list orders",
      method: "GET",
      url: "https://api.example.com/v1/orders",
    }),
    createCollectionRequest({
      id: "r2",
      name: "Create order",
      method: "POST",
      url: "https://api.example.com/v1/orders",
      body: JSON.stringify({ total: 99 }),
      contentType: "application/json",
    }),
    createCollectionRequest({
      id: "r3",
      name: "Undocumented endpoint",
      method: "GET",
      url: "https://api.example.com/v1/internal/metrics",
    }),
  ]);

  const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT, collection });

  it("records both sources", () => {
    expect(documentation.metadata.sources).toEqual(["openapi", "collection"]);
  });

  it("keeps the specification's identity", () => {
    expect(documentation.title).toBe("Orders API");
    expect(documentation.version).toBe("1.4.0");
  });

  it("does not let a collection request name overwrite a spec summary", () => {
    // The core precedence rule: the contract defines, the collection
    // illustrates.
    const endpoint = findEndpoint(documentation, "GET", "/orders");
    expect(endpoint.summary).toBe("List orders");
    expect(endpoint.summary).not.toBe("Collection name for list orders");
  });

  it("keeps contract-derived parameters authoritative", () => {
    const endpoint = findEndpoint(documentation, "GET", "/orders");
    for (const parameter of endpoint.parameters) {
      expect(parameter.provenance).toBe("openapi");
    }
  });

  it("adds collection examples alongside contract examples", () => {
    const endpoint = findEndpoint(documentation, "POST", "/orders");
    const provenances = endpoint.examples.map((example) => example.provenance);
    expect(provenances).toContain("openapi");
    expect(provenances).toContain("collection");
  });

  it("marks matched operations as aligned", () => {
    expect(findEndpoint(documentation, "GET", "/orders").contract).toMatchObject({
      inSpecification: true,
      inCollection: true,
      alignment: "aligned",
    });
  });

  it("marks spec operations with no saved request", () => {
    expect(findEndpoint(documentation, "GET", "/customers").contract).toMatchObject({
      inSpecification: true,
      inCollection: false,
      alignment: "missing-from-collection",
    });
  });

  it("keeps collection endpoints the spec does not document, clearly labelled", () => {
    // Dropping these would turn documentation generation into a way of hiding
    // drift.
    const group = documentation.groups.find((entry) => entry.name === "Not in specification");
    expect(group).toBeDefined();
    expect(group?.endpoints.map((endpoint) => endpoint.path)).toEqual(["/internal/metrics"]);
    expect(group?.endpoints[0]?.contract).toMatchObject({
      inSpecification: false,
      alignment: "missing-from-spec",
    });
  });

  it("matches paths across differing template conventions", () => {
    const combined = generate({
      specificationSource: OPENAPI_30_DOCUMENT,
      collection: createCollectionSource([
        createCollectionRequest({
          method: "DELETE",
          // `{{orderId}}` here, `{orderId}` in the spec.
          url: "https://api.example.com/v1/orders/{{orderId}}",
        }),
      ]),
    });
    expect(findEndpoint(combined, "DELETE", "/orders/{orderId}").contract?.alignment).toBe("aligned");
  });
});

// ---------------------------------------------------------------------------
// Coverage and drift
// ---------------------------------------------------------------------------

describe("coverage and drift metadata (spec §21, §22)", () => {
  const coverage: CoverageReport = {
    totalOperations: 6,
    coveredOperations: 3,
    operationCoveragePercent: 50,
    validatedOperations: 2,
    validationCoveragePercent: 33.3,
    uncovered: [{ method: "GET", path: "/customers" }],
  };

  const drift: DriftReport = {
    entries: [
      {
        kind: "matched",
        severity: "warning",
        method: "GET",
        path: "/orders",
        operationId: "listOrders",
        requestId: "r1",
        requestName: "List orders",
        reason: "Matched.",
      },
      {
        kind: "missing-from-spec",
        severity: "error",
        method: "GET",
        path: "/internal/metrics",
        operationId: undefined,
        requestId: "r3",
        requestName: "Metrics",
        reason: "Not documented in the specification.",
      },
    ],
    matched: 1,
    missingFromSpec: 1,
    missingFromCollection: 4,
    mismatched: 0,
  };

  it("carries coverage figures through", () => {
    const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT, coverage });
    expect(documentation.coverage).toEqual({
      totalOperations: 6,
      coveredOperations: 3,
      operationCoveragePercent: 50,
      validatedOperations: 2,
      validationCoveragePercent: 33.3,
    });
  });

  it("drops the uncovered working list, which is not documentation", () => {
    const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT, coverage });
    expect(JSON.stringify(documentation.coverage)).not.toContain("uncovered");
  });

  it("carries drift counts and non-matched entries", () => {
    const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT, drift });
    expect(documentation.drift?.matched).toBe(1);
    expect(documentation.drift?.missingFromSpec).toBe(1);
    // Matched entries are counted, not listed — a drift table of things that
    // are fine is noise.
    expect(documentation.drift?.entries).toHaveLength(1);
    expect(documentation.drift?.entries[0]).toMatchObject({
      method: "GET",
      path: "/internal/metrics",
      alignment: "missing-from-spec",
    });
  });

  it("leaves both undefined when not supplied", () => {
    const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT });
    expect(documentation.coverage).toBeUndefined();
    expect(documentation.drift).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Grouping modes
// ---------------------------------------------------------------------------

describe("grouping modes (spec §28)", () => {
  it("`none` puts everything in one group", () => {
    const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT, grouping: "none" });
    expect(documentation.groups).toHaveLength(1);
    expect(documentation.groups[0]?.name).toBe("Endpoints");
  });

  it("`auto` prefers tags when an OpenAPI source contributed", () => {
    const documentation = generate({ specificationSource: OPENAPI_30_DOCUMENT, grouping: "auto" });
    expect(documentation.groups.every((group) => group.source === "tag")).toBe(true);
  });

  it("`auto` falls back to folders for a collection-only source", () => {
    const documentation = generate({
      collection: createCollectionSource([createCollectionRequest({ folderName: "Admin" })]),
      grouping: "auto",
    });
    expect(documentation.groups[0]).toMatchObject({ name: "Admin", source: "folder" });
  });

  it("puts untagged operations in an Other group", () => {
    const documentation = generate({
      specificationSource: JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Mixed", version: "1" },
        paths: {
          "/a": { get: { tags: ["Tagged"], responses: {} } },
          "/b": { get: { responses: {} } },
        },
      }),
    });
    expect(documentation.groups.map((group) => group.name)).toEqual(["Tagged", "Other"]);
  });
});

// ---------------------------------------------------------------------------
// Determinism and limits
// ---------------------------------------------------------------------------

describe("determinism (spec §33)", () => {
  it("produces an identical model across runs", () => {
    const a = generate({ specificationSource: OPENAPI_30_DOCUMENT });
    const b = generate({ specificationSource: OPENAPI_30_DOCUMENT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("omits a timestamp unless one is explicitly requested", () => {
    expect(generate({ specificationSource: OPENAPI_30_DOCUMENT }).metadata.generatedAt).toBeUndefined();
    expect(
      generate({ specificationSource: OPENAPI_30_DOCUMENT, generatedAt: "2026-01-01T00:00:00.000Z" })
        .metadata.generatedAt,
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is stable for a combined source too", () => {
    const collection = createCollectionSource([
      createCollectionRequest({ url: "https://api.example.com/v1/orders" }),
    ]);
    const a = generate({ specificationSource: OPENAPI_30_DOCUMENT, collection });
    const b = generate({ specificationSource: OPENAPI_30_DOCUMENT, collection });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("large specifications (spec §35)", () => {
  it("truncates a huge collection and states that it did", () => {
    const requests = Array.from({ length: 1_200 }, (_, index) =>
      createCollectionRequest({ id: `r${index}`, url: `https://api.example.com/v1/item${index}` }),
    );
    const documentation = generate({ collection: createCollectionSource(requests) });
    expect(documentation.metadata.endpointCount).toBe(1_000);
    expect(documentation.metadata.warnings.join(" ")).toContain("only the first 1000");
  });

  it("carries contract-engine's own parse warnings through", () => {
    // A specification with gaps must not produce documentation whose gaps look
    // like the API's own.
    const documentation = generate({
      specificationSource: JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Odd", version: "1" },
        paths: { "/a": { get: { parameters: [{ name: "x", in: "nowhere" }], responses: {} } } },
      }),
    });
    expect(documentation.metadata.warnings.join(" ")).toContain("unsupported location");
  });
});
