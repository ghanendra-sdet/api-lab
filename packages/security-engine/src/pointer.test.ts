import { describe, expect, it } from "vitest";
import { collectFields, formatPointer, getAtPointer, kindOf, parsePointer, removeAtPointer, setAtPointer } from "./pointer.ts";
import { MAX_COLLECTED_FIELDS } from "./limits.ts";

describe("parsePointer / formatPointer", () => {
  it("round-trips ordinary tokens", () => {
    expect(parsePointer("/a/b/0")).toEqual(["a", "b", "0"]);
    expect(formatPointer(["a", "b", "0"])).toBe("/a/b/0");
  });

  it("treats the empty pointer as the document root", () => {
    expect(parsePointer("")).toEqual([]);
    expect(formatPointer([])).toBe("");
  });

  it("unescapes ~1 before ~0, as RFC 6901 requires", () => {
    // Getting this order wrong makes "~01" round-trip incorrectly.
    expect(parsePointer("/a~1b")).toEqual(["a/b"]);
    expect(parsePointer("/a~0b")).toEqual(["a~b"]);
    expect(formatPointer(["a/b"])).toBe("/a~1b");
  });

  it("rejects a pointer that does not start with a slash", () => {
    expect(() => parsePointer("a/b")).toThrow();
  });
});

describe("getAtPointer", () => {
  const document = { user: { name: "Ada", tags: ["x", "y"] } };

  it("reads nested values", () => {
    expect(getAtPointer(document, "/user/name")).toEqual({ found: true, value: "Ada" });
    expect(getAtPointer(document, "/user/tags/1")).toEqual({ found: true, value: "y" });
  });

  it("reports a missing field rather than returning undefined ambiguously", () => {
    expect(getAtPointer(document, "/user/missing").found).toBe(false);
  });

  it("reports an out-of-range array index as missing", () => {
    expect(getAtPointer(document, "/user/tags/9").found).toBe(false);
  });

  it("refuses to traverse __proto__", () => {
    expect(getAtPointer(document, "/__proto__/polluted").found).toBe(false);
  });
});

describe("setAtPointer", () => {
  it("replaces an existing value", () => {
    const document = { a: { b: 1 } };
    expect(setAtPointer(document, "/a/b", 2)).toBe(true);
    expect(document.a.b).toBe(2);
  });

  it("replaces an array element", () => {
    const document = { list: [1, 2, 3] };
    expect(setAtPointer(document, "/list/1", 9)).toBe(true);
    expect(document.list).toEqual([1, 9, 3]);
  });

  it("does not create missing intermediate fields", () => {
    // An auto-vivifying setter would only ever mask a generator bug.
    const document: Record<string, unknown> = {};
    expect(setAtPointer(document, "/a/b", 1)).toBe(false);
    expect(document).toEqual({});
  });

  it("refuses to write through __proto__", () => {
    const document = {};
    expect(setAtPointer(document, "/__proto__/polluted", true)).toBe(false);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("refuses to write through constructor", () => {
    const document = {};
    expect(setAtPointer(document, "/constructor/x", true)).toBe(false);
  });
});

describe("removeAtPointer", () => {
  it("deletes an object property", () => {
    const document: Record<string, unknown> = { a: 1, b: 2 };
    expect(removeAtPointer(document, "/a")).toBe(true);
    expect(document).toEqual({ b: 2 });
  });

  it("splices an array element rather than leaving a hole", () => {
    // A sparse array serializes to null, which would silently make this a
    // different mutation than the one requested.
    const document = { list: [1, 2, 3] };
    expect(removeAtPointer(document, "/list/1")).toBe(true);
    expect(document.list).toEqual([1, 3]);
    expect(JSON.stringify(document.list)).toBe("[1,3]");
  });

  it("returns false for a field that does not exist", () => {
    expect(removeAtPointer({ a: 1 }, "/b")).toBe(false);
  });
});

describe("kindOf", () => {
  it("distinguishes null and array from object", () => {
    expect(kindOf(null)).toBe("null");
    expect(kindOf([])).toBe("array");
    expect(kindOf({})).toBe("object");
    expect(kindOf("x")).toBe("string");
    expect(kindOf(1)).toBe("number");
    expect(kindOf(true)).toBe("boolean");
  });
});

describe("collectFields", () => {
  it("enumerates leaves and containers with pointers", () => {
    const fields = collectFields({ name: "Ada", meta: { active: true } });
    const pointers = fields.map((field) => field.pointer);
    expect(pointers).toContain("/name");
    expect(pointers).toContain("/meta");
    expect(pointers).toContain("/meta/active");
  });

  it("visits only the first element of an array", () => {
    // Mutating element 7 exercises the same validation path as element 0.
    const fields = collectFields({ list: [1, 2, 3, 4] });
    const indices = fields.map((field) => field.pointer).filter((pointer) => pointer.startsWith("/list/"));
    expect(indices).toEqual(["/list/0"]);
  });

  it("skips __proto__ keys", () => {
    const document = JSON.parse('{"__proto__":{"x":1},"safe":2}') as unknown;
    expect(collectFields(document).map((field) => field.pointer)).not.toContain("/__proto__");
  });

  it("is bounded by MAX_COLLECTED_FIELDS", () => {
    const document: Record<string, unknown> = {};
    for (let i = 0; i < MAX_COLLECTED_FIELDS + 100; i++) document[`f${i}`] = i;
    expect(collectFields(document).length).toBeLessThanOrEqual(MAX_COLLECTED_FIELDS);
  });

  it("does not overflow the stack on a deeply nested body", () => {
    let node: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 500; i++) node = { child: node };
    expect(() => collectFields(node)).not.toThrow();
  });
});
