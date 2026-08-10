import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserFetchExecutor } from "./BrowserFetchExecutor";
import type { BuiltRequest } from "../types";

const baseRequest: BuiltRequest = {
  url: "https://example.com/users",
  method: "GET",
  headers: { Accept: "application/json" },
  body: undefined,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrowserFetchExecutor", () => {
  it("calls fetch with the exact method, URL, headers, and body", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const executor = new BrowserFetchExecutor();
    await executor.execute({
      url: "https://example.com/users",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"name":"test"}',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/users");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(init?.body).toBe('{"name":"test"}');
  });

  it("omits the body for GET/HEAD even if one was built", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const executor = new BrowserFetchExecutor();
    await executor.execute({ ...baseRequest, method: "GET", body: "should not be sent" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.body).toBeUndefined();
  });

  it("returns a normalized successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"id":1}', { status: 201, headers: { "content-type": "application/json" } })),
    );

    const executor = new BrowserFetchExecutor();
    const result = await executor.execute(baseRequest);

    expect(result.status).toBe(201);
    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ id: 1 });
    expect(result.error).toBeNull();
  });

  it("converts a network failure into a friendly error result instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const executor = new BrowserFetchExecutor();
    const result = await executor.execute(baseRequest);

    expect(result.status).toBeNull();
    expect(result.error).toMatch(/Unable to complete the request/);
  });

  it("reports a cancelled request distinctly from a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new DOMException("Aborted", "AbortError");
        throw err;
      }),
    );

    const executor = new BrowserFetchExecutor();
    const result = await executor.execute(baseRequest);

    expect(result.error).toBe("Request was cancelled.");
  });
});
