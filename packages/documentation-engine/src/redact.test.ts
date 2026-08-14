import { describe, expect, it } from "vitest";
import {
  REDACTED,
  capText,
  isCredentialName,
  isPlaceholderOnly,
  looksLikePlaceholder,
  redactNamedValue,
  redactDocUrl,
  redactExampleBody,
  redactExampleHeaders,
  redactHeaderValue,
} from "./redact.ts";
import {
  CANARY_API_KEY,
  CANARY_BEARER_TOKEN,
  CANARY_COOKIE,
  CANARY_PASSWORD,
} from "./testFixtures.ts";

describe("looksLikePlaceholder", () => {
  it("accepts a whole-value placeholder", () => {
    expect(looksLikePlaceholder("{{token}}")).toBe(true);
    expect(looksLikePlaceholder("  {{apiKey}}  ")).toBe(true);
  });

  it("rejects a value that merely starts with a placeholder", () => {
    // The attack: `{{x}}` as a prefix earning an exemption for the real token
    // that follows it.
    expect(looksLikePlaceholder(`{{x}}${CANARY_BEARER_TOKEN}`)).toBe(false);
    expect(looksLikePlaceholder(`Bearer {{token}}`)).toBe(false);
  });

  it("rejects plain values", () => {
    expect(looksLikePlaceholder(CANARY_BEARER_TOKEN)).toBe(false);
    expect(looksLikePlaceholder("")).toBe(false);
  });
});

describe("isPlaceholderOnly", () => {
  it("accepts a scheme word followed by a placeholder", () => {
    // The line spec §16 actually wants published.
    expect(isPlaceholderOnly("Bearer {{token}}")).toBe(true);
    expect(isPlaceholderOnly("Basic {{credentials}}")).toBe(true);
    expect(isPlaceholderOnly("bearer {{token}}")).toBe(true);
  });

  it("rejects a scheme word followed by a real credential", () => {
    expect(isPlaceholderOnly(`Bearer ${CANARY_BEARER_TOKEN}`)).toBe(false);
  });

  it("rejects an unlisted scheme word, failing in the safe direction", () => {
    // The allowlist is closed; a scheme we have not listed is redacted rather
    // than trusted.
    expect(isPlaceholderOnly("Negotiate {{token}}")).toBe(false);
  });

  it("rejects anything with more than one credential segment", () => {
    expect(isPlaceholderOnly(`Bearer {{token}} ${CANARY_BEARER_TOKEN}`)).toBe(false);
  });
});

describe("isCredentialName", () => {
  it("recognises credential-shaped names beyond the exact-match list", () => {
    for (const name of ["api_key", "apiKey", "access-token", "clientSecret", "X-API-Key", "password"]) {
      expect(isCredentialName(name), name).toBe(true);
    }
  });

  it("leaves ordinary parameter names alone", () => {
    for (const name of ["status", "limit", "orderId", "monkey", "keyboard"]) {
      expect(isCredentialName(name), name).toBe(false);
    }
  });
});

describe("redactNamedValue", () => {
  it("redacts a credential-named parameter's value", () => {
    expect(redactNamedValue("api_key", CANARY_API_KEY)).toBe(REDACTED);
    expect(redactNamedValue("access_token", CANARY_BEARER_TOKEN)).toBe(REDACTED);
  });

  it("leaves an ordinary parameter's value intact", () => {
    expect(redactNamedValue("status", "shipped")).toBe("shipped");
  });

  it("keeps a placeholder even under a credential name", () => {
    expect(redactNamedValue("api_key", "{{apiKey}}")).toBe("{{apiKey}}");
  });

  it("passes undefined through", () => {
    expect(redactNamedValue("api_key", undefined)).toBeUndefined();
  });
});

describe("redactHeaderValue", () => {
  it("removes the value of a sensitive header but keeps the name meaningful", () => {
    expect(redactHeaderValue("Authorization", `Bearer ${CANARY_BEARER_TOKEN}`)).toBe(REDACTED);
    expect(redactHeaderValue("Cookie", CANARY_COOKIE)).toBe(REDACTED);
    expect(redactHeaderValue("X-API-Key", CANARY_API_KEY)).toBe(REDACTED);
  });

  it("is case-insensitive about the header name", () => {
    expect(redactHeaderValue("authorization", CANARY_BEARER_TOKEN)).toBe(REDACTED);
    expect(redactHeaderValue("AUTHORIZATION", CANARY_BEARER_TOKEN)).toBe(REDACTED);
  });

  it("preserves a placeholder, which is the useful thing to publish", () => {
    // Spec §16: `Authorization: Bearer {{token}}` is good documentation.
    expect(redactHeaderValue("Authorization", "{{token}}")).toBe("{{token}}");
    expect(redactHeaderValue("Authorization", "Bearer {{token}}")).toBe("Bearer {{token}}");
  });

  it("leaves non-sensitive headers alone", () => {
    expect(redactHeaderValue("Content-Type", "application/json")).toBe("application/json");
    expect(redactHeaderValue("Accept", "application/json")).toBe("application/json");
  });
});

