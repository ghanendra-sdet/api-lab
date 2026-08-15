import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "./index.ts";
import { createCollection } from "./collection.ts";
import { createFolder } from "./folder.ts";
import { createRequest } from "./request.ts";
import { deserializeWorkspace, serializeWorkspace } from "./serialize.ts";
import { sampleRequestConfig } from "./testHelpers.ts";

function buildSampleWorkspace() {
  const { workspace: w1, collectionId } = createCollection(createEmptyWorkspace(), "API");
  const { workspace: w2, folderId } = createFolder(w1, collectionId, "Auth");
  const { workspace: w3 } = createRequest(w2, { collectionId, folderId }, "Login", sampleRequestConfig());
  return w3;
}

describe("serializeWorkspace / deserializeWorkspace round-trip", () => {
  it("round-trips a workspace with a collection, folder, and request", () => {
    const workspace = buildSampleWorkspace();
    const persisted = serializeWorkspace(workspace);
    const result = deserializeWorkspace(persisted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace).toEqual(workspace);
    }
  });

  it("stamps the current format version", () => {
    const persisted = serializeWorkspace(createEmptyWorkspace());
    expect(persisted.version).toBe(1);
  });
});

describe("deserializeWorkspace error handling", () => {
  it("rejects null", () => {
    const result = deserializeWorkspace(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-envelope");
  });

  it("rejects a bare array", () => {
    const result = deserializeWorkspace([]);
    expect(result.ok).toBe(false);
  });

  it("rejects an object missing the version field", () => {
    const result = deserializeWorkspace({ workspace: createEmptyWorkspace() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-envelope");
  });

  it("rejects an unsupported/future version", () => {
    const result = deserializeWorkspace({ version: 999, workspace: createEmptyWorkspace() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported-version");
  });

  it("rejects a malformed workspace shape (invalid-shape)", () => {
    const result = deserializeWorkspace({ version: 1, workspace: { collections: "not-an-array" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-shape");
  });

  it("rejects a collection with an invalid HTTP method", () => {
    const workspace = buildSampleWorkspace();
    const persisted = serializeWorkspace(workspace) as unknown as {
      version: number;
      workspace: { collections: unknown[] };
    };
    const corrupted = JSON.parse(JSON.stringify(persisted));
    corrupted.workspace.collections[0].items[0].items[0].request.method = "NOT_A_METHOD";
    const result = deserializeWorkspace(corrupted);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-shape");
  });

  it("never throws on garbage input", () => {
    expect(() => deserializeWorkspace(undefined)).not.toThrow();
    expect(() => deserializeWorkspace("just a string")).not.toThrow();
    expect(() => deserializeWorkspace(42)).not.toThrow();
    expect(() => deserializeWorkspace({ version: 1 })).not.toThrow();
  });
});

describe("Milestone 5 backward compatibility: pre-auth saved requests", () => {
  it("loads a request saved before Milestone 5 (old authType field, no auth field) and defaults to No Auth", () => {
    const legacyPersisted = {
      version: 1,
      workspace: {
        collections: [
          {
            id: "c1",
            name: "Legacy Collection",
            items: [
              {
                id: "r1",
                type: "request",
                name: "Old Request",
                request: {
                  method: "GET",
                  url: "https://example.com",
                  params: [],
                  headers: [],
                  // Old field from Milestones 2-4 — no `auth` field at all.
                  authType: "bearer",
                  bodyMode: "none",
                  bodyRawFormat: "JSON",
                  bodyRawContent: "",
                },
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
              },
            ],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      },
    };

    const result = deserializeWorkspace(legacyPersisted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const request = result.workspace.collections[0]!.items[0];
      expect(request && "request" in request && request.request.auth).toEqual({ type: "none" });
    }
  });
});

describe("Milestone 7 backward compatibility: pre-tests saved requests", () => {
  it("loads a request saved before Milestone 7 (no tests field) and defaults to no assertions", () => {
    const legacyPersisted = {
      version: 1,
      workspace: {
        collections: [
          {
            id: "c1",
            name: "Legacy Collection",
            items: [
              {
                id: "r1",
                type: "request",
                name: "Old Request",
                request: {
                  method: "GET",
                  url: "https://example.com",
                  params: [],
                  headers: [],
                  auth: { type: "none" },
                  bodyMode: "none",
                  bodyRawFormat: "JSON",
                  bodyRawContent: "",
                  // No `tests` field — request saved before Milestone 7.
                },
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
              },
            ],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      },
    };

    const result = deserializeWorkspace(legacyPersisted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const request = result.workspace.collections[0]!.items[0];
      expect(request && "request" in request && request.request.tests).toEqual([]);
    }
  });
});

describe("Milestone 8 backward compatibility: pre-extractions saved requests", () => {
  it("loads a request saved before Milestone 8 (no extractions field) and defaults to no extractions", () => {
    const legacyPersisted = {
      version: 1,
      workspace: {
        collections: [
          {
            id: "c1",
            name: "Legacy Collection",
            items: [
              {
                id: "r1",
                type: "request",
                name: "Old Request",
                request: {
                  method: "GET",
                  url: "https://example.com",
                  params: [],
                  headers: [],
                  auth: { type: "none" },
                  bodyMode: "none",
                  bodyRawFormat: "JSON",
                  bodyRawContent: "",
                  tests: [],
                  // No `extractions` field — request saved before Milestone 8.
                },
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
              },
            ],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      },
    };

    const result = deserializeWorkspace(legacyPersisted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const request = result.workspace.collections[0]!.items[0];
      expect(request && "request" in request && request.request.extractions).toEqual([]);
    }
  });
});

describe("Milestone B3.1 backward compatibility: pre-dependsOn saved requests", () => {
  it("loads a request saved before B3.1 (no dependsOn field) with dependsOn left undefined", () => {
    const legacyPersisted = {
      version: 1,
      workspace: {
        collections: [
          {
            id: "c1",
            name: "Legacy Collection",
            items: [
              {
                id: "r1",
                type: "request",
                name: "Old Request",
                request: {
                  method: "GET",
                  url: "https://example.com",
                  params: [],
                  headers: [],
                  auth: { type: "none" },
                  bodyMode: "none",
                  bodyRawFormat: "JSON",
                  bodyRawContent: "",
                  tests: [],
                  extractions: [],
                  // No `dependsOn` field — request saved before B3.1.
                },
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
              },
            ],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      },
    };

    const result = deserializeWorkspace(legacyPersisted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const request = result.workspace.collections[0]!.items[0];
      expect(request && "request" in request && request.request.dependsOn).toBeUndefined();
    }
  });

  it("round-trips a request with dependsOn set", () => {
    const { workspace: w1, collectionId } = createCollection(createEmptyWorkspace(), "API");
    const { workspace: w2 } = createRequest(
      w1,
      { collectionId },
      "Get Profile",
      sampleRequestConfig({ dependsOn: ["login-request-id"] }),
    );

    const persisted = serializeWorkspace(w2);
    const result = deserializeWorkspace(persisted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const request = result.workspace.collections[0]!.items[0];
      expect(request && "request" in request && request.request.dependsOn).toEqual(["login-request-id"]);
    }
  });
});
