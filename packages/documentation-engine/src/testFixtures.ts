import type { DocCollectionRequest, DocCollectionSource } from "./source/collectionSource.ts";

/**
 * Shared fixtures for the documentation-engine test suites.
 *
 * Kept in `src/` rather than a `__fixtures__` directory to match the
 * convention `contract-engine/src/testFixtures.ts` and
 * `security-engine/src/testFixtures.ts` already set.
 *
 * ## The canary credentials
 *
 * `CANARY_*` are deliberately distinctive, self-identifying strings. They
 * exist so `secretCanary.test.ts` can drive real-looking credentials through
 * the whole pipeline and assert that not one character of them reaches any
 * rendered output (spec §34). A generic value like "secret" would produce a
 * test that passes by coincidence the moment some unrelated prose contains
 * the word; these cannot collide with anything.
 */

export const CANARY_BEARER_TOKEN = "CANARY-BEARER-9f83ba21c0d74e5aa1b2c3d4e5f60718";
export const CANARY_API_KEY = "CANARY-APIKEY-4d5e6f708192a3b4c5d6e7f809102132";
export const CANARY_PASSWORD = "CANARY-PASSWORD-abcdef0123456789";
export const CANARY_COOKIE = "CANARY-COOKIE-session=fedcba9876543210";

/** Every canary in one list, for exhaustive "appears nowhere" assertions. */
export const ALL_CANARIES = [
  CANARY_BEARER_TOKEN,
  CANARY_API_KEY,
  CANARY_PASSWORD,
  CANARY_COOKIE,
];

/** The XSS probe used by the HTML-injection tests (spec §39). */
export const XSS_PAYLOAD = '<script>alert(1)</script>';

/** A payload aimed specifically at breaking out of a `<script>` element. */
export const SCRIPT_BREAKOUT_PAYLOAD = '</script><img src=x onerror=alert(1)>';

// ---------------------------------------------------------------------------
// OpenAPI documents
// ---------------------------------------------------------------------------

/** A small but complete OpenAPI 3.0 document exercising most of §6-§15. */
export const OPENAPI_30_DOCUMENT = JSON.stringify({
  openapi: "3.0.3",
  info: {
    title: "Orders API",
    description: "Manages customer orders.",
    version: "1.4.0",
  },
  servers: [{ url: "https://api.example.com/v1", description: "Production" }],
  tags: [
    { name: "Orders", description: "Order lifecycle." },
    { name: "Customers", description: "Customer records." },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    "/orders": {
      get: {
        tags: ["Orders"],
        operationId: "listOrders",
        summary: "List orders",
        description: "Returns a page of orders.",
        parameters: [
          {
            name: "status",
            in: "query",
            description: "Filter by order status.",
            required: false,
            schema: { type: "string", enum: ["open", "shipped"], default: "open" },
            example: "shipped",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": {
            description: "A page of orders.",
            headers: { "X-Total-Count": { description: "Total orders.", schema: { type: "integer" } } },
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Order" } },
                example: [{ id: "o-1", total: 25.5 }],
              },
            },
          },
          "404": { description: "Not found." },
        },
      },
      post: {
        tags: ["Orders"],
        operationId: "createOrder",
        summary: "Create an order",
        requestBody: {
          required: true,
          description: "The order to create.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Order" },
              example: { total: 25.5 },
            },
          },
        },
        responses: { "201": { description: "Created." } },
      },
    },
    "/orders/{orderId}": {
      parameters: [
        { name: "orderId", in: "path", required: true, description: "Order id.", schema: { type: "string" } },
      ],
      delete: {
        tags: ["Orders"],
        operationId: "deleteOrder",
        summary: "Delete an order",
        deprecated: true,
        security: [],
        responses: { "204": { description: "Deleted." } },
      },
      head: {
        tags: ["Orders"],
        summary: "Check an order exists",
        responses: { "200": { description: "Exists." } },
      },
    },
    "/customers": {
      get: {
        tags: ["Customers"],
        summary: "List customers",
        responses: {
          "200": {
            description: "Customers.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "A signed JWT." },
      apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "A tenant key." },
    },
    schemas: {
      Order: {
        type: "object",
        required: ["id", "total"],
        properties: {
          id: { type: "string", description: "Order identifier." },
          total: { type: "number", format: "double", minimum: 0 },
          note: { type: "string", nullable: true },
          customer: { $ref: "#/components/schemas/Customer" },
        },
      },
      Customer: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          // The circular case spec §14 requires handling.
          manager: { $ref: "#/components/schemas/Customer" },
        },
      },
    },
  },
});

