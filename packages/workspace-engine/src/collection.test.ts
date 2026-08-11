import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "./index";
import { createCollection, deleteCollection, renameCollection } from "./collection";
import { createFolder } from "./folder";
import { createRequest } from "./request";
import { sampleRequestConfig } from "./testHelpers";

describe("createCollection", () => {
  it("adds a new empty collection and returns its id", () => {
    const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "My API");
    expect(workspace.collections).toHaveLength(1);
    expect(workspace.collections[0]).toMatchObject({ id: collectionId, name: "My API", items: [] });
  });

  it("gives each collection a stable, distinct id", () => {
    const first = createCollection(createEmptyWorkspace(), "A");
    const second = createCollection(first.workspace, "B");
    expect(second.collectionId).not.toBe(first.collectionId);
  });
});

describe("renameCollection", () => {
  it("renames only the targeted collection", () => {
    const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "Old Name");
    const renamed = renameCollection(workspace, collectionId, "New Name");
    expect(renamed.collections[0]!.name).toBe("New Name");
  });
});

describe("deleteCollection", () => {
  it("removes the collection and everything inside it", () => {
    const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "Doomed");
    const { workspace: withFolder } = createFolder(workspace, collectionId, "Folder");
    const { workspace: withRequest } = createRequest(
      withFolder,
      { collectionId },
      "Req",
      sampleRequestConfig(),
    );

    const result = deleteCollection(withRequest, collectionId);
    expect(result.collections).toHaveLength(0);
  });

  it("leaves other collections untouched", () => {
    const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "A");
    const { workspace: withB, collectionId: bId } = createCollection(workspace, "B");
    const result = deleteCollection(withB, collectionId);
    expect(result.collections.map((c) => c.id)).toEqual([bId]);
  });
});
