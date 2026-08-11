import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "./index";
import { createCollection } from "./collection";
import { createFolder } from "./folder";
import {
  createRequest,
  deleteRequest,
  duplicateRequest,
  moveRequest,
  renameRequest,
  updateRequestConfig,
} from "./request";
import { getRequestsAtLocation } from "./internal";
import { sampleRequestConfig } from "./testHelpers";

function setupCollection() {
  const { workspace, collectionId } = createCollection(createEmptyWorkspace(), "API");
  return { workspace, collectionId };
}

describe("createRequest", () => {
  it("adds a request directly under a collection", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: next, requestId } = createRequest(
      workspace,
      { collectionId },
      "Get Users",
      sampleRequestConfig(),
    );
    const requests = getRequestsAtLocation(next, collectionId, undefined);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.id).toBe(requestId);
  });

  it("adds a request inside a folder", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: withFolder, folderId } = createFolder(workspace, collectionId, "Auth");
    const { workspace: next, requestId } = createRequest(
      withFolder,
      { collectionId, folderId },
      "Login",
      sampleRequestConfig({ method: "POST" }),
    );
    const requests = getRequestsAtLocation(next, collectionId, folderId);
    expect(requests.map((r) => r.id)).toEqual([requestId]);
  });

  it("does not reorder existing folders/requests at the top level when adding a new request", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: withFolder, folderId } = createFolder(workspace, collectionId, "Z Folder");
    const { workspace: next } = createRequest(
      withFolder,
      { collectionId },
      "A Request",
      sampleRequestConfig(),
    );
    // The folder was created first — it must still come first, not be
    // pushed after top-level requests by type-based regrouping.
    const items = next.collections[0]!.items;
    expect(items[0]!.id).toBe(folderId);
    expect(items[1]!.name).toBe("A Request");
  });
});

describe("renameRequest", () => {
  it("renames the request without touching its configuration", () => {
    const { workspace, collectionId } = setupCollection();
    const config = sampleRequestConfig({ url: "https://example.com/keep-me" });
    const { workspace: withReq, requestId } = createRequest(workspace, { collectionId }, "Old", config);
    const renamed = renameRequest(withReq, { collectionId }, requestId, "New");
    const [request] = getRequestsAtLocation(renamed, collectionId, undefined);
    expect(request!.name).toBe("New");
    expect(request!.request.url).toBe("https://example.com/keep-me");
  });
});

describe("updateRequestConfig", () => {
  it("replaces the saved request configuration", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: withReq, requestId } = createRequest(
      workspace,
      { collectionId },
      "Req",
      sampleRequestConfig({ url: "https://example.com/old" }),
    );
    const updated = updateRequestConfig(
      withReq,
      { collectionId },
      requestId,
      sampleRequestConfig({ url: "https://example.com/new", method: "POST" }),
    );
    const [request] = getRequestsAtLocation(updated, collectionId, undefined);
    expect(request!.request.url).toBe("https://example.com/new");
    expect(request!.request.method).toBe("POST");
  });
});

describe("deleteRequest", () => {
  it("removes only the targeted request", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: w1, requestId: keepId } = createRequest(
      workspace,
      { collectionId },
      "Keep",
      sampleRequestConfig(),
    );
    const { workspace: w2, requestId: deleteId } = createRequest(
      w1,
      { collectionId },
      "Delete",
      sampleRequestConfig(),
    );
    const result = deleteRequest(w2, { collectionId }, deleteId);
    const requests = getRequestsAtLocation(result, collectionId, undefined);
    expect(requests.map((r) => r.id)).toEqual([keepId]);
  });
});

describe("duplicateRequest", () => {
  it("creates a distinct copy with its own id and a ' Copy' suffix", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: withReq, requestId } = createRequest(
      workspace,
      { collectionId },
      "Get Users",
      sampleRequestConfig(),
    );
    const { workspace: next, requestId: copyId } = duplicateRequest(withReq, { collectionId }, requestId);
    expect(copyId).not.toBe(requestId);
    const requests = getRequestsAtLocation(next, collectionId, undefined);
    const copy = requests.find((r) => r.id === copyId)!;
    expect(copy.name).toBe("Get Users Copy");
  });

  it("does not share mutable state with the original — editing the copy leaves the original untouched", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: withReq, requestId } = createRequest(
      workspace,
      { collectionId },
      "Get Users",
      sampleRequestConfig({ params: [{ id: "p1", key: "page", value: "1", enabled: true }] }),
    );
    const { workspace: withCopy, requestId: copyId } = duplicateRequest(withReq, { collectionId }, requestId);

    const updated = updateRequestConfig(
      withCopy,
      { collectionId },
      copyId,
      sampleRequestConfig({ params: [{ id: "p1", key: "page", value: "999", enabled: true }] }),
    );

    const requests = getRequestsAtLocation(updated, collectionId, undefined);
    const original = requests.find((r) => r.id === requestId)!;
    const copy = requests.find((r) => r.id === copyId)!;
    expect(original.request.params[0]!.value).toBe("1");
    expect(copy.request.params[0]!.value).toBe("999");
  });
});

describe("moveRequest", () => {
  it("moves a request from a collection's top level into a folder, preserving its id and config", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: withFolder, folderId } = createFolder(workspace, collectionId, "Users");
    const { workspace: withReq, requestId } = createRequest(
      withFolder,
      { collectionId },
      "Get Users",
      sampleRequestConfig({ url: "https://example.com/users" }),
    );

    const moved = moveRequest(withReq, { collectionId }, { collectionId, folderId }, requestId);

    expect(getRequestsAtLocation(moved, collectionId, undefined)).toHaveLength(0);
    const inFolder = getRequestsAtLocation(moved, collectionId, folderId);
    expect(inFolder).toHaveLength(1);
    expect(inFolder[0]!.id).toBe(requestId);
    expect(inFolder[0]!.request.url).toBe("https://example.com/users");
  });

  it("moves a request between two folders in the same collection", () => {
    const { workspace, collectionId } = setupCollection();
    const { workspace: w1, folderId: folderA } = createFolder(workspace, collectionId, "A");
    const { workspace: w2, folderId: folderB } = createFolder(w1, collectionId, "B");
    const { workspace: w3, requestId } = createRequest(
      w2,
      { collectionId, folderId: folderA },
      "Req",
      sampleRequestConfig(),
    );

    const moved = moveRequest(
      w3,
      { collectionId, folderId: folderA },
      { collectionId, folderId: folderB },
      requestId,
    );

    expect(getRequestsAtLocation(moved, collectionId, folderA)).toHaveLength(0);
    expect(getRequestsAtLocation(moved, collectionId, folderB).map((r) => r.id)).toEqual([requestId]);
  });
});
