import { describe, expect, it } from "vitest";
import { generateDocumentation } from "./generate/index.ts";
import { renderDocumentation } from "./render/index.ts";
import { createDefaultRenderOptions, type Documentation } from "./types.ts";
import {
  SCRIPT_BREAKOUT_PAYLOAD,
  XSS_PAYLOAD,
  createCollectionRequest,
  createCollectionSource,
} from "./testFixtures.ts";

/**
 * HTML injection regression suite (spec §25, §39).
 *
 * ## What is being asserted
 *
 * A hostile OpenAPI document or collection must not be able to put executable
 * markup into a generated documentation page. This is the highest-consequence
 * property in Milestone 13: generated documentation is designed to be
 * exported and opened elsewhere — a colleague's browser, a wiki, a docs repo
 * — long after anyone remembers where the specification came from.
 *
 * Each test drives a payload through one specific field and asserts three
 * things about the rendered HTML:
 *
 * 1. The escaped text is present, so the field is genuinely being rendered
 *    and the test is not passing because the content was silently dropped.
 * 2. No executable `<script` / `<img` tag derived from the payload exists.
 * 3. The document as a whole contains no unexpected executable element.
 *
 * Point 1 matters more than it looks. A renderer that dropped every
 * description would pass a naive "no <script> in output" assertion perfectly,
 * which is how escaping tests quietly stop testing anything.
 */

const RENDER_OPTIONS = createDefaultRenderOptions();

function generate(input: {
  specificationSource?: string;
  collection?: ReturnType<typeof createCollectionSource>;
}): Documentation {
  const result = generateDocumentation({
    specificationSource: input.specificationSource,
    collection: input.collection,
    grouping: "auto",
    includeCollectionExamples: true,
    coverage: undefined,
    drift: undefined,
    generatedAt: undefined,
  });
  if (!result.ok) throw new Error(result.detail);
  return result.documentation;
}

function toHtml(documentation: Documentation): string {
  return renderDocumentation(documentation, "html", RENDER_OPTIONS).content;
}

/**
 * Asserts the payload survived as *text* and never as markup.
 *
 * The only `<script>` elements permitted in a generated page are the two the
 * renderer authors itself: the search index literal and the fixed matcher.
 */
function expectNeutralized(html: string): void {
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("<img src=x");
  expect(html).not.toContain("onerror=");

  const scriptOpenTags = [...html.matchAll(/<script[^>]*>/g)];
  expect(scriptOpenTags.length).toBeLessThanOrEqual(2);
}

// ---------------------------------------------------------------------------
// OpenAPI-sourced injection
// ---------------------------------------------------------------------------

