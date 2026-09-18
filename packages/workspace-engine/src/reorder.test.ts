import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "./index.ts";
import { createCollection } from "./collection.ts";
import { createFolder } from "./folder.ts";
import { createRequest } from "./request.ts";
import { moveCollectionDown, moveCollectionUp, moveItemDown, moveItemUp, reorderItems } from "./reorder.ts";
import { getRequestsAtLocation } from "./internal.ts";
import { sampleRequestConfig } from "./testHelpers.ts";

describe("moveCollectionUp / moveCollectionDown", () => {
  it("swaps adjacent collections", () => {
    const { workspace: w1, collectionId: a } = createCollection(createEmptyWorkspace(), "A");
    const { workspace: w2, collectionId: b } = createCollection(w1, "B");
    const moved = moveCollectionDown(w2, a);
    expect(moved.collections.map((c) => c.id)).toEqual([b, a]);
  });

  it("does nothing when already at the top", () => {
    const { workspace: w1, collectionId: a } = createCollection(createEmptyWorkspace(), "A");
    const { workspace: w2, collectionId: b } = createCollection(w1, "B");
    const moved = moveCollectionUp(w2, a);
    expect(moved.collections.map((c) => c.id)).toEqual([a, b]);
  });
});

describe("moveItemUp / moveItemDown", () => {
  it("reorders requests within a collection's top level", () => {
    const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "API");
    const { workspace: w1, requestId: first } = createRequest(
      workspace,
      { collectionId },
      "First",
      sampleRequestConfig(),
    );
    const { workspace: w2, requestId: second } = createRequest(
      w1,
      { collectionId },
      "Second",
      sampleRequestConfig(),
    );

    const moved = moveItemDown(w2, { collectionId }, first);
    expect(moved.collections[0]!.items.map((i) => i.id)).toEqual([second, first]);

    const movedBack = moveItemUp(moved, { collectionId }, first);
    expect(movedBack.collections[0]!.items.map((i) => i.id)).toEqual([first, second]);
  });

  it("does nothing when moving the first item up or the last item down", () => {
    const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "API");
    const { workspace: w1, requestId: onlyId } = createRequest(
      workspace,
      { collectionId },
      "Only",
      sampleRequestConfig(),
    );
    const up = moveItemUp(w1, { collectionId }, onlyId);
    const down = moveItemDown(up, { collectionId }, onlyId);
    expect(down.collections[0]!.items.map((i) => i.id)).toEqual([onlyId]);
  });
});

describe("reorderItems", () => {
  function setupThree() {
    const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "API");
    const { workspace: w1, requestId: a } = createRequest(workspace, { collectionId }, "A", sampleRequestConfig());
    const { workspace: w2, requestId: b } = createRequest(w1, { collectionId }, "B", sampleRequestConfig());
    const { workspace: w3, requestId: c } = createRequest(w2, { collectionId }, "C", sampleRequestConfig());
    return { workspace: w3, collectionId, a, b, c };
  }

  it("moves an item to an arbitrary target index within a container (not just adjacent swap)", () => {
    const { workspace, collectionId, a, b, c } = setupThree();
    const moved = reorderItems(workspace, { collectionId }, a, 2);
    expect(moved.collections[0]!.items.map((i) => i.id)).toEqual([b, c, a]);
  });

  it("moves an item earlier in the list", () => {
    const { workspace, collectionId, a, b, c } = setupThree();
    const moved = reorderItems(workspace, { collectionId }, c, 0);
    expect(moved.collections[0]!.items.map((i) => i.id)).toEqual([c, a, b]);
  });

  it("clamps an out-of-range target index to the container's bounds", () => {
    const { workspace, collectionId, a, b, c } = setupThree();
    const moved = reorderItems(workspace, { collectionId }, a, 999);
    expect(moved.collections[0]!.items.map((i) => i.id)).toEqual([b, c, a]);
  });

  it("is a no-op when the item is already at the target index", () => {
    const { workspace, collectionId, a, b, c } = setupThree();
    const moved = reorderItems(workspace, { collectionId }, a, 0);
    expect(moved.collections[0]!.items.map((i) => i.id)).toEqual([a, b, c]);
  });

  it("is a no-op when the item is not found in the container", () => {
    const { workspace, collectionId } = setupThree();
    const moved = reorderItems(workspace, { collectionId }, "nonexistent", 1);
    expect(moved.collections[0]!.items.map((i) => i.name)).toEqual(["A", "B", "C"]);
  });

  it("reorders within a nested folder without disturbing sibling containers", () => {
    const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "API");
    const { workspace: withFolder, folderId } = createFolder(workspace, collectionId, "Folder");
    const { workspace: w1, requestId: x } = createRequest(
      withFolder,
      { collectionId, folderPath: [folderId] },
      "X",
      sampleRequestConfig(),
    );
    const { workspace: w2, requestId: y } = createRequest(
      w1,
      { collectionId, folderPath: [folderId] },
      "Y",
      sampleRequestConfig(),
    );

    const moved = reorderItems(w2, { collectionId, folderPath: [folderId] }, y, 0);
    const items = getRequestsAtLocation(moved, collectionId, [folderId]);
    expect(items.map((r) => r.id)).toEqual([y, x]);
  });
});
