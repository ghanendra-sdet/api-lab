import { describe, expect, it } from "vitest";
import { collectExtractedVariables, collectPlaceholders, specHasPlaceholder, substituteRuntimeVariables } from "./substitute.ts";
import type { PerfRequestSpec } from "./types.ts";

function spec(overrides: Partial<PerfRequestSpec> = {}): PerfRequestSpec {
  return {
    id: "r1",
    name: "Get Balance",
    method: "GET",
    url: "http://localhost:4010/balance",
    headers: {},
    body: null,
    extractions: [],
    ...overrides,
  };
}

describe("substituteRuntimeVariables", () => {
  it("substitutes runtime variables into the URL, headers and body", () => {
    const input = spec({
      url: "http://localhost:4010/users/{{userId}}",
      headers: { Authorization: "Bearer {{token}}" },
      body: '{"session":"{{token}}"}',
    });
    const result = substituteRuntimeVariables(input, { token: "abc123", userId: "42" });
    expect(result.url).toBe("http://localhost:4010/users/42");
    expect(result.headers.Authorization).toBe("Bearer abc123");
    expect(result.body).toBe('{"session":"abc123"}');
  });

  it("never mutates the input spec — the template stays reusable per user", () => {
    const input = spec({ url: "http://x/{{token}}" });
    substituteRuntimeVariables(input, { token: "one" });
    expect(input.url).toBe("http://x/{{token}}");
    expect(substituteRuntimeVariables(input, { token: "two" }).url).toBe("http://x/two");
  });

  it("gives each virtual user its own values — no cross-VU leakage", () => {
    const input = spec({ headers: { Authorization: "Bearer {{token}}" } });
    const vu1 = substituteRuntimeVariables(input, { token: "vu1-token" });
    const vu2 = substituteRuntimeVariables(input, { token: "vu2-token" });
    expect(vu1.headers.Authorization).toBe("Bearer vu1-token");
    expect(vu2.headers.Authorization).toBe("Bearer vu2-token");
  });

  it("leaves unknown placeholders literal rather than substituting an empty string", () => {
    const result = substituteRuntimeVariables(spec({ url: "http://x/{{missing}}" }), {});
    expect(result.url).toBe("http://x/{{missing}}");
  });

  it("returns the identical object when there is nothing to substitute", () => {
    const input = spec();
    expect(substituteRuntimeVariables(input, { token: "x" })).toBe(input);
  });

  it("substitutes header keys as well as values", () => {
    const result = substituteRuntimeVariables(spec({ headers: { "{{hname}}": "v" } }), { hname: "X-Trace" });
    expect(result.headers["X-Trace"]).toBe("v");
  });
});

describe("specHasPlaceholder", () => {
  it("detects placeholders anywhere in the spec", () => {
    expect(specHasPlaceholder(spec())).toBe(false);
    expect(specHasPlaceholder(spec({ url: "http://x/{{a}}" }))).toBe(true);
    expect(specHasPlaceholder(spec({ body: "{{a}}" }))).toBe(true);
    expect(specHasPlaceholder(spec({ headers: { A: "{{a}}" } }))).toBe(true);
    expect(specHasPlaceholder(spec({ headers: { "{{a}}": "v" } }))).toBe(true);
  });
});

describe("chain validation helpers", () => {
  it("collects every remaining placeholder across specs", () => {
    const specs = [spec({ url: "http://x/{{a}}" }), spec({ headers: { H: "{{b}} {{a}}" } })];
    expect(collectPlaceholders(specs).sort()).toEqual(["a", "b"]);
  });

  it("collects enabled extraction variable names", () => {
    const specs = [
      spec({
        extractions: [
          { id: "e1", source: "json", path: "$.token", variable: "token", enabled: true },
          { id: "e2", source: "json", path: "$.x", variable: "ignored", enabled: false },
        ],
      }),
    ];
    expect(collectExtractedVariables(specs)).toEqual(["token"]);
  });

  it("lets the caller detect a placeholder no extraction ever produces", () => {
    const specs = [spec({ url: "http://x/{{token}}" })];
    const unsatisfied = collectPlaceholders(specs).filter((n) => !collectExtractedVariables(specs).includes(n));
    expect(unsatisfied).toEqual(["token"]);
  });
});
