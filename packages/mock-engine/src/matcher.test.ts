import { describe, expect, it } from "vitest";
import { createDefaultRoute } from "./factory";
import { isValidMockPath, matchRoute } from "./matcher";

function route(method: "GET" | "POST" | "DELETE", path: string, overrides: Partial<ReturnType<typeof createDefaultRoute>> = {}) {
  return { ...createDefaultRoute(method, path), ...overrides };
}

describe("isValidMockPath", () => {
  it("accepts static and param paths", () => {
    expect(isValidMockPath("/users")).toBe(true);
    expect(isValidMockPath("/users/:id")).toBe(true);
    expect(isValidMockPath("/orders/:orderId/items/:itemId")).toBe(true);
    expect(isValidMockPath("/")).toBe(true);
  });

  it("rejects regex-like or malformed paths", () => {
    expect(isValidMockPath("/users/(.*)")).toBe(false);
    expect(isValidMockPath("/users/[a-z]+")).toBe(false);
    expect(isValidMockPath("users/no-leading-slash")).toBe(false);
    expect(isValidMockPath("/users/:")).toBe(false);
    expect(isValidMockPath("")).toBe(false);
  });
});

describe("matchRoute", () => {
  it("matches an exact static route", () => {
    const routes = [route("GET", "/users")];
    const match = matchRoute(routes, "GET", "/users");
    expect(match?.route.id).toBe(routes[0]!.id);
  });

  it("matches a route with path parameters and extracts them", () => {
    const routes = [route("GET", "/users/:id")];
    const match = matchRoute(routes, "GET", "/users/123");
    expect(match?.params).toEqual({ id: "123" });
  });

  it("distinguishes /users/1 from /users/2 as separate requests against the same param route", () => {
    const routes = [route("GET", "/users/:id")];
    expect(matchRoute(routes, "GET", "/users/1")?.params.id).toBe("1");
    expect(matchRoute(routes, "GET", "/users/2")?.params.id).toBe("2");
  });

  it("prefers a static route over a parameterized one with the same segment count", () => {
    const routes = [route("GET", "/users/:id"), route("GET", "/users/list")];
    const match = matchRoute(routes, "GET", "/users/list");
    expect(match?.route.path).toBe("/users/list");
  });

  it("does not match a different HTTP method", () => {
    const routes = [route("GET", "/users")];
    expect(matchRoute(routes, "POST", "/users")).toBeNull();
  });

  it("does not match a disabled route", () => {
    const routes = [route("GET", "/users", { enabled: false })];
    expect(matchRoute(routes, "GET", "/users")).toBeNull();
  });

  it("does not match a route with a different segment count", () => {
    const routes = [route("GET", "/users/:id")];
    expect(matchRoute(routes, "GET", "/users")).toBeNull();
    expect(matchRoute(routes, "GET", "/users/1/extra")).toBeNull();
  });

  it("supports multiple path parameters", () => {
    const routes = [route("GET", "/orders/:orderId/items/:itemId")];
    const match = matchRoute(routes, "GET", "/orders/9/items/42");
    expect(match?.params).toEqual({ orderId: "9", itemId: "42" });
  });

  it("returns null for an unmatched route", () => {
    const routes = [route("GET", "/users")];
    expect(matchRoute(routes, "GET", "/unknown")).toBeNull();
  });
});
