import { beforeEach, describe, expect, it } from "vitest";
import type { DocCollectionSource } from "@api-lab/documentation-engine";
import { useDocumentationStore } from "./useDocumentationStore";

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Store API", version: "1.0.0", description: "For store tests." },
  servers: [{ url: "https://api.example.com" }],
  tags: [{ name: "Orders" }],
  paths: {
    "/orders": {
      get: {
        tags: ["Orders"],
        summary: "List orders",
        responses: {
          "200": {
            description: "OK.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } },
          },
        },
      },
    },
  },
  components: { schemas: { Order: { type: "object", properties: { id: { type: "string" } } } } },
});

const COLLECTION: DocCollectionSource = {
  name: "Store Collection",
  description: undefined,
  requests: [
    {
      id: "r1",
      name: "List orders",
      description: undefined,
      method: "GET",
      url: "https://api.example.com/orders",
      folderName: undefined,
      headers: [],
      queryParams: [],
      body: undefined,
      contentType: undefined,
      auth: { type: "none", location: undefined, parameterName: undefined },
      recordedResponses: [],
    },
  ],
};

function generate(overrides: Partial<Parameters<ReturnType<typeof useDocumentationStore.getState>["generate"]>[0]> = {}): void {
  useDocumentationStore.getState().generate({
    specificationSource: SPEC,
    collection: COLLECTION,
    coverage: undefined,
    drift: undefined,
    ...overrides,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  useDocumentationStore.getState().resetDocumentation();
});

describe("generation", () => {
  it("produces a model and a rendered document", () => {
    generate();
    const state = useDocumentationStore.getState();
    expect(state.documentation?.title).toBe("Store API");
    expect(state.rendered?.format).toBe("html");
    expect(state.rendered?.content).toContain("<!DOCTYPE html>");
    expect(state.generationError).toBeNull();
  });

  it("honours the selected source kind", () => {
    const store = useDocumentationStore.getState();

    store.setSourceKind("collection");
    generate();
    expect(useDocumentationStore.getState().documentation?.title).toBe("Store Collection");

    useDocumentationStore.getState().setSourceKind("openapi");
    generate();
    expect(useDocumentationStore.getState().documentation?.title).toBe("Store API");

    useDocumentationStore.getState().setSourceKind("combined");
    generate();
    expect(useDocumentationStore.getState().documentation?.metadata.sources).toEqual([
      "openapi",
      "collection",
    ]);
  });

  it("records a typed error rather than throwing on a bad specification", () => {
    generate({ specificationSource: "{ not json" });
    const state = useDocumentationStore.getState();
    expect(state.generationError).not.toBeNull();
    expect(state.documentation).toBeNull();
    expect(state.rendered).toBeNull();
  });

  it("omits a timestamp by default and includes one when asked", () => {
    generate();
    expect(useDocumentationStore.getState().documentation?.metadata.generatedAt).toBeUndefined();

    useDocumentationStore.getState().setIncludeTimestamp(true);
    generate();
    expect(useDocumentationStore.getState().documentation?.metadata.generatedAt).toBeDefined();
  });

  it("passes coverage and drift only when the contract section is on (spec §20)", () => {
    const coverage = {
      totalOperations: 2,
      coveredOperations: 1,
      operationCoveragePercent: 50,
      validatedOperations: 0,
      validationCoveragePercent: 0,
      uncovered: [],
    };

    generate({ coverage });
    expect(useDocumentationStore.getState().documentation?.coverage).toBeUndefined();

    useDocumentationStore.getState().setSection("contractStatus", true);
    generate({ coverage });
    expect(useDocumentationStore.getState().documentation?.coverage?.operationCoveragePercent).toBe(50);
  });
});

describe("format and section changes re-render without regenerating (spec §36)", () => {
  it("switching format reuses the existing model", () => {
    generate();
    const model = useDocumentationStore.getState().documentation;

    useDocumentationStore.getState().setFormat("markdown");
    const after = useDocumentationStore.getState();

    // Same object identity — the model was not rebuilt, only re-rendered.
    expect(after.documentation).toBe(model);
    expect(after.rendered?.format).toBe("markdown");
    expect(after.rendered?.content.startsWith("# Store API")).toBe(true);
  });

  it("toggling a section reuses the existing model", () => {
    generate();
    const model = useDocumentationStore.getState().documentation;

    useDocumentationStore.getState().setSection("schemas", false);
    const after = useDocumentationStore.getState();
    expect(after.documentation).toBe(model);
    expect(after.rendered?.content).not.toContain('id="schemas"');
  });

  it("changing format before generating does not crash", () => {
    useDocumentationStore.getState().setFormat("json");
    expect(useDocumentationStore.getState().rendered).toBeNull();
    expect(useDocumentationStore.getState().config.format).toBe("json");
  });
});

describe("source changes invalidate the previous output", () => {
  it("clears stale documentation when the source kind changes", () => {
    generate();
    expect(useDocumentationStore.getState().documentation).not.toBeNull();

    useDocumentationStore.getState().setSourceKind("collection");
    // Showing documentation generated from a source the user has switched away
    // from would be actively misleading.
    expect(useDocumentationStore.getState().documentation).toBeNull();
    expect(useDocumentationStore.getState().rendered).toBeNull();
  });

  it("clears when the specification, collection or grouping changes", () => {
    for (const mutate of [
      () => useDocumentationStore.getState().setSpecification("spec-2"),
      () => useDocumentationStore.getState().setCollection("col-2"),
      () => useDocumentationStore.getState().setGrouping("none"),
      () => useDocumentationStore.getState().setIncludeCollectionExamples(false),
    ]) {
      generate();
      expect(useDocumentationStore.getState().documentation).not.toBeNull();
      mutate();
      expect(useDocumentationStore.getState().documentation).toBeNull();
    }
  });

  it("clear() removes output but keeps the configuration", () => {
    generate();
    useDocumentationStore.getState().setFormat("markdown");
    useDocumentationStore.getState().clear();
    const state = useDocumentationStore.getState();
    expect(state.documentation).toBeNull();
    expect(state.config.format).toBe("markdown");
  });
});

describe("saved configurations (spec §42)", () => {
  it("saves, lists and reloads a configuration", () => {
    useDocumentationStore.getState().setFormat("markdown");
    useDocumentationStore.getState().setGrouping("none");
    useDocumentationStore.getState().saveConfig("Public docs");

    const saved = useDocumentationStore.getState().documentationWorkspace.configs;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: "Public docs", format: "markdown", grouping: "none" });

    useDocumentationStore.getState().setFormat("html");
    useDocumentationStore.getState().loadConfig(saved[0]!.id);
    expect(useDocumentationStore.getState().config.format).toBe("markdown");
  });

  it("updates in place rather than duplicating on a second save", () => {
    useDocumentationStore.getState().saveConfig("Docs");
    useDocumentationStore.getState().setFormat("json");
    useDocumentationStore.getState().saveConfig("Docs");

    const saved = useDocumentationStore.getState().documentationWorkspace.configs;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.format).toBe("json");
  });

  it("names an untitled configuration rather than saving a blank one", () => {
    useDocumentationStore.getState().saveConfig("   ");
    expect(useDocumentationStore.getState().documentationWorkspace.configs[0]?.name).toBe("Untitled");
  });

  it("removes a configuration", () => {
    useDocumentationStore.getState().saveConfig("Docs");
    const id = useDocumentationStore.getState().documentationWorkspace.configs[0]!.id;
    useDocumentationStore.getState().removeConfig(id);
    expect(useDocumentationStore.getState().documentationWorkspace.configs).toEqual([]);
  });

  it("ignores a request to load a configuration that does not exist", () => {
    generate();
    useDocumentationStore.getState().loadConfig("missing");
    // No crash, and the current output is untouched.
    expect(useDocumentationStore.getState().documentation).not.toBeNull();
  });

  it("persists only configuration, never rendered output", () => {
    generate();
    useDocumentationStore.getState().saveConfig("Docs");

    // The subscription writes are debounced; assert on what would be written.
    const configs = useDocumentationStore.getState().documentationWorkspace.configs;
    const serialized = JSON.stringify(configs);
    expect(serialized).not.toContain("<!DOCTYPE");
    expect(serialized).not.toContain("<html");
    expect(serialized).toContain("Docs");
  });
});
