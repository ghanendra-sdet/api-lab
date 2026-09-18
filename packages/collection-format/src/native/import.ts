import { isFolder, type CollectionItem } from "@api-lab/workspace-engine";
import type { NormalizedCollectionImport, NormalizedEnvironmentImport, NormalizedItem, NormalizedWorkspaceImport } from "../types.ts";
import { nativeExportSchema, type NativeExport } from "./schema.ts";

export type NativeParseResult = { ok: true; data: NativeExport } | { ok: false; detail: string };

export function parseNativeExport(raw: unknown): NativeParseResult {
  const parsed = nativeExportSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, detail: `Not a recognizable API Lab export file: ${parsed.error.issues[0]?.message ?? "invalid shape"}.` };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Converts a validated native export into the same NormalizedWorkspaceImport
 * shape every other format produces, so the app's single import-preview/
 * confirm flow works identically regardless of source. New stable IDs are
 * assigned on import — same policy as every other format (see
 * docs/ARCHITECTURE.md's Milestone 6 section) — re-importing a native
 * export is "restore a copy", not "resurrect the exact same objects".
 */
// Phase 2 of Workspace Management: `CollectionItem`/`NormalizedItem` folders
// both nest arbitrarily deep now, so this adapts the whole tree recursively
// instead of assuming one flat level of folders.
function adaptNativeItems(items: CollectionItem[]): NormalizedItem[] {
  return items.map(
    (item): NormalizedItem =>
      isFolder(item)
        ? { type: "folder", name: item.name, items: adaptNativeItems(item.items) }
        : { type: "request", name: item.name, request: item.request, warnings: [] },
  );
}

export function adaptNativeExport(data: NativeExport): NormalizedWorkspaceImport {
  const collections: NormalizedCollectionImport[] = data.workspace.collections.map((collection) => ({
    kind: "collection",
    name: collection.name,
    warnings: [],
    sourceFormat: "api-lab-native",
    items: adaptNativeItems(collection.items),
  }));

  const environments: NormalizedEnvironmentImport[] = data.environments.environments.map((env) => ({
    kind: "environment",
    name: env.name,
    warnings: [],
    sourceFormat: "api-lab-native",
    variables: env.variables.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled, secret: v.secret })),
  }));

  return { kind: "workspace", collections, environments, warnings: [], sourceFormat: "api-lab-native" };
}
