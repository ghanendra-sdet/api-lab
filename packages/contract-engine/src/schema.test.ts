import { describe, expect, it } from "vitest";
import {
  createEmptyContractWorkspace,
  deserializeContracts,
  serializeContracts,
} from "./schema.ts";
import { CONTRACT_FORMAT_VERSION, type ContractWorkspace } from "./types.ts";
import { MAX_SPEC_FILE_SIZE_BYTES } from "./limits.ts";

const workspace: ContractWorkspace = {
  specifications: [
    {
      id: "spec-1",
      name: "Users API",
      source: '{"openapi":"3.0.3"}',
      sourceFormat: "json",
      openapiVersionString: "3.0.3",
      importedAt: "2026-01-01T00:00:00.000Z",
      collectionIds: ["col-1"],
    },
  ],
};

describe("contract persistence envelope", () => {
  it("round-trips through the versioned envelope", () => {
    const serialized = serializeContracts(workspace);
    expect(serialized.version).toBe(CONTRACT_FORMAT_VERSION);

    const result = deserializeContracts(serialized);
    expect(result.ok).toBe(true);
    expect(result.ok && result.contracts).toEqual(workspace);
  });

  it("round-trips an empty workspace", () => {
    const result = deserializeContracts(serializeContracts(createEmptyContractWorkspace()));
    expect(result.ok && result.contracts.specifications).toEqual([]);
  });

  it("rejects a missing envelope rather than crashing", () => {
    for (const bad of [null, undefined, 42, "text", {}, { version: 1 }, { contracts: {} }]) {
      const result = deserializeContracts(bad);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("invalid-envelope");
    }
  });

  it("rejects a non-numeric version", () => {
    const result = deserializeContracts({ version: "1", contracts: workspace });
    expect(result.ok === false && result.reason).toBe("invalid-envelope");
  });

  it("rejects an unsupported format version instead of guessing at migration", () => {
    const result = deserializeContracts({ version: 99, contracts: workspace });
    expect(result.ok === false && result.reason).toBe("unsupported-version");
    expect(result.ok === false && result.detail).toContain("99");
  });

  it("rejects a structurally invalid payload", () => {
    const result = deserializeContracts({ version: CONTRACT_FORMAT_VERSION, contracts: { specifications: "nope" } });
    expect(result.ok === false && result.reason).toBe("invalid-shape");
  });

  it("rejects a specification missing required fields", () => {
    const result = deserializeContracts({
      version: CONTRACT_FORMAT_VERSION,
      contracts: { specifications: [{ id: "a" }] },
    });
    expect(result.ok === false && result.reason).toBe("invalid-shape");
  });

  it("rejects an unknown source format", () => {
    const result = deserializeContracts({
      version: CONTRACT_FORMAT_VERSION,
      contracts: { specifications: [{ ...workspace.specifications[0]!, sourceFormat: "xml" }] },
    });
    expect(result.ok === false && result.reason).toBe("invalid-shape");
  });

  it("enforces the size limit on load, not only on import", () => {
    // localStorage is as untrusted as a file: anything with access to the
    // origin could have written an oversized blob there.
    const result = deserializeContracts({
      version: CONTRACT_FORMAT_VERSION,
      contracts: {
        specifications: [{ ...workspace.specifications[0]!, source: "x".repeat(MAX_SPEC_FILE_SIZE_BYTES + 1) }],
      },
    });
    expect(result.ok === false && result.reason).toBe("invalid-shape");
  });

  it("never throws for any input", () => {
    const hostile = [Symbol("s"), () => undefined, new Map(), [], { version: 1, contracts: [] }];
    for (const value of hostile) {
      expect(() => deserializeContracts(value)).not.toThrow();
    }
  });
});
