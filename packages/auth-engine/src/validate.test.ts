import { describe, expect, it } from "vitest";
import { validateAuthConfig } from "./validate.ts";
import { createDefaultAuthConfig } from "./types.ts";

describe("validateAuthConfig", () => {
  it("No Auth is always valid", () => {
    expect(validateAuthConfig(createDefaultAuthConfig("none"))).toBeNull();
  });

  it("requires an API key name and value", () => {
    expect(validateAuthConfig({ type: "apiKey", key: "", value: "x", addTo: "header" })?.message).toMatch(/key name/i);
    expect(validateAuthConfig({ type: "apiKey", key: "X-API-Key", value: "", addTo: "header" })?.message).toMatch(
      /key value/i,
    );
    expect(validateAuthConfig({ type: "apiKey", key: "X-API-Key", value: "abc", addTo: "header" })).toBeNull();
  });

  it("requires a username and password for Basic auth", () => {
    expect(validateAuthConfig({ type: "basic", username: "", password: "x" })?.message).toMatch(/username/i);
    expect(validateAuthConfig({ type: "basic", username: "u", password: "" })?.message).toMatch(/password/i);
    expect(validateAuthConfig({ type: "basic", username: "u", password: "p" })).toBeNull();
  });

  it("requires a bearer token", () => {
    expect(validateAuthConfig({ type: "bearer", token: "" })?.message).toMatch(/token/i);
    expect(validateAuthConfig({ type: "bearer", token: "abc" })).toBeNull();
  });

  it("requires a JWT token", () => {
    expect(validateAuthConfig({ type: "jwt", token: "" })?.message).toMatch(/token/i);
    expect(validateAuthConfig({ type: "jwt", token: "abc" })).toBeNull();
  });

  it("OAuth 2.0 is never valid to send — honest placeholder, not fake functionality", () => {
    const error = validateAuthConfig({ type: "oauth2" });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/planned/i);
  });

  it("Inherit Auth is always valid", () => {
    expect(validateAuthConfig(createDefaultAuthConfig("inherit"))).toBeNull();
  });
});
