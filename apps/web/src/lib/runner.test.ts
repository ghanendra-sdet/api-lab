import { describe, expect, it } from "vitest";
import { createCollection, createFolder, createRequest, type Collection } from "@api-lab/workspace-engine";
import { flattenCollectionRequests, summarizeRunner, type RunnerState } from "./runner";

function sampleRequest(overrides = {}) {
  return {
    method: "GET" as const,
    url: "https://example.com",
    params: [],
    headers: [],
    auth: { type: "none" as const },
    bodyMode: "none" as const,
    bodyRawFormat: "JSON" as const,
    bodyRawContent: "",
    tests: [],
    ...overrides,
  };
}

function buildCollection(): Collection {
  const created = createCollection({ collections: [] }, "API");
  let workspace = created.workspace;
  const collectionId = created.collectionId;

  workspace = createRequest(workspace, { collectionId }, "Top-level Request", sampleRequest()).workspace;
  const folderResult = createFolder(workspace, collectionId, "Auth");
  workspace = folderResult.workspace;
  workspace = createRequest(
    workspace,
    { collectionId, folderId: folderResult.folderId },
    "Login",
    sampleRequest({ method: "POST" }),
  ).workspace;
  workspace = createRequest(
    workspace,
    { collectionId, folderId: folderResult.folderId },
    "Logout",
    sampleRequest(),
  ).workspace;

  return workspace.collections[0]!;
}

describe("flattenCollectionRequests", () => {
  it("includes top-level requests and one-level-deep folder requests, in order", () => {
    const collection = buildCollection();
    const flat = flattenCollectionRequests(collection);
    expect(flat.map((r) => r.name)).toEqual(["Top-level Request", "Login", "Logout"]);
  });

  it("sets the correct location for top-level vs. folder requests", () => {
    const collection = buildCollection();
    const flat = flattenCollectionRequests(collection);
    expect(flat[0]!.location).toEqual({ collectionId: collection.id });
    expect(flat[1]!.location).toEqual({ collectionId: collection.id, folderId: collection.items[1]!.id });
  });

  it("returns an empty array for an empty collection", () => {
    const { workspace } = createCollection({ collections: [] }, "Empty");
    expect(flattenCollectionRequests(workspace.collections[0]!)).toEqual([]);
  });
});

describe("summarizeRunner", () => {
  function state(items: RunnerState["items"]): RunnerState {
    return { status: "completed", collectionId: "c1", environmentId: null, stopOnFailure: true, items };
  }

  it("counts each status bucket", () => {
    const summary = summarizeRunner(
      state([
        { requestId: "1", name: "a", status: "passed" },
        { requestId: "2", name: "b", status: "passed" },
        { requestId: "3", name: "c", status: "failed" },
        { requestId: "4", name: "d", status: "error" },
        { requestId: "5", name: "e", status: "skipped" },
      ]),
    );
    expect(summary).toEqual({ passed: 2, failed: 1, errors: 1, skipped: 1, total: 5 });
  });

  it("treats cancelled and pending as skipped for summary purposes", () => {
    const summary = summarizeRunner(
      state([
        { requestId: "1", name: "a", status: "cancelled" },
        { requestId: "2", name: "b", status: "pending" },
      ]),
    );
    expect(summary.skipped).toBe(2);
  });
});
