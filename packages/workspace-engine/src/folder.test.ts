import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "./index";
import { createCollection } from "./collection";
import { createFolder, deleteFolder, renameFolder } from "./folder";

function setup() {
  return createCollection(createEmptyWorkspace(), "API").workspace;
}

describe("createFolder", () => {
  it("adds a folder inside the collection", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: next, folderId } = createFolder(workspace, collectionId, "Auth");
    const collection = next.collections[0]!;
    expect(collection.items).toHaveLength(1);
    expect(collection.items[0]).toMatchObject({ id: folderId, type: "folder", name: "Auth", items: [] });
  });
});

describe("renameFolder", () => {
  it("renames only the targeted folder", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: withFolder, folderId } = createFolder(workspace, collectionId, "Old");
    const { workspace: withBoth, folderId: otherFolderId } = createFolder(withFolder, collectionId, "Other");

    const renamed = renameFolder(withBoth, collectionId, folderId, "New");

    const collection = renamed.collections[0]!;
    const target = collection.items.find((i) => i.id === folderId);
    const other = collection.items.find((i) => i.id === otherFolderId);
    expect(target?.name).toBe("New");
    expect(other?.name).toBe("Other");
  });
});

describe("deleteFolder", () => {
  it("removes the folder and its contents, leaving siblings intact", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: withFolder, folderId } = createFolder(workspace, collectionId, "Doomed");
    const { workspace: withBoth } = createFolder(withFolder, collectionId, "Survivor");

    const result = deleteFolder(withBoth, collectionId, folderId);
    const items = result.collections[0]!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Survivor");
  });
});
