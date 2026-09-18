import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "./index.ts";
import { createCollection } from "./collection.ts";
import {
  createFolder,
  deleteFolder,
  moveFolder,
  renameFolder,
  updateFolderAuth,
  updateFolderVariables,
} from "./folder.ts";
import { createRequest } from "./request.ts";
import { getRequestsAtLocation } from "./internal.ts";
import { sampleRequestConfig } from "./testHelpers.ts";

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

// ---------------------------------------------------------------------------
// Phase 2 of Workspace Management: nested folders at depth 2/3, and
// cascading delete of a folder with subfolders.
// ---------------------------------------------------------------------------

describe("createFolder (nested)", () => {
  it("creates a subfolder inside an existing folder (depth 2)", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: withParent, folderId: parentId } = createFolder(workspace, collectionId, "Parent");
    const { workspace: next, folderId: childId } = createFolder(withParent, collectionId, "Child", parentId);

    const parent = next.collections[0]!.items.find((i) => i.id === parentId)!;
    expect(parent.type).toBe("folder");
    if (parent.type !== "folder") return;
    expect(parent.items).toHaveLength(1);
    expect(parent.items[0]).toMatchObject({ id: childId, type: "folder", name: "Child" });
  });

  it("creates a subfolder three levels deep (depth 3) and requests resolve at that path", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: w1, folderId: grandparentId } = createFolder(workspace, collectionId, "Grandparent");
    const { workspace: w2, folderId: parentId } = createFolder(w1, collectionId, "Parent", grandparentId);
    const { workspace: w3, folderId: childId } = createFolder(w2, collectionId, "Child", parentId);
    const { workspace: w4, requestId } = createRequest(
      w3,
      { collectionId, folderPath: [grandparentId, parentId, childId] },
      "Deep Request",
      sampleRequestConfig(),
    );

    const requests = getRequestsAtLocation(w4, collectionId, [grandparentId, parentId, childId]);
    expect(requests.map((r) => r.id)).toEqual([requestId]);
  });

  it("throws when the parent folder id does not exist anywhere in the collection", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    expect(() => createFolder(workspace, collectionId, "Orphan", "nonexistent-folder-id")).toThrow(
      /Folder not found/,
    );
  });
});

describe("renameFolder / updateFolderVariables / updateFolderAuth (nested)", () => {
  it("finds and updates a subfolder at any depth by id, leaving ancestors and siblings untouched", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: w1, folderId: parentId } = createFolder(workspace, collectionId, "Parent");
    const { workspace: w2, folderId: childId } = createFolder(w1, collectionId, "Child", parentId);
    const { workspace: w3, folderId: siblingId } = createFolder(w2, collectionId, "Sibling", parentId);

    const renamed = renameFolder(w3, collectionId, childId, "Renamed Child");
    const parent = renamed.collections[0]!.items.find((i) => i.id === parentId)!;
    expect(parent.type).toBe("folder");
    if (parent.type !== "folder") return;
    const child = parent.items.find((i) => i.id === childId)!;
    const sibling = parent.items.find((i) => i.id === siblingId)!;
    expect(child.name).toBe("Renamed Child");
    expect(sibling.name).toBe("Sibling");
    expect(parent.name).toBe("Parent");

    const withVars = updateFolderVariables(renamed, collectionId, childId, [
      { id: "v1", key: "k", value: "v", enabled: true, secret: false },
    ]);
    const updatedChild = (
      withVars.collections[0]!.items.find((i) => i.id === parentId) as { items: { id: string }[] }
    )!.items.find((i) => i.id === childId) as { variables?: unknown };
    expect(updatedChild.variables).toEqual([{ id: "v1", key: "k", value: "v", enabled: true, secret: false }]);

    const withAuth = updateFolderAuth(withVars, collectionId, childId, { type: "bearer", token: "t" });
    const authChild = (
      withAuth.collections[0]!.items.find((i) => i.id === parentId) as { items: { id: string }[] }
    )!.items.find((i) => i.id === childId) as { auth?: unknown };
    expect(authChild.auth).toEqual({ type: "bearer", token: "t" });
  });
});

