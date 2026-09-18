import { describe, expect, it } from "vitest";
import { createCollection, createEmptyWorkspace, createFolder, createRequest } from "@api-lab/workspace-engine";
import { buildDndTree, containerEndId, folderDropId, resolveDrop } from "./dndTree";

/**
 * Phase 3 of Workspace Management: unit tests for the pure DnD-resolution
 * logic that sits between `@dnd-kit`'s raw `active`/`over` ids and the
 * store's `moveSavedRequest`/`moveFolder`/`reorderItems` actions. Kept
 * DOM-free (no pointer-drag simulation, which jsdom can't do reliably) —
 * the actual pointer/keyboard interaction is covered by a Playwright E2E
 * test instead (see `apps/web/e2e/sidebarDnd.spec.ts`).
 */

function sampleConfig() {
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
    extractions: [],
  };
}

function setup() {
  const { workspace: w0, collectionId } = createCollection(createEmptyWorkspace(), "Coll");
  const { workspace: w1, requestId: reqA } = createRequest(w0, { collectionId }, "A", sampleConfig());
  const { workspace: w2, requestId: reqB } = createRequest(w1, { collectionId }, "B", sampleConfig());
  const { workspace: w3, folderId } = createFolder(w2, collectionId, "Folder");
  const { workspace: w4, requestId: reqC } = createRequest(
    w3,
    { collectionId, folderPath: [folderId] },
    "C",
    sampleConfig(),
  );
  const { workspace: w5, folderId: folderId2 } = createFolder(w4, collectionId, "Folder2");
  const { workspace: w6, requestId: reqD } = createRequest(
    w5,
    { collectionId, folderPath: [folderId2] },
    "D",
    sampleConfig(),
  );
  const collection = w6.collections[0]!;
  return { collection, collectionId, folderId, folderId2, reqA, reqB, reqC, reqD };
}

describe("buildDndTree", () => {
  it("records each item's container location and index, at every depth", () => {
    const { collection, collectionId, folderId, reqA, reqB, reqC } = setup();
    const tree = buildDndTree(collection);

    expect(tree.meta.get(reqA)).toEqual({ type: "request", location: { collectionId, folderPath: [] }, index: 0 });
    expect(tree.meta.get(reqB)).toEqual({ type: "request", location: { collectionId, folderPath: [] }, index: 1 });
    expect(tree.meta.get(folderId)).toEqual({ type: "folder", location: { collectionId, folderPath: [] }, index: 2 });
    expect(tree.meta.get(reqC)).toEqual({
      type: "request",
      location: { collectionId, folderPath: [folderId] },
      index: 0,
    });
  });

  it("lists each container's ordered item ids", () => {
    const { collection, collectionId, folderId, folderId2, reqA, reqB, reqC, reqD } = setup();
    const tree = buildDndTree(collection);

    expect(tree.containers.get(`${collectionId}::`)).toEqual([reqA, reqB, folderId, folderId2]);
    expect(tree.containers.get(`${collectionId}::${folderId}`)).toEqual([reqC]);
    expect(tree.containers.get(`${collectionId}::${folderId2}`)).toEqual([reqD]);
  });
});

describe("resolveDrop", () => {
  it("returns null when dropped on itself", () => {
    const { collection, reqA } = setup();
    const tree = buildDndTree(collection);
    expect(resolveDrop(tree, reqA, reqA)).toBeNull();
  });

  it("returns null when there is no drop target", () => {
    const { collection, reqA } = setup();
    const tree = buildDndTree(collection);
    expect(resolveDrop(tree, reqA, null)).toBeNull();
  });

  it("reorders within the same container when dropped on a sibling", () => {
    const { collection, collectionId, reqA, reqB } = setup();
    const tree = buildDndTree(collection);
    expect(resolveDrop(tree, reqA, reqB)).toEqual({
      kind: "reorder",
      location: { collectionId, folderPath: [] },
      itemId: reqA,
      newIndex: 1,
    });
  });

  it("moves a request into a different item's container, at that item's index, when dropped on an item there", () => {
    const { collection, collectionId, folderId, reqA, reqC } = setup();
    const tree = buildDndTree(collection);
    expect(resolveDrop(tree, reqA, reqC)).toEqual({
      kind: "moveRequest",
      from: { collectionId, folderPath: [] },
      to: { collectionId, folderPath: [folderId] },
      requestId: reqA,
      newIndex: 0,
    });
  });

  it("moves a request into a folder, appended at the end, when dropped on the folder's own header", () => {
    const { collection, collectionId, folderId, reqA } = setup();
    const tree = buildDndTree(collection);
    expect(resolveDrop(tree, reqA, folderDropId(folderId))).toEqual({
      kind: "moveRequest",
      from: { collectionId, folderPath: [] },
      to: { collectionId, folderPath: [folderId] },
      requestId: reqA,
    });
  });

  it("refuses to drop a folder onto its own header", () => {
    const { collection, folderId } = setup();
    const tree = buildDndTree(collection);
    expect(resolveDrop(tree, folderId, folderDropId(folderId))).toBeNull();
  });

  it("moves a request to another container when dropped on that container's empty-placeholder sentinel", () => {
    const { collection, collectionId, folderId, reqA } = setup();
    const tree = buildDndTree(collection);
    const otherContainerLocation = { collectionId, folderPath: [folderId] };
    expect(resolveDrop(tree, reqA, containerEndId(otherContainerLocation))).toEqual({
      kind: "moveRequest",
      from: { collectionId, folderPath: [] },
      to: otherContainerLocation,
      requestId: reqA,
    });
  });

  it("is a no-op when dropped on the empty-placeholder sentinel of the item's own current container", () => {
    const { collection, collectionId, reqA } = setup();
    const tree = buildDndTree(collection);
    expect(resolveDrop(tree, reqA, containerEndId({ collectionId, folderPath: [] }))).toBeNull();
  });

  it("moves a folder into another folder's container when dropped on an item living there", () => {
    const { collection, collectionId, folderId, folderId2, reqD } = setup();
    const tree = buildDndTree(collection);
    expect(resolveDrop(tree, folderId, reqD)).toEqual({
      kind: "moveFolder",
      from: { collectionId, folderPath: [] },
      to: { collectionId, folderPath: [folderId2] },
      folderId,
      newIndex: 0,
    });
  });
});
