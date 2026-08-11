import { describe, expect, it } from "vitest";
import { evaluateJsonPath } from "./jsonPath.ts";

describe("evaluateJsonPath", () => {
  it("returns the root value for $", () => {
    const result = evaluateJsonPath("$", { a: 1 });
    expect(result).toEqual({ ok: true, found: true, value: { a: 1 } });
  });

  it("resolves a simple property", () => {
    const result = evaluateJsonPath("$.id", { id: 123 });
    expect(result).toEqual({ ok: true, found: true, value: 123 });
  });

  it("resolves a nested property", () => {
    const result = evaluateJsonPath("$.user.name", { user: { name: "Ada" } });
    expect(result).toEqual({ ok: true, found: true, value: "Ada" });
  });

  it("resolves an array index", () => {
    const result = evaluateJsonPath("$.items[0].id", { items: [{ id: 1 }, { id: 2 }] });
    expect(result).toEqual({ ok: true, found: true, value: 1 });
  });

  it("reports not-found for a missing property, distinctly from a null value", () => {
    const missing = evaluateJsonPath("$.missing", { a: 1 });
    expect(missing).toEqual({ ok: true, found: false });

    const nullValue = evaluateJsonPath("$.a", { a: null });
    expect(nullValue).toEqual({ ok: true, found: true, value: null });
  });

  it("reports not-found for an out-of-range array index", () => {
    const result = evaluateJsonPath("$.items[5]", { items: [1, 2] });
    expect(result).toEqual({ ok: true, found: false });
  });

  it("reports not-found when traversing into a primitive", () => {
    const result = evaluateJsonPath("$.a.b", { a: 1 });
    expect(result).toEqual({ ok: true, found: false });
  });

  it("reports not-found when indexing a non-array", () => {
    const result = evaluateJsonPath("$.a[0]", { a: { b: 1 } });
    expect(result).toEqual({ ok: true, found: false });
  });

  it("rejects malformed/unsupported syntax rather than guessing", () => {
    expect(evaluateJsonPath("$.a.", {}).ok).toBe(false);
    expect(evaluateJsonPath("a.b", {}).ok).toBe(false);
    expect(evaluateJsonPath("$..a", {}).ok).toBe(false);
    expect(evaluateJsonPath("$.a[*]", {}).ok).toBe(false);
    expect(evaluateJsonPath("$.a[?(@.b)]", {}).ok).toBe(false);
  });

  it("handles a primitive root value", () => {
    expect(evaluateJsonPath("$", 42)).toEqual({ ok: true, found: true, value: 42 });
    expect(evaluateJsonPath("$.a", 42)).toEqual({ ok: true, found: false });
  });
});
