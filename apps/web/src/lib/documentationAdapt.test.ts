import { describe, expect, it } from "vitest";
import type { AuthConfig } from "@api-lab/auth-engine";
import type { Collection, RequestConfig, SavedRequest } from "@api-lab/workspace-engine";
import type { KeyValueRow } from "@api-lab/shared";
import { collectionToDocSource, describeAuth, withRecordedResponse } from "./documentationAdapt";

const CANARY_TOKEN = "CANARY-BEARER-9f83ba21c0d74e5aa1b2c3d4e5f60718";
const CANARY_PASSWORD = "CANARY-PASSWORD-abcdef0123456789";
const CANARY_API_KEY = "CANARY-APIKEY-4d5e6f708192a3b4c5d6e7f809102132";

function row(key: string, value: string, enabled = true): KeyValueRow {
  return { id: `${key}-${value}`, key, value, enabled };
}

function requestConfig(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    method: "GET",
    url: "https://api.example.com/orders",
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

function savedRequest(name: string, config: RequestConfig, id = "r1"): SavedRequest {
  return {
    id,
    type: "request",
    name,
    request: config,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function collection(items: Collection["items"]): Collection {
  return {
    id: "col-1",
    name: "Orders",
    description: "Saved requests.",
    items,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("describeAuth — the credential boundary", () => {
  it("describes bearer auth without carrying the token", () => {
    const auth: AuthConfig = { type: "bearer", token: CANARY_TOKEN };
    const described = describeAuth(auth);
    expect(described).toEqual({
      type: "bearer",
      location: "header",
      parameterName: "Authorization",
    });
    // The structural guarantee: there is nowhere in the result to put a token.
    expect(JSON.stringify(described)).not.toContain(CANARY_TOKEN);
  });

  it("describes basic auth without carrying the password", () => {
    const described = describeAuth({ type: "basic", username: "alice", password: CANARY_PASSWORD });
    expect(JSON.stringify(described)).not.toContain(CANARY_PASSWORD);
    expect(JSON.stringify(described)).not.toContain("alice");
  });

  it("keeps an API key's header name but not its value", () => {
    const described = describeAuth({
      type: "apiKey",
      key: "X-API-Key",
      value: CANARY_API_KEY,
      addTo: "header",
    });
    // The name is diagnostic and not secret — a reader needs it.
    expect(described.parameterName).toBe("X-API-Key");
    expect(described.location).toBe("header");
    expect(JSON.stringify(described)).not.toContain(CANARY_API_KEY);
  });

  it("describes a query-located API key", () => {
    const described = describeAuth({ type: "apiKey", key: "api_key", value: CANARY_API_KEY, addTo: "query" });
    expect(described.location).toBe("query");
  });

  it("treats jwt as bearer, which is what it is on the wire", () => {
    expect(describeAuth({ type: "jwt", token: CANARY_TOKEN }).type).toBe("bearer");
  });

  it("describes none and oauth2", () => {
    expect(describeAuth({ type: "none" }).type).toBe("none");
    expect(describeAuth({ type: "oauth2" }).type).toBe("oauth2");
  });

  it("omits an empty API key name rather than documenting a blank header", () => {
    expect(describeAuth({ type: "apiKey", key: "  ", value: "x", addTo: "header" }).parameterName)
      .toBeUndefined();
  });
});

describe("collectionToDocSource", () => {
  it("flattens folder and top-level requests, recording the folder name", () => {
    const source = collectionToDocSource(
      collection([
        savedRequest("List orders", requestConfig(), "r1"),
        {
          id: "f1",
          type: "folder",
          name: "Admin",
          items: [savedRequest("Delete order", requestConfig({ method: "DELETE" }), "r2")],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );

    expect(source.name).toBe("Orders");
    expect(source.requests).toHaveLength(2);
    expect(source.requests[0]).toMatchObject({ name: "List orders", folderName: undefined });
    expect(source.requests[1]).toMatchObject({ name: "Delete order", folderName: "Admin" });
  });

  it("leaves {{variables}} unresolved, which is what documentation wants", () => {
    // Spec §16 — the opposite of what contractAdapt.ts does, deliberately.
    const source = collectionToDocSource(
      collection([
        savedRequest(
          "Get order",
          requestConfig({
            url: "{{baseUrl}}/orders/{{orderId}}",
            headers: [row("Authorization", "Bearer {{token}}")],
          }),
        ),
      ]),
    );
    expect(source.requests[0]?.url).toBe("{{baseUrl}}/orders/{{orderId}}");
    expect(source.requests[0]?.headers[0]?.value).toBe("Bearer {{token}}");
  });

  it("drops disabled and unnamed rows", () => {
    const source = collectionToDocSource(
      collection([
        savedRequest(
          "List",
          requestConfig({
            params: [row("status", "open"), row("hidden", "x", false), row("  ", "y")],
            headers: [row("X-Tenant", "acme"), row("X-Off", "z", false)],
          }),
        ),
      ]),
    );
    expect(source.requests[0]?.queryParams).toEqual([{ name: "status", value: "open" }]);
    expect(source.requests[0]?.headers).toEqual([{ name: "X-Tenant", value: "acme" }]);
  });

  it("carries a body and infers its content type", () => {
    const source = collectionToDocSource(
      collection([
        savedRequest(
          "Create",
          requestConfig({ method: "POST", bodyMode: "raw", bodyRawFormat: "JSON", bodyRawContent: '{"a":1}' }),
        ),
      ]),
    );
    expect(source.requests[0]?.body).toBe('{"a":1}');
    expect(source.requests[0]?.contentType).toBe("application/json");
  });

  it("prefers an explicit Content-Type header over the body format", () => {
    const source = collectionToDocSource(
      collection([
        savedRequest(
          "Create",
          requestConfig({
            bodyMode: "raw",
            bodyRawFormat: "JSON",
            bodyRawContent: "x",
            headers: [row("Content-Type", "application/vnd.api+json")],
          }),
        ),
      ]),
    );
    expect(source.requests[0]?.contentType).toBe("application/vnd.api+json");
  });

  it("treats a whitespace-only body as no body", () => {
    const source = collectionToDocSource(
      collection([
        savedRequest("Create", requestConfig({ bodyMode: "raw", bodyRawContent: "   " })),
      ]),
    );
    expect(source.requests[0]?.body).toBeUndefined();
    expect(source.requests[0]?.contentType).toBeUndefined();
  });

  it("attaches no recorded responses automatically (spec §18)", () => {
    const source = collectionToDocSource(collection([savedRequest("List", requestConfig())]));
    expect(source.requests[0]?.recordedResponses).toEqual([]);
  });

  it("never carries a credential through, whatever the auth type", () => {
    const source = collectionToDocSource(
      collection([
        savedRequest("A", requestConfig({ auth: { type: "bearer", token: CANARY_TOKEN } }), "r1"),
        savedRequest(
          "B",
          requestConfig({ auth: { type: "basic", username: "u", password: CANARY_PASSWORD } }),
          "r2",
        ),
        savedRequest(
          "C",
          requestConfig({ auth: { type: "apiKey", key: "k", value: CANARY_API_KEY, addTo: "header" } }),
          "r3",
        ),
      ]),
    );
    const serialized = JSON.stringify(source);
    for (const canary of [CANARY_TOKEN, CANARY_PASSWORD, CANARY_API_KEY]) {
      expect(serialized).not.toContain(canary);
    }
  });
});

describe("withRecordedResponse (spec §18)", () => {
  it("attaches a response to exactly the named request", () => {
    const source = collectionToDocSource(
      collection([
        savedRequest("A", requestConfig(), "r1"),
        savedRequest("B", requestConfig(), "r2"),
      ]),
    );

    const updated = withRecordedResponse(source, "r2", {
      status: 200,
      contentType: "application/json",
      headers: [],
      body: '{"ok":true}',
      origin: "mock",
    });

    expect(updated.requests[0]?.recordedResponses).toEqual([]);
    expect(updated.requests[1]?.recordedResponses).toHaveLength(1);
    expect(updated.requests[1]?.recordedResponses[0]?.origin).toBe("mock");
  });

  it("leaves the original source untouched", () => {
    const source = collectionToDocSource(collection([savedRequest("A", requestConfig(), "r1")]));
    withRecordedResponse(source, "r1", {
      status: 200,
      contentType: undefined,
      headers: [],
      body: undefined,
      origin: "collection",
    });
    expect(source.requests[0]?.recordedResponses).toEqual([]);
  });
});
