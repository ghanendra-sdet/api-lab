import { describe, expect, it } from "vitest";
import type { AuthConfig } from "@api-lab/auth-engine";
import { authPlacementFor, resolveSecurityRequest, toSecurityResponse } from "./securityAdapt";
import type { RequestConfig } from "@api-lab/workspace-engine";
import type { ApiResponseResult } from "@api-lab/request-engine";

function config(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    method: "POST",
    url: "http://localhost:4010/users",
    params: [],
    headers: [{ id: "h1", key: "Content-Type", value: "application/json", enabled: true }],
    auth: { type: "none" },
    bodyMode: "raw",
    bodyRawFormat: "JSON",
    bodyRawContent: '{"name":"Ada"}',
    tests: [],
    extractions: [],
    ...overrides,
  } as RequestConfig;
}

describe("authPlacementFor", () => {
  it("maps bearer and jwt onto the Authorization header", () => {
    expect(authPlacementFor({ type: "bearer", token: "t" })).toEqual({ kind: "header", name: "Authorization", scheme: "bearer" });
    expect(authPlacementFor({ type: "jwt", token: "t" })).toEqual({ kind: "header", name: "Authorization", scheme: "bearer" });
  });

  it("maps basic onto the Authorization header with the basic scheme", () => {
    expect(authPlacementFor({ type: "basic", username: "u", password: "p" })).toEqual({
      kind: "header",
      name: "Authorization",
      scheme: "basic",
    });
  });

  it("maps an API key to its configured location", () => {
    expect(authPlacementFor({ type: "apiKey", key: "X-Api-Key", value: "v", addTo: "header" })).toEqual({
      kind: "header",
      name: "X-Api-Key",
      scheme: "raw",
    });
    expect(authPlacementFor({ type: "apiKey", key: "api_key", value: "v", addTo: "query" })).toEqual({
      kind: "query",
      name: "api_key",
    });
  });

  it("treats an unnamed API key as no credential", () => {
    expect(authPlacementFor({ type: "apiKey", key: "  ", value: "v", addTo: "header" })).toEqual({ kind: "none" });
  });

  it("treats oauth2 as no credential, since it is reserved and not executable", () => {
    expect(authPlacementFor({ type: "oauth2" })).toEqual({ kind: "none" });
  });

  it("never returns the credential value", () => {
    // The placement describes *where* the credential is, never what it is.
    const auth: AuthConfig = { type: "bearer", token: "super-secret" };
    expect(JSON.stringify(authPlacementFor(auth))).not.toContain("super-secret");
  });
});

describe("resolveSecurityRequest", () => {
  it("produces a fully resolved request", () => {
    const result = resolveSecurityRequest("r1", "Create", config(), {}, null);
    expect(result.ok).toBe(true);
    expect(result.request?.url).toBe("http://localhost:4010/users");
    expect(result.request?.body).toBe('{"name":"Ada"}');
    expect(result.request?.contentType).toBe("application/json");
  });

  it("applies auth before the security engine sees the request", () => {
    const result = resolveSecurityRequest(
      "r1",
      "Create",
      config({ auth: { type: "bearer", token: "abc123" } }),
      {},
      null,
    );
    const header = result.request?.headers.find((entry) => entry.name.toLowerCase() === "authorization");
    expect(header?.value).toBe("Bearer abc123");
    expect(result.request?.auth).toEqual({ kind: "header", name: "Authorization", scheme: "bearer" });
  });

  it("substitutes environment variables before mutation", () => {
    // Mutating `{{host}}` would produce a test that proves nothing.
    const result = resolveSecurityRequest(
      "r1",
      "Create",
      config({ url: "http://localhost:4010/{{resource}}" }),
      {
        environment: {
          id: "e1",
          name: "local",
          variables: [{ id: "v1", key: "resource", value: "users", enabled: true, secret: false }],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      null,
    );
    expect(result.request?.url).toBe("http://localhost:4010/users");
  });

  it("reports a resolution failure rather than sending an unresolved request", () => {
    const result = resolveSecurityRequest("r1", "Create", config({ url: "http://x/{{missing}}" }), {}, null);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("missing");
  });

  it("mirrors the query string from the URL", () => {
    const result = resolveSecurityRequest("r1", "Create", config({ url: "http://localhost:4010/users?a=1&b=2" }), {}, null);
    expect(result.request?.query).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
  });

  it("leaves pathTemplate undefined without a contract", () => {
    expect(resolveSecurityRequest("r1", "Create", config(), {}, null).request?.pathTemplate).toBeUndefined();
  });
});

describe("toSecurityResponse", () => {
  it("adapts the request engine's response shape", () => {
    const response: ApiResponseResult = {
      status: 400,
      statusText: "Bad Request",
      ok: false,
      headers: { "content-type": "application/json" },
      body: {},
      rawBody: "{}",
      bodyKind: "json",
      duration: 12,
      size: 2,
      sizeSource: "decoded-body-bytes",
      error: null,
    };

    expect(toSecurityResponse(response)).toEqual({
      status: 400,
      headers: { "content-type": "application/json" },
      rawBody: "{}",
      durationMs: 12,
      error: null,
    });
  });
});
