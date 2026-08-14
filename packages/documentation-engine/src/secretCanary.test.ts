import { describe, expect, it } from "vitest";
import { generateDocumentation } from "./generate/index.ts";
import { renderDocumentation } from "./render/index.ts";
import { createDefaultRenderOptions, type DocFormat, type Documentation } from "./types.ts";
import {
  ALL_CANARIES,
  CANARY_API_KEY,
  CANARY_BEARER_TOKEN,
  CANARY_COOKIE,
  CANARY_PASSWORD,
  OPENAPI_30_DOCUMENT,
  createCanaryCollection,
  createCollectionRequest,
  createCollectionSource,
} from "./testFixtures.ts";

/**
 * Secret canary suite (spec §34).
 *
 * ## Why canaries rather than assertions about redaction
 *
 * The other tests check that `redactExampleBody` redacts. This suite checks
 * something stronger and much more useful: that *no path through the entire
 * pipeline* — generation, combination, and all three renderers — emits a
 * credential, whether or not anyone remembered to call the redactor on it.
 *
 * The canaries are distinctive, self-identifying strings (see testFixtures.ts)
 * driven through every field of a collection that could plausibly carry one:
 * the URL query string, the Authorization header, the Cookie header, an API
 * key header, the request body, and a recorded response body and header.
 * Then every rendered byte is searched for every canary.
 *
 * A generic value like `"secret"` would make this suite pass by coincidence
 * the moment unrelated prose contained the word. These cannot collide.
 *
 * Spec §34 asks for exactly this, and it is the check most worth having: if
 * a future change adds a field to the documentation model and forgets to
 * redact it, this suite fails, and it fails regardless of which field was
 * added or which renderer displays it.
 */

const RENDER_OPTIONS = createDefaultRenderOptions();
const FORMATS: DocFormat[] = ["html", "markdown", "json"];

function generate(input: Parameters<typeof generateDocumentation>[0]): Documentation {
  const result = generateDocumentation(input);
  if (!result.ok) throw new Error(result.detail);
  return result.documentation;
}

/** Renders in every format and asserts no canary appears in any byte. */
function expectNoCanaries(documentation: Documentation): void {
  // The model itself first — a leak here would reach every consumer,
  // including the JSON export and any future renderer.
  const model = JSON.stringify(documentation);
  for (const canary of ALL_CANARIES) {
    expect(model).not.toContain(canary);
  }

  for (const format of FORMATS) {
    const rendered = renderDocumentation(documentation, format, RENDER_OPTIONS);
    const bytes = [rendered.content, ...rendered.assets.map((asset) => asset.content)].join("\n");
    for (const canary of ALL_CANARIES) {
      expect(bytes, `${canary} leaked into ${format}`).not.toContain(canary);
    }
  }
}

describe("secret canaries — collection source (spec §34)", () => {
  const collection = createCanaryCollection();

  it("emits no canary from any collection field, in any format", () => {
    expectNoCanaries(
      generate({
        specificationSource: undefined,
        collection,
        grouping: "auto",
        includeCollectionExamples: true,
        coverage: undefined,
        drift: undefined,
        generatedAt: undefined,
      }),
    );
  });

  it("emits no canary in the combined path either", () => {
    // The combine step merges collection examples into contract endpoints —
    // a distinct code path, and therefore a distinct chance to leak.
    expectNoCanaries(
      generate({
        specificationSource: OPENAPI_30_DOCUMENT,
        collection,
        grouping: "auto",
        includeCollectionExamples: true,
        coverage: undefined,
        drift: undefined,
        generatedAt: undefined,
      }),
    );
  });

  it("still documents the endpoint, so the suite is not passing by omission", () => {
    // The failure mode this guards: a renderer that drops every example would
    // pass every canary assertion perfectly.
    const documentation = generate({
      specificationSource: undefined,
      collection,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    const html = renderDocumentation(documentation, "html", RENDER_OPTIONS).content;
    expect(html).toContain("/orders");
    expect(html).toContain("POST");
    // The example is present, with its non-sensitive content intact.
    expect(html).toContain("25.5");
    // And the sensitive parts are visibly marked rather than silently gone.
    expect(html).toContain("{{redacted}}");
  });

  it("keeps the header name while removing its value", () => {
    const documentation = generate({
      specificationSource: undefined,
      collection,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    const html = renderDocumentation(documentation, "html", RENDER_OPTIONS).content;
    // The name is diagnostic and not secret — a reader needs to know the
    // header exists.
    expect(html).toContain("Authorization");
    expect(html).not.toContain(CANARY_BEARER_TOKEN);
  });
});

describe("secret canaries — OpenAPI source (spec §34)", () => {
  it("emits no canary from a specification's own examples", () => {
    // Specifications genuinely do ship examples containing real-looking
    // tokens, so declared examples are redacted like any other body.
    const documentation = generate({
      specificationSource: JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Leaky Spec", version: "1" },
        paths: {
          "/login": {
            post: {
              summary: "Log in",
              requestBody: {
                content: {
                  "application/json": { example: { username: "alice", password: CANARY_PASSWORD } },
                },
              },
              responses: {
                "200": {
                  description: "OK.",
                  content: {
                    "application/json": {
                      example: { access_token: CANARY_BEARER_TOKEN, refresh_token: CANARY_BEARER_TOKEN },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      collection: undefined,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    expectNoCanaries(documentation);
  });

  it("emits no canary from a schema default or example", () => {
    const documentation = generate({
      specificationSource: JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Leaky Defaults", version: "1" },
        paths: {
          "/things": {
            get: {
              parameters: [
                {
                  name: "api_key",
                  in: "query",
                  schema: { type: "string", default: CANARY_API_KEY },
                  example: CANARY_API_KEY,
                },
              ],
              responses: {},
            },
          },
        },
      }),
      collection: undefined,
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    expectNoCanaries(documentation);
  });
});

describe("placeholders survive where credentials do not (spec §16)", () => {
  it("publishes {{token}} rather than removing it", () => {
    const documentation = generate({
      specificationSource: undefined,
      collection: createCollectionSource([
        createCollectionRequest({
          url: "{{baseUrl}}/orders",
          headers: [{ name: "Authorization", value: "Bearer {{token}}" }],
          body: JSON.stringify({ access_token: "{{token}}" }),
          contentType: "application/json",
          auth: { type: "bearer", location: undefined, parameterName: undefined },
        }),
      ]),
      grouping: "auto",
      includeCollectionExamples: true,
      coverage: undefined,
      drift: undefined,
      generatedAt: undefined,
    });
    const html = renderDocumentation(documentation, "html", RENDER_OPTIONS).content;
    // The useful documentation, not an incident.
    expect(html).toContain("{{token}}");
    expect(html).not.toContain("{{redacted}}");
  });
});

describe("the canary suite itself is sound", () => {
  it("would catch a leak — an unredacted body does contain its canary", () => {
    // A negative control. Without this, a bug that made `expectNoCanaries`
    // vacuous would go unnoticed.
    const raw = JSON.stringify({ password: CANARY_PASSWORD, cookie: CANARY_COOKIE });
    expect(raw).toContain(CANARY_PASSWORD);
    expect(ALL_CANARIES.some((canary) => raw.includes(canary))).toBe(true);
  });
});
