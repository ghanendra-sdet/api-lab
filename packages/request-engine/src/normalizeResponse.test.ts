import { describe, expect, it } from "vitest";
import { normalizeResponse, errorResponse } from "./normalizeResponse";

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function makeResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return new Response(NULL_BODY_STATUSES.has(status) ? null : body, {
    status,
    headers: init.headers,
  });
}

describe("normalizeResponse", () => {
  it("parses a JSON body", async () => {
    const res = makeResponse('{"id":1,"name":"Test"}', {
      headers: { "content-type": "application/json" },
    });
    const result = await normalizeResponse(res, 42);
    expect(result.bodyKind).toBe("json");
    expect(result.body).toEqual({ id: 1, name: "Test" });
    expect(result.status).toBe(200);
    expect(result.duration).toBe(42);
  });

  it("falls back to text when Content-Type claims JSON but the body doesn't parse", async () => {
    const res = makeResponse("not actually json", {
      headers: { "content-type": "application/json" },
    });
    const result = await normalizeResponse(res, 10);
    expect(result.body).toBe("not actually json");
  });

  it("treats a plain-text response as text", async () => {
    const res = makeResponse("Hello API Lab", { headers: { "content-type": "text/plain" } });
    const result = await normalizeResponse(res, 5);
    expect(result.bodyKind).toBe("text");
    expect(result.body).toBe("Hello API Lab");
  });

  it("classifies an HTML response without parsing it as DOM", async () => {
    const res = makeResponse("<p>hi</p>", { headers: { "content-type": "text/html" } });
    const result = await normalizeResponse(res, 5);
    expect(result.bodyKind).toBe("html");
    expect(result.body).toBe("<p>hi</p>");
    expect(typeof result.body).toBe("string");
  });

  it("handles an empty body (e.g. 204 No Content)", async () => {
    const res = makeResponse("", { status: 204 });
    const result = await normalizeResponse(res, 3);
    expect(result.bodyKind).toBe("empty");
    expect(result.body).toBeNull();
    expect(result.status).toBe(204);
  });

  it("prefers the content-length header for size when present", async () => {
    const res = makeResponse('{"a":1}', {
      headers: { "content-type": "application/json", "content-length": "7" },
    });
    const result = await normalizeResponse(res, 5);
    expect(result.size).toBe(7);
    expect(result.sizeSource).toBe("content-length-header");
  });

  it("falls back to decoded byte length when content-length is absent", async () => {
    const res = new Response('{"a":1}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    res.headers.delete("content-length");
    const result = await normalizeResponse(res, 5);
    expect(result.sizeSource).toBe("decoded-body-bytes");
    expect(result.size).toBeGreaterThan(0);
  });

  it("captures response headers as a plain record", async () => {
    const res = makeResponse("ok", { headers: { "x-request-id": "abc123" } });
    const result = await normalizeResponse(res, 1);
    expect(result.headers["x-request-id"]).toBe("abc123");
  });
});

describe("errorResponse", () => {
  it("produces a normalized error result with no status", () => {
    const result = errorResponse("Network failure", 12);
    expect(result.status).toBeNull();
    expect(result.error).toBe("Network failure");
    expect(result.ok).toBe(false);
    expect(result.duration).toBe(12);
  });
});
