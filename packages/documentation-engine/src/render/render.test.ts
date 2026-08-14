import { describe, expect, it } from "vitest";
import {
  OPENAPI_30_DOCUMENT,
  RECURSIVE_DOCUMENT,
  createCollectionRequest,
  createCollectionSource,
} from "../testFixtures.ts";
import { generateDocumentation } from "../generate/index.ts";
import { createDefaultRenderOptions, type Documentation, type RenderOptions } from "../types.ts";
import { documentationFileName, renderDocumentation } from "./index.ts";
import { buildSearchIndex } from "./searchIndex.ts";

function generate(source = OPENAPI_30_DOCUMENT): Documentation {
  const result = generateDocumentation({
    specificationSource: source,
    collection: undefined,
    grouping: "auto",
    includeCollectionExamples: true,
    coverage: undefined,
    drift: undefined,
    generatedAt: undefined,
  });
  if (!result.ok) throw new Error(result.detail);
  return result.documentation;
}

function options(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return { ...createDefaultRenderOptions(), ...overrides };
}

const documentation = generate();

// ---------------------------------------------------------------------------
// Markdown (spec §26)
// ---------------------------------------------------------------------------

describe("Markdown rendering (spec §26)", () => {
  const markdown = renderDocumentation(documentation, "markdown", options()).content;

  it("leads with the API title as an H1", () => {
    expect(markdown.startsWith("# Orders API\n")).toBe(true);
  });

  it("documents the version and servers", () => {
    expect(markdown).toContain("**Version:** 1.4.0");
    expect(markdown).toContain("`https://api.example.com/v1`");
  });

  it("renders each endpoint with method and path", () => {
    expect(markdown).toContain("### `GET` /orders");
    expect(markdown).toContain("### `POST` /orders");
    expect(markdown).toContain("### `HEAD` /orders/{orderId}");
  });

  it("marks a deprecated endpoint", () => {
    expect(markdown).toContain("### `DELETE` /orders/{orderId} _(deprecated)_");
  });

  it("renders a parameter table with the documented columns (spec §10)", () => {
    expect(markdown).toContain(
      "| Name | In | Type | Required | Default | Example | Constraints | Description |",
    );
    expect(markdown).toContain("| `status` | query | string | no | `open` | `shipped` |");
  });

  it("renders responses with descriptions", () => {
    expect(markdown).toContain("- **200** — A page of orders.");
    expect(markdown).toContain("- **404** — Not found.");
  });

  it("renders the authentication section with placeholders only", () => {
    expect(markdown).toContain("## Authentication");
    expect(markdown).toContain("Authorization: Bearer {{token}}");
    expect(markdown).toContain("Credential values are never included");
  });

  it("renders schemas with required markers", () => {
    expect(markdown).toContain("### Order");
    expect(markdown).toContain("- `id` — string, **required**");
    expect(markdown).toContain("- `note` — string | null, optional");
  });

  it("emits no raw HTML beyond anchor targets", () => {
    // Anchors are the one exception, and they carry no attacker-controlled
    // text — the id is a slug of method + path.
    const tags = [...markdown.matchAll(/<[a-zA-Z][^>]*>/g)].map((match) => match[0]);
    for (const tag of tags) {
      expect(tag.startsWith("<a id=")).toBe(true);
    }
  });

  it("omits sections the caller turned off", () => {
    const minimal = renderDocumentation(
      documentation,
      "markdown",
      options({
        sections: {
          overview: false,
          authentication: false,
          endpoints: true,
          schemas: false,
          examples: false,
          contractStatus: false,
        },
      }),
    ).content;
    expect(minimal).not.toContain("## Authentication");
    expect(minimal).not.toContain("## Schemas");
    expect(minimal).toContain("### `GET` /orders");
  });

  it("renders a recursive schema as a terminating reference (spec §14)", () => {
    const recursive = renderDocumentation(generate(RECURSIVE_DOCUMENT), "markdown", options()).content;
    expect(recursive).toContain("Node → see Node");
    expect(recursive.length).toBeLessThan(200_000);
  });

  it("widens a code fence so an example cannot escape it", () => {
    const collection = createCollectionSource([
      createCollectionRequest({
        body: "a ``` b",
        contentType: "text/plain",
        url: "https://api.example.com/echo",
      }),
    ]);
    const result = generateDocumentation({
      specificationSource: undefined,
      collection,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    if (!result.ok) throw new Error(result.detail);
    const output = renderDocumentation(result.documentation, "markdown", options()).content;
    expect(output).toContain("````");
  });
});

// ---------------------------------------------------------------------------
// HTML (spec §24, §27)
// ---------------------------------------------------------------------------

describe("HTML rendering (spec §24)", () => {
  const rendered = renderDocumentation(documentation, "html", options());
  const html = rendered.content;

  it("produces a complete standalone document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Orders API</title>");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("emits the stylesheet as a companion asset and inline", () => {
    expect(rendered.assets.map((asset) => asset.path)).toEqual(["assets/styles.css"]);
    // Inlined too, so the page renders correctly opened on its own.
    expect(html).toContain("<style>");
    expect(html).toContain("--accent");
  });

  it("references no external resource, so it works offline from file://", () => {
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/@import\s+url\(/);
  });

  it("renders navigation covering the required sections (spec §27)", () => {
    expect(html).toContain('href="#overview"');
    expect(html).toContain('href="#authentication"');
    expect(html).toContain('href="#schemas"');
    expect(html).toContain('href="#get-orders"');
  });

  it("gives each endpoint a stable anchor matching its link", () => {
    expect(html).toContain('id="get-orders"');
    expect(html).toContain('id="delete-orders-orderid"');
  });

  it("renders a method badge for every method, including uncommon ones", () => {
    expect(html).toContain('class="method method-get"');
    expect(html).toContain('class="method method-head"');
    expect(html).toContain('class="method method-delete"');
  });

  it("renders the parameter table", () => {
    expect(html).toContain("<th>Constraints</th>");
    expect(html).toContain("<code>status</code>");
  });

  it("states the credential policy in the authentication section", () => {
    expect(html).toContain("Credential values are never included in generated documentation");
    expect(html).toContain("Authorization: Bearer {{token}}");
  });

  it("renders a recursive schema as a terminating reference (spec §14)", () => {
    const recursive = renderDocumentation(generate(RECURSIVE_DOCUMENT), "html", options()).content;
    expect(recursive).toContain("Node → see Node");
    expect(recursive.length).toBeLessThan(400_000);
  });

  it("omits the search UI when the caller turns it off", () => {
    const without = renderDocumentation(documentation, "html", options({ includeSearch: false })).content;
    expect(without).not.toContain('id="search"');
    expect(without).not.toContain("__API_LAB_DOCS_INDEX__");
  });
});

// ---------------------------------------------------------------------------
// Search (spec §30)
// ---------------------------------------------------------------------------

describe("search index (spec §30)", () => {
  const index = buildSearchIndex(documentation);

  it("has one entry per endpoint plus one per schema", () => {
    const endpointCount = documentation.groups.reduce(
      (total, group) => total + group.endpoints.length,
      0,
    );
    expect(index).toHaveLength(endpointCount + documentation.schemas.length);
  });

  it("makes an endpoint findable by path, method, tag, auth and parameter", () => {
    const entry = index.find((candidate) => candidate.id === "get-orders");
    expect(entry).toBeDefined();
    for (const term of ["get", "/orders", "orders", "bearerauth", "status", "listorders"]) {
      expect(entry?.haystack).toContain(term);
    }
  });

  it("makes a schema findable by name", () => {
    const entry = index.find((candidate) => candidate.id === "schema-order");
    expect(entry).toMatchObject({ title: "Order", kind: "Schema" });
  });

  it("pre-lowercases the haystack so matching needs no per-query work", () => {
    for (const entry of index) {
      expect(entry.haystack).toBe(entry.haystack.toLowerCase());
    }
  });

  it("embeds the index and the matcher as separate script elements", () => {
    const html = renderDocumentation(documentation, "html", options()).content;
    expect(html).toContain("window.__API_LAB_DOCS_INDEX__ =");
    expect(html).toContain('document.getElementById("search")');
    // The matcher must never write markup.
    expect(html).not.toContain("innerHTML");
  });
});

// ---------------------------------------------------------------------------
// JSON (spec §23)
// ---------------------------------------------------------------------------

describe("JSON rendering (spec §23)", () => {
  it("round-trips the complete model", () => {
    const json = renderDocumentation(documentation, "json", options()).content;
    expect(JSON.parse(json)).toEqual(documentation);
  });

  it("ignores section toggles, because an export must not silently lose data", () => {
    const filtered = renderDocumentation(
      documentation,
      "json",
      options({
        sections: {
          overview: false,
          authentication: false,
          endpoints: false,
          schemas: false,
          examples: false,
          contractStatus: false,
        },
      }),
    ).content;
    expect(JSON.parse(filtered)).toEqual(documentation);
  });
});

// ---------------------------------------------------------------------------
// Determinism (spec §33)
// ---------------------------------------------------------------------------

describe("deterministic rendering (spec §33)", () => {
  for (const format of ["html", "markdown", "json"] as const) {
    it(`produces byte-identical ${format} across runs`, () => {
      const a = renderDocumentation(generate(), format, options()).content;
      const b = renderDocumentation(generate(), format, options()).content;
      expect(a).toBe(b);
    });
  }

  it("contains no timestamp when none was requested", () => {
    const html = renderDocumentation(documentation, "html", options()).content;
    // An ISO-8601 date would be the usual accidental source of nondeterminism.
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("includes a timestamp only when explicitly asked", () => {
    const result = generateDocumentation({
      specificationSource: OPENAPI_30_DOCUMENT,
      collection: undefined,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    if (!result.ok) throw new Error(result.detail);
    expect(renderDocumentation(result.documentation, "html", options()).content).toContain(
      "2026-01-01T00:00:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// Large documents (spec §35, §38)
// ---------------------------------------------------------------------------

describe("large documentation sets (spec §35)", () => {
  function largeSpec(operationCount: number): string {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < operationCount; i += 1) {
      paths[`/resource${i}`] = {
        get: {
          tags: ["Bulk"],
          summary: `Operation ${i}`,
          description: "A generated operation.",
          responses: { "200": { description: "OK." } },
        },
      };
    }
    return JSON.stringify({ openapi: "3.0.0", info: { title: "Large", version: "1" }, paths });
  }

  it("renders a 500-operation specification in bounded time and size", () => {
    const large = generate(largeSpec(500));
    const started = Date.now();
    const rendered = renderDocumentation(large, "html", options());
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(rendered.truncated).toBe(false);
    expect(rendered.content.length).toBeLessThan(8 * 1024 * 1024);
  });

  it("caps operations and says so", () => {
    const large = generate(largeSpec(1_100));
    expect(large.metadata.endpointCount).toBe(1_000);
    const html = renderDocumentation(large, "html", options()).content;
    // The omission is stated in the output, not only in the model.
    expect(html).toContain("only the first 1000");
  });
});

describe("documentationFileName", () => {
  it("names each format's export", () => {
    expect(documentationFileName("html")).toBe("index.html");
    expect(documentationFileName("markdown")).toBe("API.md");
    expect(documentationFileName("json")).toBe("documentation.json");
  });
});
