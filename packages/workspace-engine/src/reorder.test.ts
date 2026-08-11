import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "./index.ts";
import { createCollection } from "./collection.ts";
import { createRequest } from "./request.ts";
import { moveCollectionDown, moveCollectionUp, moveItemDown, moveItemUp } from "./reorder.ts";
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
