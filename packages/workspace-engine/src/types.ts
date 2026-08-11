import type { AuthType, BodyMode, BodyRawFormat, HttpMethod, KeyValueRow } from "@api-lab/shared";

/**
 * The persisted, request-engine-agnostic shape of a request's configuration.
 * Deliberately excludes scripts/tests/auth-execution/environment fields —
 * those belong to their own milestones and are not part of the collection
 * format yet (see docs/ROADMAP.md). Designed so those fields can be added
 * later without breaking existing saved data (additive, optional fields).
 */
export interface RequestConfig {
  method: HttpMethod;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  authType: AuthType;
  bodyMode: BodyMode;
  bodyRawFormat: BodyRawFormat;
  bodyRawContent: string;
}

export interface SavedRequest {
  id: string;
  type: "request";
  name: string;
  request: RequestConfig;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  type: "folder";
  name: string;
  /** Folders are one level deep — items here are requests only. */
  items: SavedRequest[];
  createdAt: string;
  updatedAt: string;
}

export type CollectionItem = SavedRequest | Folder;

export interface Collection {
  id: string;
  name: string;
  description?: string;
  items: CollectionItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  collections: Collection[];
}

/** Addresses where a request lives: directly in a collection, or inside one of its folders. */
export interface RequestLocation {
  collectionId: string;
  folderId?: string;
}

export const WORKSPACE_FORMAT_VERSION = 1;

export interface PersistedWorkspace {
  version: number;
  workspace: Workspace;
}
