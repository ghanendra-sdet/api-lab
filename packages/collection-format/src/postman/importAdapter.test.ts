import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePostmanCollection, parsePostmanEnvironment } from "./parse";
import { adaptPostmanCollection, adaptPostmanEnvironment } from "./importAdapter";

const fixturesDir = fileURLToPath(new URL("../../fixtures/postman", import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}/${name}`, "utf-8"));
}

describe("Postman collection import", () => {
  it("imports a simple collection with GET and POST requests", () => {
    const parsed = parsePostmanCollection(loadFixture("simple-collection.json"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = adaptPostmanCollection(parsed.data);
    expect(result.name).toBe("Simple API");
    expect(result.items).toHaveLength(2);

    const getUsers = result.items[0];
    expect(getUsers?.type).toBe("request");
    if (getUsers?.type === "request") {
      expect(getUsers.request.method).toBe("GET");
      expect(getUsers.request.url).toBe("{{baseUrl}}/users?page=1");
      expect(getUsers.request.params[0]).toMatchObject({ key: "page", value: "1" });
      expect(getUsers.request.headers[0]).toMatchObject({ key: "Accept", value: "application/json" });
    }

    const createUser = result.items[1];
    if (createUser?.type === "request") {
      expect(createUser.request.method).toBe("POST");
      expect(createUser.request.bodyMode).toBe("raw");
      expect(createUser.request.bodyRawFormat).toBe("JSON");
      expect(createUser.request.bodyRawContent).toBe('{"name": "Ada"}');
    }
  });

  it("flattens folders nested more than one level deep, with a warning", () => {
    const parsed = parsePostmanCollection(loadFixture("nested-folders-and-auth.json"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = adaptPostmanCollection(parsed.data);
    const usersFolder = result.items.find((i) => i.type === "folder" && i.name === "Users");
    expect(usersFolder).toBeDefined();
    if (usersFolder?.type === "folder") {
      // "Deeply Nested" sub-folder's request is flattened into "Users".
      expect(usersFolder.items.some((r) => r.name === "Get User By Id")).toBe(true);
    }
    expect(result.warnings.some((w) => w.includes("nested more than one level deep"))).toBe(true);
  });

  it("maps Basic, Bearer, and API Key auth", () => {
    const parsed = parsePostmanCollection(loadFixture("nested-folders-and-auth.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptPostmanCollection(parsed.data);

    const usersFolder = result.items.find((i) => i.type === "folder" && i.name === "Users");
    const basicRequest = usersFolder?.type === "folder" ? usersFolder.items.find((r) => r.name === "Basic Auth Request") : undefined;
    expect(basicRequest?.request.auth).toEqual({ type: "basic", username: "alice", password: "wonderland" });

    const bearerRequest = result.items.find((i) => i.type === "request" && i.name === "Bearer Request");
    if (bearerRequest?.type === "request") {
      expect(bearerRequest.request.auth).toEqual({ type: "bearer", token: "{{token}}" });
    }

    const apiKeyRequest = result.items.find((i) => i.type === "request" && i.name === "API Key Request");
    if (apiKeyRequest?.type === "request") {
      expect(apiKeyRequest.request.auth).toEqual({ type: "apiKey", key: "X-API-Key", value: "{{apiKey}}", addTo: "header" });
    }
  });

  it("warns on unsupported auth types and imports them as No Auth", () => {
    const parsed = parsePostmanCollection(loadFixture("nested-folders-and-auth.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptPostmanCollection(parsed.data);

    const unsupported = result.items.find((i) => i.type === "request" && i.name === "Unsupported Auth Request");
    if (unsupported?.type === "request") {
      expect(unsupported.request.auth).toEqual({ type: "none" });
      expect(unsupported.warnings.some((w) => w.includes("oauth2"))).toBe(true);
    }
  });

  it("never executes imported scripts, and warns that they were not imported", () => {
    const parsed = parsePostmanCollection(loadFixture("nested-folders-and-auth.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptPostmanCollection(parsed.data);

    const scripted = result.items.find((i) => i.type === "request" && i.name === "Request With Script");
    if (scripted?.type === "request") {
      expect(scripted.warnings.some((w) => w.includes("script"))).toBe(true);
      // No field anywhere on the imported RequestConfig can hold executable code.
      expect(JSON.stringify(scripted.request)).not.toContain("pm.environment.set");
    }
  });

  it("preserves form-data as text with a not-executable warning, never silently discarding it", () => {
    const parsed = parsePostmanCollection(loadFixture("nested-folders-and-auth.json"));
    if (!parsed.ok) throw new Error("fixture should parse");
    const result = adaptPostmanCollection(parsed.data);

    const formData = result.items.find((i) => i.type === "request" && i.name === "Form Data Request");
    if (formData?.type === "request") {
      expect(formData.request.bodyRawContent).toContain("file=avatar.png");
      expect(formData.warnings.some((w) => w.includes("not currently executable"))).toBe(true);
    }
  });
});

describe("Postman environment import", () => {
  it("imports variables with enabled/secret flags", () => {
    const parsed = parsePostmanEnvironment(loadFixture("environment.json"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = adaptPostmanEnvironment(parsed.data);
    expect(result.name).toBe("Development");
    expect(result.variables).toContainEqual({ key: "baseUrl", value: "https://dev.example.com", enabled: true, secret: false });
    expect(result.variables).toContainEqual({ key: "token", value: "dev-secret-token", enabled: true, secret: true });
    expect(result.variables).toContainEqual({ key: "disabledVar", value: "unused", enabled: false, secret: false });
  });
});
