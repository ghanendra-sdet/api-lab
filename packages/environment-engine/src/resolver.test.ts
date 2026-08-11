import { describe, expect, it } from "vitest";
import { buildDisplayVariableContext, buildVariableContext, resolveVariables } from "./resolver.ts";
import type { Environment } from "./types.ts";

describe("resolveVariables", () => {
  it("resolves a single variable", () => {
    const result = resolveVariables("{{baseUrl}}", { baseUrl: "https://api.example.com" });
    expect(result.value).toBe("https://api.example.com");
    expect(result.unresolvedVariables).toEqual([]);
    expect(result.hasCircularReference).toBe(false);
  });

  it("resolves multiple variables in one string", () => {
    const result = resolveVariables("{{baseUrl}}/users/{{userId}}", {
      baseUrl: "https://api.example.com",
      userId: "123",
    });
    expect(result.value).toBe("https://api.example.com/users/123");
  });

  it("leaves text without any variables untouched", () => {
    const result = resolveVariables("https://api.example.com/users", {});
    expect(result.value).toBe("https://api.example.com/users");
    expect(result.unresolvedVariables).toEqual([]);
  });

  it("resolves an empty variable value to an empty string", () => {
    const result = resolveVariables("{{empty}}value", { empty: "" });
    expect(result.value).toBe("value");
  });

  it("reports unknown variables and leaves the placeholder intact", () => {
    const result = resolveVariables("{{doesNotExist}}", {});
    expect(result.value).toBe("{{doesNotExist}}");
    expect(result.unresolvedVariables).toEqual(["doesNotExist"]);
  });

  it("reports each distinct unknown variable once", () => {
    const result = resolveVariables("{{a}}-{{b}}-{{a}}", {});
    expect(result.unresolvedVariables.sort()).toEqual(["a", "b"]);
  });

  it("does not treat malformed syntax as a variable", () => {
    expect(resolveVariables("{{", {}).value).toBe("{{");
    expect(resolveVariables("{{invalid", {}).value).toBe("{{invalid");
    expect(resolveVariables("{{ spaced }}", {}).value).toBe("{{ spaced }}");
  });

  it("supports variables nested inside other variables' values", () => {
    const result = resolveVariables("{{full}}", { full: "{{baseUrl}}/v1", baseUrl: "https://api.example.com" });
    expect(result.value).toBe("https://api.example.com/v1");
  });

  it("detects a direct circular reference without looping forever", () => {
    const result = resolveVariables("{{a}}", { a: "{{b}}", b: "{{a}}" });
    expect(result.hasCircularReference).toBe(true);
    expect(result.value).toContain("{{a}}");
  });

  it("detects a self-referencing variable", () => {
    const result = resolveVariables("{{a}}", { a: "{{a}}" });
    expect(result.hasCircularReference).toBe(true);
  });

  it("enforces a resolution depth limit for long non-cyclic chains", () => {
    const context: Record<string, string> = { v0: "done" };
    for (let i = 1; i <= 30; i++) context[`v${i}`] = `{{v${i - 1}}}`;
    const result = resolveVariables("{{v30}}", context);
    expect(result.hasCircularReference).toBe(true);
  });

  it("resolves within a reasonable chain depth", () => {
    const context: Record<string, string> = { v0: "done" };
    for (let i = 1; i <= 5; i++) context[`v${i}`] = `{{v${i - 1}}}`;
    const result = resolveVariables("{{v5}}", context);
    expect(result.value).toBe("done");
    expect(result.hasCircularReference).toBe(false);
  });

  it("treats a __proto__-named reference as unresolved rather than reading the prototype chain", () => {
    const result = resolveVariables("{{__proto__}}", {});
    expect(result.value).toBe("{{__proto__}}");
    expect(result.unresolvedVariables).toEqual(["__proto__"]);
    // eslint-disable-next-line no-proto
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("does not pollute Object.prototype via a constructor-named variable", () => {
    resolveVariables("{{constructor}}", { constructor: "harmless-string" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("handles special characters in variable values as opaque data", () => {
    const result = resolveVariables("{{payload}}", { payload: '{"a":1}<script>alert(1)</script>' });
    expect(result.value).toBe('{"a":1}<script>alert(1)</script>');
  });
});

describe("buildVariableContext", () => {
  it("returns an empty context for no environment", () => {
    expect(buildVariableContext(null)).toEqual({});
    expect(buildVariableContext(undefined)).toEqual({});
  });

  it("a __proto__-keyed variable resolves as ordinary data, without polluting Object.prototype", () => {
    const environment: Environment = {
      id: "env_1",
      name: "Dev",
      variables: [{ id: "v1", key: "__proto__", value: "just-a-string", enabled: true, secret: false }],
      createdAt: "",
      updatedAt: "",
    };
    // buildVariableContext uses a null-prototype object, so `__proto__` here
    // is a plain own property, not the special accessor — safe either way.
    const context = buildVariableContext(environment);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const result = resolveVariables("{{__proto__}}", context);
    expect(result.value).toBe("just-a-string");
  });

  it("includes only enabled variables", () => {
    const environment: Environment = {
      id: "env_1",
      name: "Dev",
      variables: [
        { id: "v1", key: "baseUrl", value: "https://dev.example.com", enabled: true, secret: false },
        { id: "v2", key: "disabled", value: "nope", enabled: false, secret: false },
      ],
      createdAt: "",
      updatedAt: "",
    };
    expect(buildVariableContext(environment)).toEqual({ baseUrl: "https://dev.example.com" });
  });
});

describe("buildDisplayVariableContext", () => {
  it("masks secret variable values but leaves regular values intact", () => {
    const environment: Environment = {
      id: "env_1",
      name: "Dev",
      variables: [
        { id: "v1", key: "baseUrl", value: "https://dev.example.com", enabled: true, secret: false },
        { id: "v2", key: "token", value: "super-secret-value", enabled: true, secret: true },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const context = buildDisplayVariableContext(environment);
    expect(context.baseUrl).toBe("https://dev.example.com");
    expect(context.token).not.toBe("super-secret-value");
    expect(context.token).toMatch(/^•+$/);
  });

  it("never leaks the real secret value through resolution", () => {
    const environment: Environment = {
      id: "env_1",
      name: "Dev",
      variables: [{ id: "v1", key: "token", value: "super-secret-value", enabled: true, secret: true }],
      createdAt: "",
      updatedAt: "",
    };
    const result = resolveVariables("Bearer {{token}}", buildDisplayVariableContext(environment));
    expect(result.value).not.toContain("super-secret-value");
  });
});
