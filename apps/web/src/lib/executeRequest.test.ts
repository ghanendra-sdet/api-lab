import { describe, expect, it } from "vitest";
import type { Folder } from "@api-lab/workspace-engine";
import { mergeFolderChainVariables, resolveFolderChainAuth } from "./executeRequest";

/**
 * Phase 2 of Workspace Management, decision #5 (ancestor-CHAIN inheritance):
 * unit tests for the two small pure functions that flatten a folder
 * ancestor chain into the single `folder` variable/auth scope
 * `ExecutionScopes` already expects — written and passing *before* these
 * are wired into `useAppStore.ts`'s `executeRequestWithDependencies`, per
 * plan.md's explicit risk callout that D.1 resolution must never be
 * half-implemented.
 */

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function folder(overrides: Partial<Folder> = {}): Folder {
  const now = new Date().toISOString();
  return {
    id: nextId("folder"),
    type: "folder",
    name: "Folder",
    items: [],
    createdAt: now,
    updatedAt: now,
    variables: [],
    auth: { type: "inherit" },
    ...overrides,
  };
}

describe("mergeFolderChainVariables", () => {
  it("returns an empty object for an empty chain (request directly in a collection)", () => {
    expect(mergeFolderChainVariables([])).toEqual({});
  });

  it("flattens a single folder's variables", () => {
    const fld = folder({ variables: [{ id: "v1", key: "val", value: "folder", enabled: true, secret: false }] });
    expect(mergeFolderChainVariables([fld])).toEqual({ val: "folder" });
  });

  it("nearer (innermost) folder wins over farther (outermost) ones for the same key", () => {
    const grandparent = folder({ variables: [{ id: "v1", key: "val", value: "grandparent", enabled: true, secret: false }] });
    const parent = folder({ variables: [{ id: "v2", key: "val", value: "parent", enabled: true, secret: false }] });
    const immediate = folder({ variables: [{ id: "v3", key: "val", value: "immediate", enabled: true, secret: false }] });

    // Chain is ordered outermost-to-innermost, matching workspaceLookup.ts's resolveContainers.
    expect(mergeFolderChainVariables([grandparent, parent, immediate])).toEqual({ val: "immediate" });
  });

  it("merges distinct keys from every level of the chain without dropping any", () => {
    const grandparent = folder({ variables: [{ id: "v1", key: "gp", value: "gp-val", enabled: true, secret: false }] });
    const parent = folder({ variables: [{ id: "v2", key: "p", value: "p-val", enabled: true, secret: false }] });
    const immediate = folder({ variables: [{ id: "v3", key: "i", value: "i-val", enabled: true, secret: false }] });

    expect(mergeFolderChainVariables([grandparent, parent, immediate])).toEqual({
      gp: "gp-val",
      p: "p-val",
      i: "i-val",
    });
  });

  it("disabled variables at any level are excluded, same as buildVariableContextFromVariables elsewhere", () => {
    const parent = folder({ variables: [{ id: "v1", key: "val", value: "parent", enabled: false, secret: false }] });
    expect(mergeFolderChainVariables([parent])).toEqual({});
  });
});

describe("resolveFolderChainAuth", () => {
  it("returns undefined for an empty chain", () => {
    expect(resolveFolderChainAuth([])).toBeUndefined();
  });

  it("returns undefined when every folder in the chain is still \"inherit\"", () => {
    const grandparent = folder({ auth: { type: "inherit" } });
    const parent = folder({ auth: { type: "inherit" } });
    expect(resolveFolderChainAuth([grandparent, parent])).toBeUndefined();
  });

  it("nearer (innermost) concrete auth wins, even when a farther ancestor also has concrete auth", () => {
    const grandparent = folder({ auth: { type: "bearer", token: "grandparent-token" } });
    const parent = folder({ auth: { type: "bearer", token: "parent-token" } });
    const immediate = folder({ auth: { type: "inherit" } });

    // immediate is "inherit", so the walk continues past it to parent — the
    // nearest *concrete* auth, not simply the nearest folder.
    expect(resolveFolderChainAuth([grandparent, parent, immediate])).toEqual({ type: "bearer", token: "parent-token" });
  });

  it("skips inherit folders and falls through to the first concrete ancestor further up", () => {
    const grandparent = folder({ auth: { type: "basic", username: "u", password: "p" } });
    const parent = folder({ auth: { type: "inherit" } });
    const immediate = folder({ auth: { type: "inherit" } });

    expect(resolveFolderChainAuth([grandparent, parent, immediate])).toEqual({ type: "basic", username: "u", password: "p" });
  });

  it("explicit \"none\" at an intermediate folder counts as concrete and wins over an outer folder's real auth", () => {
    const grandparent = folder({ auth: { type: "bearer", token: "grandparent-token" } });
    const parent = folder({ auth: { type: "none" } });
    const immediate = folder({ auth: { type: "inherit" } });

    expect(resolveFolderChainAuth([grandparent, parent, immediate])).toEqual({ type: "none" });
  });
});