describe("deleteFolder (cascading, nested)", () => {
  it("deleting a folder with subfolders removes the whole subtree, leaving siblings intact", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: w1, folderId: parentId } = createFolder(workspace, collectionId, "Parent");
    const { workspace: w2, folderId: childId } = createFolder(w1, collectionId, "Child", parentId);
    const { workspace: w3, folderId: grandchildId } = createFolder(w2, collectionId, "Grandchild", childId);
    const { workspace: w4 } = createRequest(
      w3,
      { collectionId, folderPath: [parentId, childId, grandchildId] },
      "Doomed Request",
      sampleRequestConfig(),
    );
    const { workspace: w5 } = createFolder(w4, collectionId, "Survivor");

    const result = deleteFolder(w5, collectionId, parentId);
    const items = result.collections[0]!.items;
    // Only "Survivor" remains — "Parent" and everything nested inside it
    // (Child, Grandchild, and the request) are gone in one step.
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Survivor");
  });

  it("deleting an inner subfolder (not the top-level ancestor) only removes that subtree", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: w1, folderId: parentId } = createFolder(workspace, collectionId, "Parent");
    const { workspace: w2, folderId: childAId } = createFolder(w1, collectionId, "ChildA", parentId);
    const { workspace: w3 } = createFolder(w2, collectionId, "ChildB", parentId);

    const result = deleteFolder(w3, collectionId, childAId);
    const parent = result.collections[0]!.items.find((i) => i.id === parentId)!;
    expect(parent.type).toBe("folder");
    if (parent.type !== "folder") return;
    expect(parent.items).toHaveLength(1);
    expect(parent.items[0]!.name).toBe("ChildB");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 of Workspace Management: moving a folder (and its subtree) between
// containers, path-aware at arbitrary depth.
// ---------------------------------------------------------------------------

describe("moveFolder", () => {
  it("moves a folder from a collection's top level into another folder, keeping its subtree intact", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: w1, folderId: targetId } = createFolder(workspace, collectionId, "Target");
    const { workspace: w2, folderId: movedId } = createFolder(w1, collectionId, "Moved");
    const { workspace: w3, folderId: childId } = createFolder(w2, collectionId, "Child", movedId);

    const result = moveFolder(w3, { collectionId }, { collectionId, folderPath: [targetId] }, movedId);

    // No longer at the top level.
    expect(result.collections[0]!.items.find((i) => i.id === movedId)).toBeUndefined();
    const target = result.collections[0]!.items.find((i) => i.id === targetId)!;
    expect(target.type).toBe("folder");
    if (target.type !== "folder") return;
    const moved = target.items.find((i) => i.id === movedId)!;
    expect(moved.type).toBe("folder");
    if (moved.type !== "folder") return;
    // Its own subtree (Child) survived the move.
    expect(moved.items.map((i) => i.id)).toEqual([childId]);
  });

  it("moves a folder out of a nested folder back to the collection root", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: w1, folderId: parentId } = createFolder(workspace, collectionId, "Parent");
    const { workspace: w2, folderId: childId } = createFolder(w1, collectionId, "Child", parentId);

    const result = moveFolder(w2, { collectionId, folderPath: [parentId] }, { collectionId }, childId);

    const parent = result.collections[0]!.items.find((i) => i.id === parentId)!;
    expect(parent.type).toBe("folder");
    if (parent.type !== "folder") return;
    expect(parent.items).toHaveLength(0);
    expect(result.collections[0]!.items.some((i) => i.id === childId)).toBe(true);
  });

  it("throws rather than move a folder into its own descendant", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    const { workspace: w1, folderId: parentId } = createFolder(workspace, collectionId, "Parent");
    const { workspace: w2, folderId: childId } = createFolder(w1, collectionId, "Child", parentId);

    expect(() =>
      moveFolder(w2, { collectionId }, { collectionId, folderPath: [parentId, childId] }, parentId),
    ).toThrow(/own descendant/);
  });

  it("throws when the folder id does not exist anywhere in the source collection", () => {
    const workspace = setup();
    const collectionId = workspace.collections[0]!.id;
    expect(() => moveFolder(workspace, { collectionId }, { collectionId }, "nonexistent")).toThrow(
      /Folder not found/,
    );
  });
});
