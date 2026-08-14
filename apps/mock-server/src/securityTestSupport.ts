import type { ContractOperation } from "@api-lab/contract-engine";

/**
 * The contract description of the `/__security/validation` fixture.
 *
 * Kept beside the fixture it describes, so the two cannot drift. The whole
 * value of the contract-aware generator rests on the specification and the
 * server agreeing: if the spec said `minimum: 18` and the handler enforced
 * 21, every boundary test would fail for a reason that had nothing to do with
 * the engine. `validateFixtureBody` in securityFixtures.ts enforces exactly
 * the constraints declared here, and the integration suite asserts both
 * directions of each boundary to keep that honest.
 */
export function makeSecurityOperation(): ContractOperation {
  return {
    id: "POST /__security/validation",
    method: "POST",
    path: "/__security/validation",
    operationId: "createValidatedUser",
    summary: "Validation fixture",
    parameters: [],
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
            },
          },
        },
      ],
    },
    responses: [
      { statusKey: "201", headers: [], content: [] },
      { statusKey: "400", headers: [], content: [] },
    ],
  };
}
