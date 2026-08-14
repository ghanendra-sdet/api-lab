import { describe, expect, it } from "vitest";
import {
  describeSensitiveField,
  isSensitiveFieldName,
  isSensitiveHeaderName,
  maskSecret,
  redactHeaders,
  redactUrl,
  toRedactedPath,
} from "./redact.ts";

describe("isSensitiveFieldName", () => {
  it("matches known sensitive names case- and separator-insensitively", () => {
    for (const name of ["password", "Password", "passwordHash", "password_hash", "accessToken", "access_token", "apiKey", "API-KEY"]) {
      expect(isSensitiveFieldName(name), name).toBe(true);
    }
  });

  it("does not match ordinary field names", () => {
    for (const name of ["username", "email", "id", "passwordPolicy", "keyboard"]) {
      expect(isSensitiveFieldName(name), name).toBe(false);
    }
  });
});

describe("isSensitiveHeaderName", () => {
  it("matches credential-bearing headers", () => {
    expect(isSensitiveHeaderName("Authorization")).toBe(true);
    expect(isSensitiveHeaderName("cookie")).toBe(true);
    expect(isSensitiveHeaderName("X-Api-Key")).toBe(true);
  });

  it("does not match ordinary headers", () => {
    expect(isSensitiveHeaderName("Content-Type")).toBe(false);
  });
});

describe("maskSecret", () => {
  it("keeps at most four leading characters", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("abcd****");
  });

  it("does not disclose the value's length", () => {
    // Token length is a real fingerprint and buys the tester nothing.
    expect(maskSecret("a".repeat(20))).toBe(maskSecret("a".repeat(200)));
  });

  it("fully masks short values", () => {
    expect(maskSecret("abcd")).toBe("****");
  });

  it("distinguishes an empty value", () => {
    expect(maskSecret("")).toBe("(empty)");
  });
});

describe("redactHeaders", () => {
  it("removes sensitive values but keeps their names", () => {
    const result = redactHeaders({ Authorization: "Bearer secret", "Content-Type": "application/json" });
    expect(result["Authorization"]).toBe("(redacted)");
    expect(result["Content-Type"]).toBe("application/json");
  });
});

describe("redactUrl", () => {
  it("strips RFC 3986 userinfo credentials", () => {
    expect(redactUrl("https://user:hunter2@example.com/x")).not.toContain("hunter2");
    expect(redactUrl("https://user:hunter2@example.com/x")).not.toContain("user:");
  });

  it("redacts credential-shaped query parameters", () => {
    const result = redactUrl("https://example.com/x?api_key=abc123&page=2");
    expect(result).not.toContain("abc123");
    expect(result).toContain("page=2");
  });

  it("redacts token and secret parameters by name", () => {
    expect(redactUrl("https://example.com/?access_token=zzz")).not.toContain("zzz");
    expect(redactUrl("https://example.com/?client_secret=zzz")).not.toContain("zzz");
  });

  it("drops the query wholesale when the URL cannot be parsed", () => {
    // Failing closed: never echo a query string we could not parse apart.
    const result = redactUrl("not a url?token=zzz");
    expect(result).not.toContain("zzz");
  });
});

describe("toRedactedPath", () => {
  it("returns path and query without the host", () => {
    expect(toRedactedPath("https://api.example.com/users/1?page=2")).toBe("/users/1?page=2");
  });

  it("never carries a credential through", () => {
    expect(toRedactedPath("https://u:p@api.example.com/users?api_key=zzz")).not.toContain("zzz");
  });
});

describe("describeSensitiveField", () => {
  it("names the location and explicitly withholds the value", () => {
    expect(describeSensitiveField("response.body/password")).toBe("field response.body/password (value withheld)");
  });
});
