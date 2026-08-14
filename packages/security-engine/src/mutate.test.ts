import { describe, expect, it } from "vitest";
import { applyMutation, locatePathParameter } from "./mutate.ts";
import { EXPIRED_JWT, INVALID_BEARER_TOKEN, MALFORMED_TOKEN, WRONG_API_KEY } from "./credentials.ts";
import { makeRequest } from "./testFixtures.ts";
import type { Mutation } from "./types.ts";

function mutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    location: "request.body",
    operation: "remove",
    target: "/name",
    value: { kind: "none" },
    description: "test mutation",
    ...overrides,
  };
}

describe("applyMutation — purity", () => {
  it("never modifies the input request", () => {
    // A mutation applier that mutated its argument would make a credential
    // removed for test 4 stay removed for tests 5-100.
    const request = makeRequest();
    const before = JSON.stringify(request);

    applyMutation(request, mutation());

    expect(JSON.stringify(request)).toBe(before);
  });
});

describe("applyMutation — body", () => {
  it("removes a field", () => {
    const result = applyMutation(makeRequest(), mutation({ operation: "remove", target: "/name" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.request.body!)).toEqual({ age: 36, role: "admin" });
  });

  it("replaces a field with a wrong-typed value", () => {
    const result = applyMutation(
      makeRequest(),
      mutation({ operation: "set-wrong-type", target: "/age", value: { kind: "json", json: "invalid" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.request.body!).age).toBe("invalid");
  });

  it("sets a field to null", () => {
    const result = applyMutation(
      makeRequest(),
      mutation({ operation: "set-null", target: "/name", value: { kind: "json", json: null } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.request.body!).name).toBeNull();
  });

  it("fails rather than silently no-opping when the field is absent", () => {
    // A silent no-op would send the original request and then report PASS
    // against expectations written for a mutation that never happened.
    const result = applyMutation(makeRequest(), mutation({ target: "/missing" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("/missing");
  });

  it("truncates the body for a malformed-JSON mutation", () => {
    const result = applyMutation(makeRequest(), mutation({ operation: "malform-json", target: "" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(() => JSON.parse(result.request.body!)).toThrow();
      // Derived by deletion from the user's own body — nothing injected.
      expect(makeRequest().body!.startsWith(result.request.body!)).toBe(true);
    }
  });

  it("fails when the body is not JSON", () => {
    const result = applyMutation(makeRequest({ body: "plain text" }), mutation({ target: "/name" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("not valid JSON");
  });

  it("fails when there is no body at all", () => {
    const result = applyMutation(makeRequest({ body: undefined }), mutation());
    expect(result.ok).toBe(false);
  });
});

describe("applyMutation — query", () => {
  const request = makeRequest({ url: "http://localhost:4010/users?tenant=7&page=2" });

  it("removes a query parameter and keeps the mirror in sync", () => {
    const result = applyMutation(request, mutation({ location: "request.query", operation: "remove", target: "tenant" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.url).not.toContain("tenant");
      expect(result.request.query.map((entry) => entry.name)).toEqual(["page"]);
    }
  });

  it("replaces a query parameter value", () => {
    const result = applyMutation(
      request,
      mutation({ location: "request.query", operation: "set-wrong-type", target: "tenant", value: { kind: "text", text: "abc" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.query.find((entry) => entry.name === "tenant")?.value).toBe("abc");
  });

  it("fails when removing a parameter that is not present", () => {
    const result = applyMutation(request, mutation({ location: "request.query", operation: "remove", target: "absent" }));
    expect(result.ok).toBe(false);
  });
});

describe("applyMutation — headers", () => {
  it("removes a header", () => {
    const result = applyMutation(
      makeRequest(),
      mutation({ location: "request.header", operation: "remove", target: "Content-Type" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.headers.some((header) => header.name === "Content-Type")).toBe(false);
      // contentType mirror must follow the header list.
      expect(result.request.contentType).toBeUndefined();
    }
  });

  it("replaces the content type", () => {
    const result = applyMutation(
      makeRequest(),
      mutation({
        location: "request.header",
        operation: "set-content-type",
        target: "Content-Type",
        value: { kind: "text", text: "application/x-weird" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.contentType).toBe("application/x-weird");
  });

  it("introduces a header that was not present", () => {
    const result = applyMutation(
      makeRequest(),
      mutation({ location: "request.header", operation: "set-content-type", target: "X-New", value: { kind: "text", text: "v" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.headers.find((header) => header.name === "X-New")?.value).toBe("v");
  });

  it("matches header names case-insensitively", () => {
    const result = applyMutation(
      makeRequest(),
      mutation({ location: "request.header", operation: "remove", target: "content-type" }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("locatePathParameter", () => {
  it("aligns the template against the tail of the path", () => {
    // A server base path the template does not repeat is the common case.
    const located = locatePathParameter("/api/v2/users/42", "/users/{id}", "id");
    expect(located).not.toBeNull();
    expect(located!.segments[located!.index]).toBe("42");
  });

  it("aligns a template with no base path", () => {
    const located = locatePathParameter("/users/42", "/users/{id}", "id");
    expect(located!.segments[located!.index]).toBe("42");
  });

  it("returns null when a literal segment disagrees", () => {
    expect(locatePathParameter("/accounts/42", "/users/{id}", "id")).toBeNull();
  });

  it("returns null when the parameter is not in the template", () => {
    expect(locatePathParameter("/users/42", "/users/{id}", "other")).toBeNull();
  });

  it("returns null when the path is shorter than the template", () => {
    expect(locatePathParameter("/users", "/api/users/{id}", "id")).toBeNull();
  });
});

describe("applyMutation — path", () => {
  const request = makeRequest({
    method: "GET",
    url: "http://localhost:4010/users/42",
    pathTemplate: "/users/{id}",
    body: undefined,
  });

  it("replaces the path parameter segment", () => {
    const result = applyMutation(
      request,
      mutation({ location: "request.path", operation: "set-wrong-type", target: "id", value: { kind: "text", text: "abc" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(new URL(result.request.url).pathname).toBe("/users/abc");
  });

  it("percent-encodes the replacement so the path structure cannot be changed", () => {
    const result = applyMutation(
      request,
      mutation({ location: "request.path", operation: "set-wrong-type", target: "id", value: { kind: "text", text: "a/b" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(new URL(result.request.url).pathname).toBe("/users/a%2Fb");
  });

  it("fails without a matched contract operation", () => {
    const result = applyMutation(
      makeRequest({ pathTemplate: undefined }),
      mutation({ location: "request.path", target: "id", value: { kind: "text", text: "abc" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("contract operation");
  });
});

describe("applyMutation — authentication", () => {
  function authMutation(kind: Parameters<typeof applyMutation>[1]["value"] extends never ? never : "none" | "invalid-token" | "expired-token" | "malformed-token" | "wrong-api-key" | "missing-api-key"): Mutation {
    return mutation({ location: "request.auth", operation: "set-invalid-auth", target: "", value: { kind: "auth", auth: kind } });
  }

  it("removes the Authorization header entirely", () => {
    const result = applyMutation(makeRequest(), authMutation("none"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.headers.some((header) => header.name === "Authorization")).toBe(false);
  });

  it("replaces the credential with a fixed non-authentic constant", () => {
    const result = applyMutation(makeRequest(), authMutation("invalid-token"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const header = result.request.headers.find((entry) => entry.name === "Authorization")!;
      expect(header.value).toBe(`Bearer ${INVALID_BEARER_TOKEN}`);
      // The real credential must never survive into the mutated request.
      expect(header.value).not.toContain("real-secret-token-value");
    }
  });

  it("uses the precomputed expired JWT for bearer schemes", () => {
    const result = applyMutation(makeRequest(), authMutation("expired-token"));
    if (result.ok) expect(result.request.headers.find((h) => h.name === "Authorization")!.value).toBe(`Bearer ${EXPIRED_JWT}`);
  });

  it("uses a structurally invalid token for the malformed case", () => {
    const result = applyMutation(makeRequest(), authMutation("malformed-token"));
    if (result.ok) expect(result.request.headers.find((h) => h.name === "Authorization")!.value).toContain(MALFORMED_TOKEN);
  });

  it("replaces an API key carried in the query string", () => {
    const request = makeRequest({
      url: "http://localhost:4010/users?api_key=real-key",
      auth: { kind: "query", name: "api_key" },
    });
    const result = applyMutation(request, authMutation("wrong-api-key"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.url).toContain(encodeURIComponent(WRONG_API_KEY));
      expect(result.request.url).not.toContain("real-key");
    }
  });

  it("removes an API key carried in the query string", () => {
    const request = makeRequest({
      url: "http://localhost:4010/users?api_key=real-key",
      auth: { kind: "query", name: "api_key" },
    });
    const result = applyMutation(request, authMutation("missing-api-key"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.url).not.toContain("api_key");
  });

  it("fails when the request carries no credential", () => {
    // Reaching this means the request changed between generation and
    // execution; sending it anyway would produce a meaningless PASS.
    const result = applyMutation(makeRequest({ auth: { kind: "none" } }), authMutation("none"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("no authentication");
  });

  it("fails when the expected auth header is missing from the built request", () => {
    const request = makeRequest({ headers: [{ name: "Content-Type", value: "application/json" }] });
    const result = applyMutation(request, authMutation("none"));
    expect(result.ok).toBe(false);
  });
});
