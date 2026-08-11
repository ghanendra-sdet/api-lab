import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultRoute } from "@api-lab/mock-engine";
import { RouteStore } from "./store.ts";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("RouteStore persistence", () => {
  it("persists a created route across a reload (new RouteStore instance, same file)", () => {
    dir = mkdtempSync(join(tmpdir(), "mock-store-test-"));
    const file = join(dir, "routes.json");

    const store = new RouteStore(file);
    const route = createDefaultRoute("GET", "/users");
    store.create(route);

    const reloaded = new RouteStore(file);
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.list()[0]!.path).toBe("/users");
  });

  it("starts empty (never crashes) when the file contains invalid JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "mock-store-test-"));
    const file = join(dir, "routes.json");
    writeFileSync(file, "{ not valid json", "utf-8");

    const store = new RouteStore(file);
    expect(store.list()).toEqual([]);
  });

  it("starts empty (never crashes) when the file fails schema validation", () => {
    dir = mkdtempSync(join(tmpdir(), "mock-store-test-"));
    const file = join(dir, "routes.json");
    writeFileSync(file, JSON.stringify({ version: 1, routes: [{ bogus: true }] }), "utf-8");

    const store = new RouteStore(file);
    expect(store.list()).toEqual([]);
  });

  it("starts empty when the file is missing entirely", () => {
    dir = mkdtempSync(join(tmpdir(), "mock-store-test-"));
    const file = join(dir, "does-not-exist.json");
    const store = new RouteStore(file);
    expect(store.list()).toEqual([]);
  });
});