/** The same shape in OpenAPI 3.1, using 3.1's nullability and no `nullable`. */
export const OPENAPI_31_DOCUMENT = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Orders API", description: "Manages customer orders.", version: "2.0.0" },
  servers: [{ url: "https://api.example.com/v2" }],
  paths: {
    "/orders": {
      get: {
        tags: ["Orders"],
        summary: "List orders",
        responses: {
          "200": {
            description: "Orders.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Order: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          // 3.1's way of saying nullable.
          note: { type: ["string", "null"] },
        },
      },
    },
  },
});

/** A YAML document, for the YAML-ingestion path (spec §6). */
export const OPENAPI_YAML_DOCUMENT = `openapi: 3.0.0
info:
  title: YAML API
  version: 1.0.0
  description: Defined in YAML.
paths:
  /ping:
    get:
      summary: Ping
      tags: [Health]
      responses:
        "200":
          description: Pong.
`;

/** A deliberately self-referencing document for the recursion tests (§14). */
export const RECURSIVE_DOCUMENT = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Tree API", version: "1.0.0" },
  paths: {
    "/nodes": {
      get: {
        summary: "List nodes",
        responses: {
          "200": {
            description: "Nodes.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Node: {
        type: "object",
        properties: {
          id: { type: "string" },
          parent: { $ref: "#/components/schemas/Node" },
          children: { type: "array", items: { $ref: "#/components/schemas/Node" } },
        },
      },
      User: {
        type: "object",
        properties: { manager: { $ref: "#/components/schemas/Manager" } },
      },
      Manager: {
        type: "object",
        properties: { reports: { type: "array", items: { $ref: "#/components/schemas/User" } } },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export function createCollectionRequest(
  overrides: Partial<DocCollectionRequest> = {},
): DocCollectionRequest {
  return {
    id: "req-1",
    name: "List orders",
    description: undefined,
    method: "GET",
    url: "https://api.example.com/v1/orders",
    folderName: undefined,
    headers: [],
    queryParams: [],
    body: undefined,
    contentType: undefined,
    auth: { type: "none", location: undefined, parameterName: undefined },
    recordedResponses: [],
    ...overrides,
  };
}

export function createCollectionSource(
  requests: DocCollectionRequest[] = [createCollectionRequest()],
  overrides: Partial<DocCollectionSource> = {},
): DocCollectionSource {
  return {
    name: "Orders Collection",
    description: "Saved requests for the Orders API.",
    requests,
    ...overrides,
  };
}

/** A collection whose every field carries a canary credential (spec §34). */
export function createCanaryCollection(): DocCollectionSource {
  return createCollectionSource([
    createCollectionRequest({
      id: "req-canary",
      name: "Create order",
      method: "POST",
      url: `https://api.example.com/v1/orders?api_key=${CANARY_API_KEY}`,
      headers: [
        { name: "Authorization", value: `Bearer ${CANARY_BEARER_TOKEN}` },
        { name: "Cookie", value: CANARY_COOKIE },
        { name: "X-API-Key", value: CANARY_API_KEY },
        { name: "Content-Type", value: "application/json" },
      ],
      queryParams: [{ name: "api_key", value: CANARY_API_KEY }],
      body: JSON.stringify({ total: 25.5, password: CANARY_PASSWORD, access_token: CANARY_BEARER_TOKEN }),
      contentType: "application/json",
      auth: { type: "bearer", location: undefined, parameterName: undefined },
      recordedResponses: [
        {
          status: 201,
          contentType: "application/json",
          headers: [{ name: "Set-Cookie", value: CANARY_COOKIE }],
          body: JSON.stringify({ id: "o-1", refresh_token: CANARY_BEARER_TOKEN }),
          origin: "collection",
        },
      ],
    }),
  ]);
}