describe("HTML injection through OpenAPI fields (spec §39)", () => {
  function specWith(overrides: Record<string, unknown>): string {
    return JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Hostile API", version: "1.0.0" },
      paths: {
        "/things": {
          get: {
            summary: "List things",
            responses: { "200": { description: "OK." } },
            ...overrides,
          },
        },
      },
    });
  }

  it("escapes an operation description", () => {
    expectNeutralized(toHtml(generate({ specificationSource: specWith({ description: XSS_PAYLOAD }) })));
  });

  it("escapes an operation summary", () => {
    expectNeutralized(toHtml(generate({ specificationSource: specWith({ summary: XSS_PAYLOAD }) })));
  });

  it("escapes a parameter description", () => {
    const html = toHtml(
      generate({
        specificationSource: specWith({
          parameters: [{ name: "q", in: "query", description: XSS_PAYLOAD, schema: { type: "string" } }],
        }),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a parameter name", () => {
    // A parameter name lands inside a `<code>` element and a table cell.
    const html = toHtml(
      generate({
        specificationSource: specWith({
          parameters: [{ name: XSS_PAYLOAD, in: "query", schema: { type: "string" } }],
        }),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a response description", () => {
    const html = toHtml(
      generate({
        specificationSource: specWith({ responses: { "200": { description: XSS_PAYLOAD } } }),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a declared example body", () => {
    const html = toHtml(
      generate({
        specificationSource: specWith({
          responses: {
            "200": {
              description: "OK.",
              content: { "application/json": { example: { note: XSS_PAYLOAD } } },
            },
          },
        }),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a schema description", () => {
    const html = toHtml(
      generate({
        specificationSource: JSON.stringify({
          openapi: "3.0.0",
          info: { title: "Hostile", version: "1" },
          paths: {},
          components: {
            schemas: {
              Thing: {
                type: "object",
                description: XSS_PAYLOAD,
                properties: { field: { type: "string", description: XSS_PAYLOAD } },
              },
            },
          },
        }),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a schema property name", () => {
    const html = toHtml(
      generate({
        specificationSource: JSON.stringify({
          openapi: "3.0.0",
          info: { title: "Hostile", version: "1" },
          paths: {},
          components: {
            schemas: { Thing: { type: "object", properties: { [XSS_PAYLOAD]: { type: "string" } } } },
          },
        }),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a tag name, which also becomes a group heading and an anchor", () => {
    const html = toHtml(generate({ specificationSource: specWith({ tags: [XSS_PAYLOAD] }) }));
    expect(html).not.toContain("<script>alert(1)</script>");
    // The anchor id is a slug, so the payload cannot reach attribute position
    // as markup even before escaping.
    expect(html).toContain('id="group-script-alert-1-script"');
  });

  it("escapes the API title, which lands in <title> and <h1>", () => {
    const html = toHtml(
      generate({
        specificationSource: JSON.stringify({
          openapi: "3.0.0",
          info: { title: XSS_PAYLOAD, version: "1" },
          paths: {},
        }),
      }),
    );
    expectNeutralized(html);
    expect(html).toContain("<title>&lt;script&gt;");
  });

  it("escapes a server URL", () => {
    const html = toHtml(
      generate({
        specificationSource: JSON.stringify({
          openapi: "3.0.0",
          info: { title: "Hostile", version: "1" },
          servers: [{ url: XSS_PAYLOAD }],
          paths: {},
        }),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a security scheme description and parameter name", () => {
    const html = toHtml(
      generate({
        specificationSource: JSON.stringify({
          openapi: "3.0.0",
          info: { title: "Hostile", version: "1" },
          paths: {},
          components: {
            securitySchemes: {
              key: { type: "apiKey", in: "header", name: XSS_PAYLOAD, description: XSS_PAYLOAD },
            },
          },
        }),
      }),
    );
    expectNeutralized(html);
  });
});

// ---------------------------------------------------------------------------
// Collection-sourced injection
// ---------------------------------------------------------------------------

describe("HTML injection through collection fields (spec §39)", () => {
  it("escapes a collection name", () => {
    const html = toHtml(
      generate({
        collection: createCollectionSource([createCollectionRequest()], { name: XSS_PAYLOAD }),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a request name and description", () => {
    const html = toHtml(
      generate({
        collection: createCollectionSource([
          createCollectionRequest({ name: XSS_PAYLOAD, description: XSS_PAYLOAD }),
        ]),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a request body used as an example", () => {
    const html = toHtml(
      generate({
        collection: createCollectionSource([
          createCollectionRequest({ body: JSON.stringify({ note: XSS_PAYLOAD }), contentType: "application/json" }),
        ]),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a recorded response body", () => {
    const html = toHtml(
      generate({
        collection: createCollectionSource([
          createCollectionRequest({
            recordedResponses: [
              {
                status: 200,
                contentType: "application/json",
                headers: [{ name: "X-Note", value: XSS_PAYLOAD }],
                body: JSON.stringify({ note: XSS_PAYLOAD }),
                origin: "collection",
              },
            ],
          }),
        ]),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a header name and value", () => {
    const html = toHtml(
      generate({
        collection: createCollectionSource([
          createCollectionRequest({ headers: [{ name: XSS_PAYLOAD, value: XSS_PAYLOAD }] }),
        ]),
      }),
    );
    expectNeutralized(html);
  });

  it("escapes a query parameter name", () => {
    const html = toHtml(
      generate({
        collection: createCollectionSource([
          createCollectionRequest({ queryParams: [{ name: XSS_PAYLOAD, value: "x" }] }),
        ]),
      }),
    );
    expectNeutralized(html);
  });
});

// ---------------------------------------------------------------------------
// Script-element breakout (the search index)
// ---------------------------------------------------------------------------

describe("script-element breakout (spec §25)", () => {
  const documentation = generate({
    specificationSource: JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Breakout", version: "1" },
      paths: {
        [`/things/${SCRIPT_BREAKOUT_PAYLOAD}`]: {
          get: { summary: SCRIPT_BREAKOUT_PAYLOAD, tags: [SCRIPT_BREAKOUT_PAYLOAD], responses: {} },
        },
      },
    }),
  });

  const html = toHtml(documentation);

  it("cannot terminate the search index script element", () => {
    // The payload reaches the index because paths and summaries are indexed.
    // If it survived literally, the HTML parser would close the script here
    // and the following <img> would execute.
    const indexScript = html.slice(html.indexOf("__API_LAB_DOCS_INDEX__"));
    expect(indexScript.slice(0, indexScript.indexOf("</script>"))).not.toContain("</script");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("still indexes the real text, so escaping did not corrupt the data", () => {
    const start = html.indexOf("window.__API_LAB_DOCS_INDEX__ = ") + "window.__API_LAB_DOCS_INDEX__ = ".length;
    const end = html.indexOf(";</script>", start);
    const parsed = JSON.parse(html.slice(start, end)) as Array<{ haystack: string }>;
    expect(parsed.some((entry) => entry.haystack.includes("img src=x"))).toBe(true);
  });

  it("contains exactly the two renderer-authored script elements", () => {
    expect([...html.matchAll(/<script/g)]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

describe("Markdown output carries no injection surface (spec §26)", () => {
  it("emits a payload as literal text, not as a rendered element", () => {
    const documentation = generate({
      specificationSource: JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Hostile", version: "1" },
        paths: {
          "/things": {
            get: {
              summary: "List",
              description: XSS_PAYLOAD,
              parameters: [{ name: "q", in: "query", description: XSS_PAYLOAD, schema: { type: "string" } }],
              responses: { "200": { description: XSS_PAYLOAD } },
            },
          },
        },
      }),
    });
    const markdown = renderDocumentation(documentation, "markdown", RENDER_OPTIONS).content;

    // The payload is present as text — Markdown is not HTML and API Lab does
    // not render it, so escaping it would corrupt the documentation for no
    // gain. What matters is that the *table structure* survives.
    expect(markdown).toContain("script");
    const tableRow = markdown
      .split("\n")
      .find((line) => line.startsWith("| `q` |"));
    expect(tableRow?.split("|").length).toBe(10);
  });

  it("keeps a pipe in a description from splitting a table row", () => {
    const documentation = generate({
      specificationSource: JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Pipes", version: "1" },
        paths: {
          "/things": {
            get: {
              parameters: [
                { name: "q", in: "query", description: "a | b | c", schema: { type: "string" } },
              ],
              responses: {},
            },
          },
        },
      }),
    });
    const markdown = renderDocumentation(documentation, "markdown", RENDER_OPTIONS).content;
    const tableRow = markdown.split("\n").find((line) => line.startsWith("| `q` |"));
    expect(tableRow).toContain("a \\| b \\| c");
    expect(tableRow?.split(/(?<!\\)\|/).length).toBe(10);
  });
});
