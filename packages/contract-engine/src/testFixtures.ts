/**
 * Shared specification fixtures for the contract-engine test suite.
 *
 * Spec §11 and §49 both require dedicated OpenAPI 3.0 *and* 3.1 fixtures
 * rather than one document assumed to behave identically under both. The two
 * documents below describe the same API and differ only where the versions
 * genuinely differ — `nullable: true` versus a `["string", "null"]` type
 * union — so any test can be run against both and the difference in outcome
 * is attributable to the version handling and nothing else.
 */

/** OpenAPI 3.0.3. Uses `nullable: true` and draft-4 boolean exclusive bounds. */
export const SPEC_30 = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Users API 3.0" },
  servers: [{ url: "http://localhost:4010/api" }],
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "status", in: "query", required: true, schema: { type: "string", enum: ["active", "banned"] } },
        ],
        responses: {
          "200": {
            description: "OK",
            headers: {
              "X-Request-ID": { required: true, schema: { type: "string" } },
            },
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["users"],
                  properties: {
                    users: { type: "array", items: { $ref: "#/components/schemas/User" } },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          "400": { description: "Bad request" },
        },
      },
      post: {
        operationId: "createUser",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" }, age: { type: "integer" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
          },
        },
      },
    },
    "/users/list": {
      get: {
        operationId: "usersListLiteral",
        responses: { "200": { description: "OK" } },
      },
    },
    "/users/{id}": {
      get: {
        operationId: "getUser",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
          },
          "404": { description: "Not found" },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          // The 3.0 way of saying "or null".
          nickname: { type: "string", nullable: true },
          score: { type: "number", minimum: 0, exclusiveMinimum: true },
          profile: {
            type: "object",
            properties: { email: { type: "string", format: "email" } },
          },
        },
      },
    },
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
  },
});

/** OpenAPI 3.1.0 — the same API expressed with JSON Schema 2020-12 constructs. */
export const SPEC_31 = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Users API 3.1" },
  servers: [{ url: "http://localhost:4010/api" }],
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        parameters: [
          { name: "status", in: "query", required: true, schema: { type: "string", enum: ["active", "banned"] } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["users"],
                  properties: { users: { type: "array", items: { $ref: "#/components/schemas/User" } } },
                },
              },
            },
          },
        },
      },
    },
    "/users/{id}": {
      get: {
        operationId: "getUser",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          // The 3.1 / JSON Schema 2020-12 way of saying "or null".
          nickname: { type: ["string", "null"] },
          score: { type: "number", exclusiveMinimum: 0 },
        },
      },
    },
  },
});

/** The same 3.0 document expressed as YAML, for the YAML ingestion tests. */
export const SPEC_30_YAML = `
openapi: "3.0.3"
info:
  title: YAML Users API
servers:
  - url: http://localhost:4010/api
paths:
  /users/{id}:
    get:
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [id, name]
                properties:
                  id:
                    type: integer
                  name:
                    type: string
`;
