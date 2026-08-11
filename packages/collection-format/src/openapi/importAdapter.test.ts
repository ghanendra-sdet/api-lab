import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOpenApiDocument } from "./parse.ts";
import { adaptOpenApiDocument } from "./importAdapter.ts";

const fixturesDir = fileURLToPath(new URL("../../fixtures/openapi", import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}/${name}`, "utf-8"));
}

describe("OpenAPI 3.0 import", () => {
  it("parses a valid 3.0.x document", () => {
    const parsed = parseOpenApiDocument(loadFixture("openapi-3.0.json"));
    expect(parsed.ok).toBe(true);
  });

  it("groups operations by tag into folders", () => {
    const parsed = parseOpenApiDocument(loadFixture("openapi-3.0.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptOpenApiDocument(parsed.data);

    expect(result.name).toBe("Pet Store");
    const petsFolder = result.items.find((i) => i.type === "folder" && i.name === "Pets");
    expect(petsFolder?.type).toBe("folder");
    if (petsFolder?.type === "folder") {
      expect(petsFolder.items.map((r) => r.name)).toEqual(
        expect.arrayContaining(["List pets", "Create pet", "Get pet by ID"]),
      );
    }
  });

  it("maps path parameters to {{variable}} syntax but leaves query/header parameters as rows", () => {
    const parsed = parseOpenApiDocument(loadFixture("openapi-3.0.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptOpenApiDocument(parsed.data);
    const petsFolder = result.items.find((i) => i.type === "folder" && i.name === "Pets");
    const getById = petsFolder?.type === "folder" ? petsFolder.items.find((r) => r.name === "Get pet by ID") : undefined;

    expect(getById?.request.url).toBe("https://api.example.com/v1/pets/{{petId}}");
    expect(getById?.request.headers.find((h) => h.key === "X-Request-Id")).toBeDefined();
  });

  it("prefixes the path with the first declared server URL", () => {
    const parsed = parseOpenApiDocument(loadFixture("openapi-3.0.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptOpenApiDocument(parsed.data);
    const petsFolder = result.items.find((i) => i.type === "folder" && i.name === "Pets");
    const list = petsFolder?.type === "folder" ? petsFolder.items.find((r) => r.name === "List pets") : undefined;
    expect(list?.request.url).toBe("https://api.example.com/v1/pets");
  });

  it("maps a JSON example request body", () => {
    const parsed = parseOpenApiDocument(loadFixture("openapi-3.0.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptOpenApiDocument(parsed.data);
    const petsFolder = result.items.find((i) => i.type === "folder" && i.name === "Pets");
    const create = petsFolder?.type === "folder" ? petsFolder.items.find((r) => r.name === "Create pet") : undefined;
    expect(create?.request.bodyMode).toBe("raw");
    expect(create?.request.bodyRawContent).toContain('"name": "Rex"');
  });

  it("maps a bearer security scheme", () => {
    const parsed = parseOpenApiDocument(loadFixture("openapi-3.0.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptOpenApiDocument(parsed.data);
    const petsFolder = result.items.find((i) => i.type === "folder" && i.name === "Pets");
    const create = petsFolder?.type === "folder" ? petsFolder.items.find((r) => r.name === "Create pet") : undefined;
    expect(create?.request.auth).toEqual({ type: "bearer", token: "{{token}}" });
  });
});

describe("OpenAPI 3.1 import", () => {
  it("parses a valid 3.1.x document and maps an apiKey security scheme", () => {
    const parsed = parseOpenApiDocument(loadFixture("openapi-3.1.json"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = adaptOpenApiDocument(parsed.data);
    expect(result.name).toBe("Notes API");
    const deleteNote = result.items.find((i) => i.type === "request" && i.name === "Delete note");
    if (deleteNote?.type === "request") {
      expect(deleteNote.request.method).toBe("DELETE");
      expect(deleteNote.request.url).toBe("https://notes.example.com/notes/{{noteId}}");
      expect(deleteNote.request.auth).toEqual({ type: "apiKey", key: "X-API-Key", value: "{{apiKey}}", addTo: "header" });
    }
  });
});

describe("OpenAPI version support", () => {
  it("rejects an unsupported (2.0/Swagger) version", () => {
    const result = parseOpenApiDocument({ swagger: "2.0", info: { title: "X" }, paths: {} });
    expect(result.ok).toBe(false);
  });

  it("rejects a document with no openapi field", () => {
    const result = parseOpenApiDocument({ info: { title: "X" } });
    expect(result.ok).toBe(false);
  });
});
