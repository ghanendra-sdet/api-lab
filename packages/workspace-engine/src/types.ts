import type { BodyMode, BodyRawFormat, HttpMethod, KeyValueRow } from "@api-lab/shared";
import type { AuthConfig } from "@api-lab/auth-engine";
import type { Assertion } from "@api-lab/test-engine";

/**
 * The persisted, request-engine-agnostic shape of a request's configuration.
 * Deliberately excludes scripts/environment fields — those belong to their
 * own milestones and are not part of the collection format yet (see
 * docs/ROADMAP.md). Designed so those fields can be added later without
 * breaking existing saved data (additive, optional fields).
 *
 * `auth` replaces Milestone 2–4's cosmetic `authType: AuthType` field
 * (which never actually affected a sent request — the Auth panel was a
 * placeholder until this milestone). Saved requests from before Milestone 5
 * have no `auth` field at all; schema.ts defaults it to `{ type: "none" }`
 * on load rather than attempting to reconstruct real credentials that were
 * never stored — see docs/ARCHITECTURE.md's Milestone 5 section.
 *
 * `tests` (Milestone 7) is a list of serializable, non-executable
 * assertions — see @api-lab/test-engine. Requests saved before Milestone 7
 * have no `tests` field; schema.ts defaults it to `[]` on load.
 */
export interface RequestConfig {
  method: HttpMethod;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  auth: AuthConfig;
  bodyMode: BodyMode;
  bodyRawFormat: BodyRawFormat;
  bodyRawContent: string;
  tests: Assertion[];
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
