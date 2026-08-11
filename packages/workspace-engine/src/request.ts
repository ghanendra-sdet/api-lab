import type { RequestConfig, RequestLocation, SavedRequest, Workspace } from "./types.ts";
import { createWorkspaceId } from "./id.ts";
import { getRequestsAtLocation, isRequest, touch, withItemsAtLocation } from "./internal.ts";

export function createRequest(
  workspace: Workspace,
  location: RequestLocation,
  name: string,
  request: RequestConfig,
): { workspace: Workspace; requestId: string } {
  const now = touch();
  const saved: SavedRequest = {
    id: createWorkspaceId("req"),
    type: "request",
    name,
    request,
    createdAt: now,
    updatedAt: now,
  };
  const next = withItemsAtLocation(workspace, location.collectionId, location.folderId, (items) => [
    ...items,
    saved,
  ]);
  return { workspace: next, requestId: saved.id };
}

export function renameRequest(
  workspace: Workspace,
  location: RequestLocation,
  requestId: string,
  name: string,
): Workspace {
  return withItemsAtLocation(workspace, location.collectionId, location.folderId, (items) =>
    items.map((item) => (isRequest(item) && item.id === requestId ? { ...item, name, updatedAt: touch() } : item)),
  );
}

export function updateRequestConfig(
  workspace: Workspace,
  location: RequestLocation,
  requestId: string,
  request: RequestConfig,
): Workspace {
  return withItemsAtLocation(workspace, location.collectionId, location.folderId, (items) =>
    items.map((item) =>
      isRequest(item) && item.id === requestId ? { ...item, request, updatedAt: touch() } : item,
    ),
  );
}

export function deleteRequest(workspace: Workspace, location: RequestLocation, requestId: string): Workspace {
  return withItemsAtLocation(workspace, location.collectionId, location.folderId, (items) =>
    items.filter((item) => !(isRequest(item) && item.id === requestId)),
  );
}

export function duplicateRequest(
  workspace: Workspace,
  location: RequestLocation,
  requestId: string,
): { workspace: Workspace; requestId: string } {
  const source = getRequestsAtLocation(workspace, location.collectionId, location.folderId).find(
    (r) => r.id === requestId,
  );
  if (!source) throw new Error(`Request not found: ${requestId}`);

  const now = touch();
  const copy: SavedRequest = {
    id: createWorkspaceId("req"),
    type: "request",
    name: `${source.name} Copy`,
    // Deep clone via JSON round-trip: request configs are plain JSON-safe
    // data (methods, strings, KeyValueRow[]), never functions/class
    // instances, so this can't silently share mutable state with the source.
    request: JSON.parse(JSON.stringify(source.request)) as RequestConfig,
    createdAt: now,
    updatedAt: now,
  };

  const next = withItemsAtLocation(workspace, location.collectionId, location.folderId, (items) => {
    const index = items.findIndex((item) => isRequest(item) && item.id === requestId);
    const insertAt = index === -1 ? items.length : index + 1;
    return [...items.slice(0, insertAt), copy, ...items.slice(insertAt)];
  });

  return { workspace: next, requestId: copy.id };
}

export function moveRequest(
  workspace: Workspace,
  from: RequestLocation,
  to: RequestLocation,
  requestId: string,
): Workspace {
  const source = getRequestsAtLocation(workspace, from.collectionId, from.folderId).find(
    (r) => r.id === requestId,
  );
  if (!source) throw new Error(`Request not found: ${requestId}`);

  const removed = withItemsAtLocation(workspace, from.collectionId, from.folderId, (items) =>
    items.filter((item) => !(isRequest(item) && item.id === requestId)),
  );

  return withItemsAtLocation(removed, to.collectionId, to.folderId, (items) => [...items, source]);
}
