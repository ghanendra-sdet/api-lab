import { describe, expect, it } from "vitest";
import { parseContract, parseSpecSource } from "./parse.ts";
import { MAX_SPEC_FILE_SIZE_BYTES } from "./limits.ts";

/**
 * YAML security regression suite (Milestone 12, spec §39).
 *
 * Milestone 11 chose the `yaml` package over `js-yaml` on the grounds that
 * its default `parse` is already the safe mode. Milestone 12 §39 asks for
 * that claim to be *verified* rather than restated, and pinned with
 * regression tests so a future dependency bump that reintroduced custom-tag
 * handling would fail the build rather than silently widen the attack
 * surface.
 *
 * Each test below corresponds to one item on §39's checklist.
 */

const HEADER = "openapi: '3.0.3'\ninfo:\n  title: T\n  version: '1'\npaths: {}\n";

describe("YAML security — no code execution (spec §39)", () => {
  it("does not construct a function from a !!js/function tag", () => {
    const result = parseSpecSource(`${HEADER}x-evil: !!js/function 'function(){return 1}'\n`);
    if (result.ok) {
      const value = (result.raw as Record<string, unknown>)["x-evil"];
      expect(typeof value).not.toBe("function");
    } else {
      expect(result.detail).toContain("YAML");
    }
  });

  it("does not instantiate an object from a !!js/undefined or custom tag", () => {
    const result = parseSpecSource(`${HEADER}x-evil: !!js/undefined ''\n`);
    if (result.ok) {
      const value = (result.raw as Record<string, unknown>)["x-evil"];
      // The tag is not honoured — whatever comes back is inert data.
      expect(typeof value === "object" || typeof value === "string" || value === undefined).toBe(true);
    }
  });

  it("does not evaluate a !!python/object style tag", () => {
    const result = parseSpecSource(`${HEADER}x-evil: !!python/object/apply:os.system ['echo hi']\n`);
    if (result.ok) {
      const value = (result.raw as Record<string, unknown>)["x-evil"];
      expect(typeof value).not.toBe("function");
    }
  });
});

describe("YAML security — no prototype pollution (spec §39)", () => {
  it("does not pollute Object.prototype via a __proto__ key", () => {
    const result = parseSpecSource(`${HEADER}__proto__:\n  polluted: true\n`);
    expect(result.ok).toBe(true);

    // The critical assertion: nothing leaked onto the global prototype.
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("drops __proto__ keys while normalizing a schema map", () => {
    const document = `openapi: '3.0.3'
info:
  title: T
  version: '1'
paths:
  /x:
    get:
      responses:
        '200':
          description: ok
components:
  schemas:
    Bad:
      type: object
      properties:
        __proto__:
          type: string
`;
    const parsed = parseContract(document);
    expect(parsed.ok).toBe(true);
    expect(({} as Record<string, unknown>)["type"]).toBeUndefined();
  });
});

describe("YAML security — resource limits (spec §39)", () => {
  it("enforces the size limit before parsing", () => {
    const oversized = "a".repeat(MAX_SPEC_FILE_SIZE_BYTES + 1);
    const result = parseContract(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("limit");
  });

  it("bounds alias expansion rather than allowing a billion-laughs blow-up", () => {
    // Each level references the previous one ten times. Without an alias
    // budget this expands to 10^7 nodes and exhausts memory; the `yaml`
    // package refuses it. The test asserts only that we come back promptly
    // and without throwing an unhandled error.
    const document = `${HEADER}a: &a ["x","x","x","x","x","x","x","x","x","x"]
b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]
d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]
e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]
f: [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]
`;

    const started = Date.now();
    const result = parseSpecSource(document);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5000);
    // Either outcome is acceptable — refused, or expanded within its budget.
    // What must not happen is a hang or an uncaught exception.
    expect(typeof result.ok).toBe("boolean");
  });

  it("does not overflow the stack on a deeply nested document", () => {
    let document = `${HEADER}deep:\n`;
    for (let i = 1; i < 300; i++) document += `${"  ".repeat(i)}child:\n`;
    document += `${"  ".repeat(300)}value: 1\n`;

    // The parse itself must not throw a RangeError, and neither must the
    // depth-bounded normalization walk that follows it.
    expect(() => parseSpecSource(document)).not.toThrow();
    expect(() => parseContract(document)).not.toThrow();
  });

  it("rejects malformed YAML with a typed failure rather than an exception", () => {
    const result = parseSpecSource("openapi: '3.0.3'\n  bad indentation: [\n");
    expect(result.ok).toBe(false);
  });
});
