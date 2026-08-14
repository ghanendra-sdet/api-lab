import { describe, expect, it } from "vitest";
import {
  createDefaultDocumentationConfig,
  createEmptyDocumentationWorkspace,
  deserializeDocumentation,
  serializeDocumentation,
} from "./schema.ts";
import { DOCUMENTATION_FORMAT_VERSION } from "./types.ts";

describe("documentation configuration defaults", () => {
  const config = createDefaultDocumentationConfig("doc-1", "My API docs");

  it("defaults to a deterministic configuration", () => {
    // Timestamps off by default, so the very first export a user takes is
    // already reproducible (spec §33).
    expect(config.includeTimestamp).toBe(false);
  });

  it("defaults to HTML with the common sections on", () => {
    expect(config.format).toBe("html");
    expect(config.sections.overview).toBe(true);
    expect(config.sections.endpoints).toBe(true);
    expect(config.sections.schemas).toBe(true);
    // Contract status is QA metadata, off unless asked for.
    expect(config.sections.contractStatus).toBe(false);
  });

  it("has present-but-undefined source references, not absent keys", () => {
    expect("specificationId" in config).toBe(true);
    expect(config.specificationId).toBeUndefined();
  });
});

describe("documentation persistence (spec §42)", () => {
  const workspace = {
    configs: [createDefaultDocumentationConfig("doc-1", "My API docs")],
  };

  it("round-trips through the versioned envelope", () => {
    const serialized = serializeDocumentation(workspace);
    expect(serialized.version).toBe(DOCUMENTATION_FORMAT_VERSION);

    const result = deserializeDocumentation(JSON.parse(JSON.stringify(serialized)));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.documentation).toEqual(workspace);
  });

  it("normalizes an absent optional key to an explicit undefined", () => {
    const raw = {
      version: DOCUMENTATION_FORMAT_VERSION,
      documentation: {
        configs: [
          {
            id: "doc-1",
            name: "Docs",
            sourceKind: "collection",
            // specificationId omitted entirely.
            format: "markdown",
            sections: {
              overview: true,
              authentication: true,
              endpoints: true,
              schemas: false,
              examples: true,
              contractStatus: false,
            },
            grouping: "folder",
            includeCollectionExamples: true,
            includeTimestamp: false,
          },
        ],
      },
    };
    const result = deserializeDocumentation(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config = result.documentation.configs[0];
    expect("specificationId" in (config as object)).toBe(true);
    expect(config?.specificationId).toBeUndefined();
  });

  it("stores no rendered output — only references and settings", () => {
    // Spec §42: generated HTML is never the source of truth. This is also why
    // this file cannot leak a credential: there is no body or header in it.
    const serialized = JSON.stringify(serializeDocumentation(workspace));
    expect(serialized).not.toContain("<!DOCTYPE");
    expect(serialized).not.toContain("<html");
    expect(serialized).not.toContain("Authorization");
  });

  it("rejects a missing envelope rather than crashing", () => {
    expect(deserializeDocumentation(null)).toMatchObject({ ok: false, reason: "invalid-envelope" });
    expect(deserializeDocumentation({})).toMatchObject({ ok: false, reason: "invalid-envelope" });
    expect(deserializeDocumentation({ version: "1", documentation: {} })).toMatchObject({
      ok: false,
      reason: "invalid-envelope",
    });
  });

  it("rejects an unsupported version rather than guessing", () => {
    expect(
      deserializeDocumentation({ version: 99, documentation: { configs: [] } }),
    ).toMatchObject({ ok: false, reason: "unsupported-version" });
  });

  it("rejects a malformed shape rather than loading half of it", () => {
    expect(
      deserializeDocumentation({
        version: DOCUMENTATION_FORMAT_VERSION,
        documentation: { configs: [{ id: "x" }] },
      }),
    ).toMatchObject({ ok: false, reason: "invalid-shape" });
  });

  it("rejects an unknown format or grouping value", () => {
    const base = createDefaultDocumentationConfig("doc-1", "Docs");
    expect(
      deserializeDocumentation({
        version: DOCUMENTATION_FORMAT_VERSION,
        documentation: { configs: [{ ...base, format: "pdf" }] },
      }),
    ).toMatchObject({ ok: false, reason: "invalid-shape" });
  });

  it("round-trips an empty workspace", () => {
    const result = deserializeDocumentation(
      serializeDocumentation(createEmptyDocumentationWorkspace()),
    );
    expect(result).toMatchObject({ ok: true });
  });
});
