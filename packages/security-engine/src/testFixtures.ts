import type { ContractOperation } from "@api-lab/contract-engine";
import { createDefaultExpectedBehavior, type NegativeTest, type SecurityRequestInput, type SecurityResponseInput } from "./types.ts";

/**
 * Shared fixtures for the security-engine unit tests.
 *
 * Kept in `src` rather than a `__fixtures__` directory to match
 * contract-engine's existing `testFixtures.ts` convention.
 */

export function makeRequest(overrides: Partial<SecurityRequestInput> = {}): SecurityRequestInput {
  return {
    method: "POST",
    url: "http://localhost:4010/users",
    headers: [
      { name: "Content-Type", value: "application/json" },
      { name: "Authorization", value: "Bearer real-secret-token-value" },
    ],
    query: [],
    body: JSON.stringify({ name: "Ada", age: 36, role: "admin" }),
    contentType: "application/json",
    pathTemplate: undefined,
    auth: { kind: "header", name: "Authorization", scheme: "bearer" },
    ...overrides,
  };
}

export function makeResponse(overrides: Partial<SecurityResponseInput> = {}): SecurityResponseInput {
  return {
    status: 400,
    headers: { "content-type": "application/json" },
    rawBody: '{"error":"invalid"}',
    durationMs: 12,
    error: null,
    ...overrides,
  };
}

export function makeTest(overrides: Partial<NegativeTest> = {}): NegativeTest {
  return {
    id: "test-1",
    name: "example",
    category: "negative",
    targetRequestId: "req-1",
    targetRequestName: "Create user",
    mutation: {
      location: "request.body",
      operation: "remove",
      target: "/name",
      value: { kind: "none" },
      description: "remove required field /name",
    },
    expected: { ...createDefaultExpectedBehavior(), statusClasses: ["4xx"] },
    enabled: true,
    metadata: { source: "contract", ruleId: "negative.body.required-missing", operationId: "POST /users", createdAt: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  };
}

/** A small OpenAPI operation with required fields, types, bounds and an enum
 * — one of each thing the contract generator knows how to exploit. */
export function makeOperation(): ContractOperation {
  return {
    id: "POST /users",
    method: "POST",
    path: "/users",
    operationId: "createUser",
    summary: undefined,
    parameters: [
      {
        name: "tenant",
        location: "query",
        required: true,
        schema: { type: "integer" },
        style: "form",
        explode: undefined,
        unsupportedStyle: undefined,
      },
    ],
    requestBody: {
      required: true,
      content: [
        {
          contentType: "application/json",
          schema: {
            type: "object",
            required: ["name", "age"],
            properties: {
              name: { type: "string", minLength: 2, maxLength: 50 },
              age: { type: "integer", minimum: 18, maximum: 120 },
              role: { type: "string", enum: ["admin", "user"] },
              nickname: { type: ["string", "null"] },
            },
          },
        },
      ],
    },
    responses: [{ statusKey: "201", headers: [], content: [] }],
  };
}

/** An operation with a typed path parameter, for path-mutation tests. */
export function makePathOperation(): ContractOperation {
  return {
    id: "GET /users/{id}",
    method: "GET",
    path: "/users/{id}",
    operationId: "getUser",
    summary: undefined,
    parameters: [
      {
        name: "id",
        location: "path",
        required: true,
        schema: { type: "integer" },
        style: "simple",
        explode: undefined,
        unsupportedStyle: undefined,
      },
    ],
    requestBody: undefined,
    responses: [{ statusKey: "200", headers: [], content: [] }],
  };
}
