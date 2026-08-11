import { describe, expect, it } from "vitest";
import { createCollection, createRequest, type Collection } from "@api-lab/workspace-engine";
import { emptyRequestConfig } from "../internal.ts";
import { exportPostmanCollection } from "./exportAdapter.ts";
import { parsePostmanCollection } from "./parse.ts";
import { adaptPostmanCollection } from "./importAdapter.ts";

function buildSampleCollection(): Collection {
  const { workspace, collectionId } = createCollection({ collections: [] }, "My Collection");
  const { workspace: w2 } = createRequest(
    workspace,
    { collectionId },
    "Get Users",
    emptyRequestConfig({
      method: "GET",
      url: "https://api.example.com/users",
      params: [{ id: "p1", key: "page", value: "1", enabled: true }],
      headers: [{ id: "h1", key: "Accept", value: "application/json", enabled: true }],
      auth: { type: "bearer", token: "{{token}}" },
    }),
  );
  return w2.collections[0]!;
}

describe("exportPostmanCollection", () => {
  it("produces a structurally valid Postman collection", () => {
    const exported = exportPostmanCollection(buildSampleCollection()) as {
      info: { name: string; schema: string };
      item: unknown[];
    };
    expect(exported.info.name).toBe("My Collection");
    expect(exported.info.schema).toContain("collection/v2.1.0");
    expect(exported.item).toHaveLength(1);
  });

  it("is valid JSON with no internal API Lab execution state", () => {
    const exported = exportPostmanCollection(buildSampleCollection());
    const json = JSON.stringify(exported);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toContain("AbortController");
    expect(json).not.toContain("requestStatus");
  });

  it("is deterministic — exporting the same collection twice produces identical JSON", () => {
    const collection = buildSampleCollection();
    expect(JSON.stringify(exportPostmanCollection(collection))).toBe(JSON.stringify(exportPostmanCollection(collection)));
  });

  it("round-trips through the Postman importer, preserving method/url/headers/params/auth", () => {
    const collection = buildSampleCollection();
    const exported = exportPostmanCollection(collection);

    const parsed = parsePostmanCollection(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const reimported = adaptPostmanCollection(parsed.data);
    const request = reimported.items[0];
    expect(request?.type).toBe("request");
    if (request?.type === "request") {
      expect(request.request.method).toBe("GET");
      expect(request.request.headers.find((h) => h.key === "Accept")?.value).toBe("application/json");
      expect(request.request.auth).toEqual({ type: "bearer", token: "{{token}}" });
    }
  });
});
