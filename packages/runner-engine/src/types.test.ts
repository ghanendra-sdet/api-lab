import { describe, expect, it } from "vitest";
import { mergeResolutionContext } from "./types";

describe("mergeResolutionContext", () => {
  it("merges all three scopes", () => {
    const merged = mergeResolutionContext({
      environment: { baseUrl: "https://example.com" },
      runtime: { token: "abc" },
      iteration: { userId: "123" },
    });
    expect(merged).toEqual({ baseUrl: "https://example.com", token: "abc", userId: "123" });
  });

  it("iteration overrides runtime overrides environment on key collision", () => {
    const merged = mergeResolutionContext({
      environment: { userId: "env-value" },
      runtime: { userId: "runtime-value" },
      iteration: { userId: "iteration-value" },
    });
    expect(merged.userId).toBe("iteration-value");
  });

  it("runtime overrides environment when iteration doesn't define the key", () => {
    const merged = mergeResolutionContext({
      environment: { userId: "env-value" },
      runtime: { userId: "runtime-value" },
      iteration: {},
    });
    expect(merged.userId).toBe("runtime-value");
  });

  it("does not mutate the input scopes", () => {
    const environment = { a: "1" };
    const runtime = { b: "2" };
    const iteration = { c: "3" };
    mergeResolutionContext({ environment, runtime, iteration });
    expect(environment).toEqual({ a: "1" });
    expect(runtime).toEqual({ b: "2" });
    expect(iteration).toEqual({ c: "3" });
  });

  it("a __proto__-keyed scope value does not pollute Object.prototype", () => {
    const merged = mergeResolutionContext({
      environment: {},
      runtime: { __proto__: "polluted" } as unknown as Record<string, string>,
      iteration: {},
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    void merged;
  });
});
