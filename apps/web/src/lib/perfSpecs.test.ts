import { describe, expect, it } from "vitest";
import type { Environment } from "@api-lab/environment-engine";
import type { RequestConfig } from "@api-lab/workspace-engine";
import { buildPerfSpecs, targetUrls } from "./perfSpecs";
import type { RunnableRequest } from "./runner";

function config(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    method: "GET",
    url: "http://localhost:4010/health",
    params: [],
    headers: [],
    auth: { type: "none" },
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    tests: [],
    extractions: [],
    ...overrides,
  };
}

function runnable(name: string, request: RequestConfig): RunnableRequest {
  return { id: `id-${name}`, name, location: { collectionId: "c1" }, request };
}

function environment(variables: Array<{ key: string; value: string; secret?: boolean }>): Environment {
  return {
    id: "env-1",
    name: "Testing",
    variables: variables.map((v, i) => ({
      id: `v${i}`,
      key: v.key,
      value: v.value,
      secret: v.secret ?? false,
      enabled: true,
    })),
  } as Environment;
}

describe("buildPerfSpecs — environment resolution", () => {
  it("resolves environment variables into the URL at execution time", () => {
    const result = buildPerfSpecs(
      [runnable("Health", config({ url: "{{baseUrl}}/health" }))],
      environment([{ key: "baseUrl", value: "http://localhost:4010" }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.specs[0]!.url).toBe("http://localhost:4010/health");
  });

  it("does not mutate the saved request — its template survives the build", () => {
    const saved = config({ url: "{{baseUrl}}/health" });
    buildPerfSpecs([runnable("Health", saved)], environment([{ key: "baseUrl", value: "http://localhost:4010" }]));
    expect(saved.url).toBe("{{baseUrl}}/health");
  });

  it("rejects a variable that no environment defines and no request extracts", () => {
    const result = buildPerfSpecs([runnable("Health", config({ url: "{{baseUrl}}/health" }))], undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/\{\{baseUrl\}\}/);
  });

  it("merges query parameters into the resolved URL", () => {
    const result = buildPerfSpecs(
      [
        runnable(
          "Search",
          config({ params: [{ id: "p1", key: "q", value: "{{term}}", enabled: true }] }),
        ),
      ],
      environment([{ key: "term", value: "widgets" }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.specs[0]!.url).toContain("q=widgets");
  });
});

describe("buildPerfSpecs — authorization", () => {
  it("applies bearer auth as a real header the worker will replay", () => {
    const result = buildPerfSpecs(
      [runnable("Secure", config({ auth: { type: "bearer", token: "{{apiToken}}" } as RequestConfig["auth"] }))],
      environment([{ key: "apiToken", value: "secret-token", secret: true }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const authHeader = Object.entries(result.specs[0]!.headers).find(([k]) => k.toLowerCase() === "authorization");
    expect(authHeader?.[1]).toBe("Bearer secret-token");
  });

  it("applies API key auth", () => {
    const result = buildPerfSpecs(
      [
        runnable(
          "Keyed",
          config({ auth: { type: "apiKey", key: "X-Api-Key", value: "abc", addTo: "header" } as RequestConfig["auth"] }),
        ),
      ],
      undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.entries(result.specs[0]!.headers).some(([k, v]) => k === "X-Api-Key" && v === "abc")).toBe(true);
  });

  it("reports an invalid auth configuration instead of load testing with a broken header", () => {
    const result = buildPerfSpecs(
      [runnable("Broken", config({ auth: { type: "bearer", token: "" } as RequestConfig["auth"] }))],
      undefined,
    );
    expect(result.ok).toBe(false);
  });
});

describe("buildPerfSpecs — chaining placeholders", () => {
  const login = config({
    url: "http://localhost:4010/login",
    extractions: [{ id: "e1", source: "json", path: "$.token", variable: "token", enabled: true }],
  });
  const secured = config({
    url: "http://localhost:4010/me",
    headers: [{ id: "h1", key: "Authorization", value: "Bearer {{token}}", enabled: true }],
  });

  it("passes a runtime placeholder through untouched for per-user substitution", () => {
    const result = buildPerfSpecs([runnable("Login", login), runnable("Me", secured)], undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const authHeader = Object.entries(result.specs[1]!.headers).find(([k]) => k.toLowerCase() === "authorization");
    expect(authHeader?.[1]).toBe("Bearer {{token}}");
    expect(result.specs[0]!.extractions).toHaveLength(1);
  });

  it("rejects a chained placeholder when the producing request is not part of the run", () => {
    const result = buildPerfSpecs([runnable("Me", secured)], undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/\{\{token\}\}/);
  });

  it("does not URL-validate a URL that still contains a runtime placeholder", () => {
    const templated = config({
      url: "http://localhost:4010/users/{{userId}}",
      extractions: [],
    });
    const producer = config({
      url: "http://localhost:4010/login",
      extractions: [{ id: "e1", source: "json", path: "$.id", variable: "userId", enabled: true }],
    });
    const result = buildPerfSpecs([runnable("Login", producer), runnable("User", templated)], undefined);
    expect(result.ok).toBe(true);
  });
});

describe("buildPerfSpecs — target safety", () => {
  it("refuses a non-http target", () => {
    const result = buildPerfSpecs([runnable("Bad", config({ url: "ftp://example.com/x" }))], undefined);
    expect(result.ok).toBe(false);
  });

  it("refuses a relative URL", () => {
    const result = buildPerfSpecs([runnable("Bad", config({ url: "/relative" }))], undefined);
    expect(result.ok).toBe(false);
  });

  it("only ever produces the URLs the user configured", () => {
    const result = buildPerfSpecs(
      [runnable("A", config({ url: "http://localhost:4010/a" })), runnable("B", config({ url: "http://localhost:4010/b" }))],
      undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(targetUrls(result.specs)).toEqual(["http://localhost:4010/a", "http://localhost:4010/b"]);
  });
});

describe("buildPerfSpecs — no secret leakage into persisted shapes", () => {
  it("returns specs that exist only in memory and carry no environment object", () => {
    const result = buildPerfSpecs(
      [runnable("Secure", config({ auth: { type: "bearer", token: "{{apiToken}}" } as RequestConfig["auth"] }))],
      environment([{ key: "apiToken", value: "secret-token", secret: true }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The spec carries the resolved header (it must, to be replayed), but no
    // environment, no variable map, and nothing that the config persistence
    // layer ever writes.
    expect(Object.keys(result.specs[0]!).sort()).toEqual(
      ["body", "extractions", "headers", "id", "method", "name", "url"].sort(),
    );
  });
});
