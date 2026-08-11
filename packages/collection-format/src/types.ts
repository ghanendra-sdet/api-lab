import type { RequestConfig } from "@api-lab/workspace-engine";

/**
 * Format-independent import result. Parsers/adapters for every external
 * format (Postman, OpenAPI, future formats) all produce this same shape —
 * the workspace-integration code (apps/web) and the preview UI only ever
 * need to understand this model, never Postman's or OpenAPI's JSON shape
 * directly. `RequestConfig` (from workspace-engine) is reused as-is rather
 * than introducing a fourth request shape — every adapter's job is to
 * produce a valid one, warning when a source feature can't be represented.
 */
export interface NormalizedRequest {
  type: "request";
  name: string;
  request: RequestConfig;
  /** Per-request warnings (e.g. "form-data body preserved but not executable"). */
  warnings: string[];
}

export interface NormalizedFolder {
  type: "folder";
  name: string;
  items: NormalizedRequest[];
}

export type NormalizedItem = NormalizedFolder | NormalizedRequest;

export interface NormalizedCollectionImport {
  kind: "collection";
  name: string;
  items: NormalizedItem[];
  /** Collection-level warnings (e.g. "3 scripts were not imported"). */
  warnings: string[];
  /** Where this import came from — drives preview copy and future format-specific handling. */
  sourceFormat: "postman-collection" | "openapi" | "api-lab-native";
}

export interface NormalizedVariable {
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export interface NormalizedEnvironmentImport {
  kind: "environment";
  name: string;
  variables: NormalizedVariable[];
  warnings: string[];
  sourceFormat: "postman-environment" | "api-lab-native";
}

/** A native import can restore both collections and environments at once. */
export interface NormalizedWorkspaceImport {
  kind: "workspace";
  collections: NormalizedCollectionImport[];
  environments: NormalizedEnvironmentImport[];
  warnings: string[];
  sourceFormat: "api-lab-native";
}

export type NormalizedImport = NormalizedCollectionImport | NormalizedEnvironmentImport | NormalizedWorkspaceImport;

export type DetectedFormat =
  | "postman-collection"
  | "postman-environment"
  | "openapi"
  | "api-lab-native"
  | "unknown";

export type ParseResult =
  | { ok: true; data: NormalizedImport }
  | { ok: false; reason: "invalid-json" | "unrecognized-format" | "invalid-shape" | "too-large"; detail: string };

/** Import files larger than this are rejected before parsing — a
 * maliciously huge JSON document must never be handed to JSON.parse or a
 * recursive adapter walk. See docs/SECURITY.md. */
export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
