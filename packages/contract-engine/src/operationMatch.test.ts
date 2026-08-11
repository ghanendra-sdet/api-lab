import { describe, expect, it } from "vitest";
import {
  extractPathParameters,
  extractRequestPath,
  parsePathTemplate,
  resolveOperation,
  splitPath,
} from "./operationMatch.ts";
import { parseContract } from "./parse.ts";
import { SPEC_30 } from "./testFixtures.ts";
import type { ContractModel } from "./types.ts";

function contractFrom(text: string): ContractModel {
  const result = parseContract(text);
  if (!result.ok) throw new Error(result.detail);
  return result.contract;
}

const contract = contractFrom(SPEC_30);

describe("path template parsing", () => {
  it("splits paths, ignoring empty segments", () => {
    expect(splitPath("/users/1/")).toEqual(["users", "1"]);
    expect(splitPath("/")).toEqual([]);
  });

  it("recognises template segments", () => {
    expect(parsePathTemplate("/users/{id}/posts")).toEqual([
      { value: "users", isTemplate: false },
      { value: "id", isTemplate: true },
      { value: "posts", isTemplate: false },
    ]);
  });

  it("does not treat an empty brace pair as a template", () => {
    expect(parsePathTemplate("/a/{}")).toEqual([
      { value: "a", isTemplate: false },
      { value: "{}", isTemplate: false },
    ]);
  });
});

describe("extractRequestPath", () => {
  it("strips scheme, authority, query and fragment", () => {
    expect(extractRequestPath("http://localhost:4010/users/1?a=b#frag", [])).toBe("/users/1");
  });

  it("removes the documented server base path", () => {
    expect(extractRequestPath("http://localhost:4010/api/users/1", ["http://localhost:4010/api"])).toBe("/users/1");
  });

  it("prefers the longest matching server base path", () => {
    expect(extractRequestPath("http://h/api/v2/users", ["http://h/api", "http://h/api/v2"])).toBe("/users");
  });

  it("does not strip a base path that only partially matches a segment", () => {
    // `/apixyz` must not be treated as `/api` + `xyz`.
    expect(extractRequestPath("http://h/apixyz/users", ["http://h/api"])).toBe("/apixyz/users");
  });

  it("handles a relative URL", () => {
    expect(extractRequestPath("/users/1", [])).toBe("/users/1");
  });

  it("returns / when the request targets the server root", () => {
    expect(extractRequestPath("http://localhost:4010/api", ["http://localhost:4010/api"])).toBe("/");
    expect(extractRequestPath("http://localhost:4010", [])).toBe("/");
  });
});

describe("resolveOperation (spec §6, §45)", () => {
  it("maps GET /users/1 to GET /users/{id}", () => {
    const match = resolveOperation(contract, "GET", "/users/1");
    expect(match.status).toBe("matched");
    expect(match.status === "matched" && match.operation.path).toBe("/users/{id}");
  });

  it("maps GET /users/list to the literal operation, not the templated one", () => {
    // Both /users/list and /users/{id} match structurally. The literal must
    // win deterministically — spec §6.
    const match = resolveOperation(contract, "GET", "/users/list");
    expect(match.status).toBe("matched");
    expect(match.status === "matched" && match.operation.path).toBe("/users/list");
  });

  it("maps a collection path with no template segments", () => {
    const match = resolveOperation(contract, "GET", "/users");
    expect(match.status === "matched" && match.operation.id).toBe("GET /users");
  });

  it("distinguishes methods on the same path", () => {
    expect(resolveOperation(contract, "POST", "/users").status === "matched").toBe(true);
    const match = resolveOperation(contract, "POST", "/users");
    expect(match.status === "matched" && match.operation.id).toBe("POST /users");
  });

  it("reports an unknown path rather than guessing", () => {
    const match = resolveOperation(contract, "GET", "/unknown/path");
    expect(match.status).toBe("unknown-path");
    expect(match.status === "unknown-path" && match.detail).toContain("/unknown/path");
  });

  it("reports a path with the wrong method, and names the documented methods", () => {
    const match = resolveOperation(contract, "DELETE", "/users");
    expect(match.status).toBe("unknown-method");
    expect(match.status === "unknown-method" && match.allowedMethods).toEqual(["GET", "POST"]);
    expect(match.status === "unknown-method" && match.detail).toContain("DELETE");
  });

  it("does not match a path with a different number of segments", () => {
    expect(resolveOperation(contract, "GET", "/users/1/posts").status).toBe("unknown-path");
  });

  it("reports ambiguity instead of silently picking one (spec §27)", () => {
    const ambiguous = contractFrom(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: {
          "/things/{id}": { get: { responses: {} } },
          "/things/{name}": { get: { responses: {} } },
        },
      }),
    );
    const match = resolveOperation(ambiguous, "GET", "/things/abc");
    expect(match.status).toBe("ambiguous");
    expect(match.status === "ambiguous" && match.detail).toContain("could not be uniquely determined");
    expect(match.status === "ambiguous" && match.candidates).toHaveLength(2);
  });

  it("breaks a near-ambiguity by specificity when one path is more literal", () => {
    const specific = contractFrom(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t" },
        paths: {
          "/a/{x}/c": { get: { responses: {} } },
          "/a/b/{y}": { get: { responses: {} } },
        },
      }),
    );
    // `/a/b/c` matches both; the earlier literal segment wins.
    const match = resolveOperation(specific, "GET", "/a/b/c");
    expect(match.status === "matched" && match.operation.path).toBe("/a/b/{y}");
  });
});

describe("extractPathParameters", () => {
  it("extracts named values by position", () => {
    expect(extractPathParameters("/users/{id}/posts/{postId}", "/users/7/posts/9")).toEqual({ id: "7", postId: "9" });
  });

  it("percent-decodes values", () => {
    expect(extractPathParameters("/users/{name}", "/users/a%20b")).toEqual({ name: "a b" });
  });

  it("survives malformed percent-encoding", () => {
    expect(extractPathParameters("/users/{name}", "/users/%E0%A4%A")).toEqual({ name: "%E0%A4%A" });
  });

  it("never writes a prototype-polluting key", () => {
    const params = extractPathParameters("/a/{__proto__}", "/a/boom");
    expect(params.__proto__).toBeUndefined();
    expect(({} as Record<string, unknown>).boom).toBeUndefined();
  });
});