describe("redactExampleHeaders", () => {
  it("redacts every sensitive header in a list", () => {
    const result = redactExampleHeaders([
      { name: "Authorization", value: `Bearer ${CANARY_BEARER_TOKEN}` },
      { name: "Content-Type", value: "application/json" },
      { name: "Cookie", value: CANARY_COOKIE },
    ]);
    expect(result).toEqual([
      { name: "Authorization", value: REDACTED },
      { name: "Content-Type", value: "application/json" },
      { name: "Cookie", value: REDACTED },
    ]);
  });
});

describe("redactExampleBody", () => {
  it("redacts sensitive fields in a JSON body", () => {
    const { body } = redactExampleBody(
      JSON.stringify({ id: "o-1", password: CANARY_PASSWORD, access_token: CANARY_BEARER_TOKEN }),
    );
    expect(body).not.toContain(CANARY_PASSWORD);
    expect(body).not.toContain(CANARY_BEARER_TOKEN);
    expect(body).toContain("o-1");
    expect(body).toContain(REDACTED);
  });

  it("redacts sensitive fields nested inside objects and arrays", () => {
    const { body } = redactExampleBody(
      JSON.stringify({ users: [{ name: "a", apiKey: CANARY_API_KEY }, { nested: { secret: "x" } }] }),
    );
    expect(body).not.toContain(CANARY_API_KEY);
    expect(body).toContain("a");
  });

  it("matches naming conventions equivalently", () => {
    // password_hash / passwordHash / password-hash all name the same thing.
    for (const key of ["password_hash", "passwordHash", "password-hash"]) {
      const { body } = redactExampleBody(JSON.stringify({ [key]: CANARY_PASSWORD }));
      expect(body).not.toContain(CANARY_PASSWORD);
    }
  });

  it("redacts credential-shaped lines in a non-JSON body", () => {
    const { body } = redactExampleBody(`user=alice\npassword=${CANARY_PASSWORD}`);
    expect(body).not.toContain(CANARY_PASSWORD);
    expect(body).toContain("alice");
  });

  it("keeps a placeholder in a sensitive field", () => {
    const { body } = redactExampleBody(JSON.stringify({ access_token: "{{token}}" }));
    expect(body).toContain("{{token}}");
  });

  it("truncates and reports when over the size cap", () => {
    const result = redactExampleBody("x".repeat(500), 100);
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBeLessThan(200);
    expect(result.body).toContain("truncated");
  });

  it("does not truncate content within the cap", () => {
    const result = redactExampleBody("short", 100);
    expect(result.truncated).toBe(false);
    expect(result.body).toBe("short");
  });

  it("redacts rather than expands past the depth guard", () => {
    // A redactor's failure mode must be to redact too much, never too little.
    let nested: unknown = { secret: CANARY_PASSWORD };
    for (let i = 0; i < 60; i += 1) nested = { child: nested };
    const { body } = redactExampleBody(JSON.stringify(nested));
    expect(body).not.toContain(CANARY_PASSWORD);
  });
});

describe("redactDocUrl", () => {
  it("removes credential-shaped query parameters", () => {
    const redacted = redactDocUrl(`https://api.example.com/orders?api_key=${CANARY_API_KEY}`);
    expect(redacted).not.toContain(CANARY_API_KEY);
  });

  it("removes RFC 3986 userinfo", () => {
    const redacted = redactDocUrl(`https://user:${CANARY_PASSWORD}@api.example.com/orders`);
    expect(redacted).not.toContain(CANARY_PASSWORD);
  });
});

describe("capText", () => {
  it("trims and normalizes empty text to undefined", () => {
    expect(capText("  hello  ")).toBe("hello");
    expect(capText("   ")).toBeUndefined();
    expect(capText(undefined)).toBeUndefined();
  });

  it("caps long text with an ellipsis", () => {
    const result = capText("x".repeat(100), 10);
    expect(result).toBe(`${"x".repeat(10)}…`);
  });
});
