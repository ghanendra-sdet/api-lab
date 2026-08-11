import { describe, expect, it } from "vitest";
import { classifyStatus, classifyTransportError } from "./classify.ts";

describe("classifyStatus", () => {
  it("treats 1xx/2xx/3xx as successful outcomes", () => {
    expect(classifyStatus(200)).toBeNull();
    expect(classifyStatus(201)).toBeNull();
    expect(classifyStatus(204)).toBeNull();
    expect(classifyStatus(301)).toBeNull();
  });

  it("separates 4xx from 5xx", () => {
    expect(classifyStatus(400)).toBe("http4xx");
    expect(classifyStatus(401)).toBe("http4xx");
    expect(classifyStatus(429)).toBe("http4xx");
    expect(classifyStatus(500)).toBe("http5xx");
    expect(classifyStatus(503)).toBe("http5xx");
  });
});

describe("classifyTransportError", () => {
  const normal = { timedOut: false, cancelled: false };

  it("prefers the caller's explicit timeout signal over the error shape", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyTransportError(abort, { timedOut: true, cancelled: false })).toBe("timeout");
  });

  it("prefers the caller's explicit cancellation signal", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyTransportError(abort, { timedOut: false, cancelled: true })).toBe("cancelled");
  });

  it("classifies refused and reset connections as connection failures", () => {
    expect(classifyTransportError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }), normal)).toBe("connection");
    expect(classifyTransportError(Object.assign(new Error("x"), { code: "ECONNRESET" }), normal)).toBe("connection");
  });

  it("reads the error code from a nested cause, as Node's fetch reports it", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(classifyTransportError(err, normal)).toBe("connection");
  });

  it("classifies DNS failures as network errors", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" });
    expect(classifyTransportError(err, normal)).toBe("network");
  });

  it("classifies undici header/body timeouts as timeouts", () => {
    expect(classifyTransportError(Object.assign(new Error("x"), { code: "UND_ERR_HEADERS_TIMEOUT" }), normal)).toBe(
      "timeout",
    );
  });

  it("falls back to a plain TypeError being a network error", () => {
    expect(classifyTransportError(new TypeError("fetch failed"), normal)).toBe("network");
  });

  it("classifies anything else as a client-side execution error rather than guessing", () => {
    expect(classifyTransportError(new Error("something odd"), normal)).toBe("client");
    expect(classifyTransportError("not an error at all", normal)).toBe("client");
    expect(classifyTransportError(null, normal)).toBe("client");
  });

  it("does not loop forever on a self-referencing cause chain", () => {
    const err = new Error("looped") as Error & { cause?: unknown };
    err.cause = err;
    expect(classifyTransportError(err, normal)).toBe("client");
  });
});
