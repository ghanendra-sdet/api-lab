import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseImportFile } from "./importFile";
import { MAX_IMPORT_FILE_SIZE_BYTES } from "./types";

const postmanDir = fileURLToPath(new URL("../fixtures/postman", import.meta.url));
const openapiDir = fileURLToPath(new URL("../fixtures/openapi", import.meta.url));
const negativeDir = fileURLToPath(new URL("../fixtures/negative", import.meta.url));

function loadRaw(dir: string, name: string): string {
  return readFileSync(`${dir}/${name}`, "utf-8");
}

describe("parseImportFile — happy paths", () => {
  it("routes a Postman collection through detection to the Postman adapter", () => {
    const result = parseImportFile(loadRaw(postmanDir, "simple-collection.json"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe("collection");
      if (result.data.kind === "collection") expect(result.data.sourceFormat).toBe("postman-collection");
    }
  });

  it("routes a Postman environment through detection to the Postman environment adapter", () => {
    const result = parseImportFile(loadRaw(postmanDir, "environment.json"));
    expect(result.ok).toBe(true);
    if (result.ok && result.data.kind === "environment") {
      expect(result.data.sourceFormat).toBe("postman-environment");
    }
  });

  it("routes an OpenAPI document through detection to the OpenAPI adapter", () => {
    const result = parseImportFile(loadRaw(openapiDir, "openapi-3.0.json"));
    expect(result.ok).toBe(true);
    if (result.ok && result.data.kind === "collection") {
      expect(result.data.sourceFormat).toBe("openapi");
    }
  });
});

describe("parseImportFile — negative cases never crash the app", () => {
  it("rejects invalid JSON with a clear reason, not a throw", () => {
    expect(() => parseImportFile(loadRaw(negativeDir, "invalid-json.txt"))).not.toThrow();
    const result = parseImportFile(loadRaw(negativeDir, "invalid-json.txt"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-json");
  });

  it("rejects an empty object as an unrecognized format", () => {
    const result = parseImportFile(loadRaw(negativeDir, "empty-object.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unrecognized-format");
  });

  it("rejects a file over the configured size limit before parsing", () => {
    const huge = `{"padding":"${"x".repeat(MAX_IMPORT_FILE_SIZE_BYTES + 1)}"}`;
    const result = parseImportFile(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-large");
  });

  it("rejects a Postman-shaped file with a missing required field", () => {
    const result = parseImportFile(JSON.stringify({ info: { name: "X" }, item: "not-an-array" }));
    expect(result.ok).toBe(false);
  });

  it("rejects deeply nested/oversized-but-under-limit structures without hanging (bounded recursion)", () => {
    let nested: unknown = { name: "leaf", request: { method: "GET", url: { raw: "https://x.com" } } };
    for (let i = 0; i < 500; i++) {
      nested = { name: `folder-${i}`, item: [nested] };
    }
    const doc = { info: { name: "Deep", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [nested] };
    expect(() => parseImportFile(JSON.stringify(doc))).not.toThrow();
  });

  it("converts a pathologically deep structure (stack-overflow territory) into a failure result, not an uncaught exception", () => {
    // Built as a raw JSON *string* directly (no object graph, no
    // JSON.stringify of a deep object) — this is what an attacker actually
    // delivers: bytes on disk, not a JS object the test harness itself
    // would need to walk. Exercises JSON.parse + the recursive
    // detect/parse/adapt pipeline exactly as parseImportFile receives it.
    const depth = 50000;
    const text =
      `{"info":{"name":"VeryDeep","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[` +
      '{"name":"f0","item":['.repeat(depth) +
      '{"name":"leaf","request":{"method":"GET","url":{"raw":"https://x.com"}}}' +
      "]}".repeat(depth) +
      "]}";

    let result: ReturnType<typeof parseImportFile> | undefined;
    expect(() => {
      result = parseImportFile(text);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });
});
