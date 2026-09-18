import type { BodyMode, BodyRawFormat, HttpMethod, KeyValueRow } from "@api-lab/shared";
import type { AuthConfig } from "@api-lab/auth-engine";
import type { Assertion } from "@api-lab/test-engine";
import type { Extraction } from "@api-lab/runner-engine";
import type { Variable } from "@api-lab/environment-engine";

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
 *
 * `extractions` (Milestone 8) is a list of serializable, non-executable
 * rules for pulling a value out of this request's response into a runtime
 * variable a later request can reference — see @api-lab/runner-engine.
 * Requests saved before Milestone 8 have no `extractions` field; schema.ts
 * defaults it to `[]` on load.
 *
 * `dependsOn` (Milestone B3.1) is an ordered list of other `SavedRequest`
 * IDs this request declares as prerequisites — data model and graph
 * validation only in this phase, see @api-lab/workspace-engine's
 * `dependencyGraph.ts`. No request currently executes another request;
 * that orchestration is a later B3 phase. Requests saved before B3.1 have
 * no `dependsOn` field; schema.ts leaves it undefined on load.
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
  extractions: Extraction[];
  preRequestScript?: string;
  postResponseScript?: string;
  dependsOn?: string[];
  variables?: Variable[];
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
  /**
   * Phase 2 of Workspace Management: folders nest arbitrarily deep — an item
   * here may itself be another `Folder`. Every lookup/update over this field
   * must recurse (see `internal.ts`'s `findFolder`/`withItemsAtLocation` and
   * `folder.ts`'s CRUD functions). Backward compatible with every folder
   * persisted before this phase: a pre-Phase-2 flat folder is simply one
   * whose `items` happen to contain zero `Folder` entries — nothing about
   * the old shape needs migrating, see `schema.ts`.
   */
  items: CollectionItem[];
  createdAt: string;
  updatedAt: string;
  variables?: Variable[];
  auth?: AuthConfig;
}

export type CollectionItem = SavedRequest | Folder;

export interface Collection {
  id: string;
  name: string;
  description?: string;
  items: CollectionItem[];
  createdAt: string;
  updatedAt: string;
  variables?: Variable[];
  auth?: AuthConfig;
}

export interface Workspace {
  collections: Collection[];
}

/**
 * Addresses where a request lives: directly in a collection, or nested
 * inside one or more folders. `folderPath` is the ordered ancestor chain
 * of folder ids, outermost first (e.g. `[grandparentId, parentId]` for a
 * request inside `parent`, which is inside `grandparent`). Omitted or an
 * empty array means the request lives directly in the collection.
 *
 * Phase 2 of Workspace Management renamed this from a single optional
 * `folderId` to this ordered chain, since folders can now nest arbitrarily
 * deep and several call sites (the Runner's folder-scoping, D.1's
 * ancestor-chain variable/auth inheritance) need the *full* chain, not just
 * the immediate parent.
 */
export interface RequestLocation {
  collectionId: string;
  folderPath?: string[];
}

export const WORKSPACE_FORMAT_VERSION = 1;

export interface PersistedWorkspace {
  version: number;
  workspace: Workspace;
}

/**
 * Phase 1 of Workspace Management: a registry of independent workspaces,
 * each pointing at its own persisted `Workspace{collections}` blob (see
 * apps/web/src/lib/persistence.ts for the storage-key mapping). This type is
 * deliberately minimal — no nested `Workspace` data lives here, just enough
 * metadata to list and switch between workspaces. Environments, globals, and
 * history remain global across all workspaces for Phase 1 (a documented
 * product decision, see plan.md) — nothing about those changes here.
 */
export interface WorkspaceMeta {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRegistry {
  workspaces: WorkspaceMeta[];
  activeWorkspaceId: string;
}

export const WORKSPACE_REGISTRY_FORMAT_VERSION = 1;

export interface PersistedWorkspaceRegistry {
  version: number;
  registry: WorkspaceRegistry;
}
