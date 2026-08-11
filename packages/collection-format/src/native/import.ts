import { isFolder } from "@api-lab/workspace-engine";
import type { NormalizedCollectionImport, NormalizedEnvironmentImport, NormalizedItem, NormalizedWorkspaceImport } from "../types";
import { nativeExportSchema, type NativeExport } from "./schema";

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
export function adaptNativeExport(data: NativeExport): NormalizedWorkspaceImport {
  const collections: NormalizedCollectionImport[] = data.workspace.collections.map((collection) => ({
    kind: "collection",
    name: collection.name,
    warnings: [],
    sourceFormat: "api-lab-native",
    items: collection.items.map(
      (item): NormalizedItem =>
        isFolder(item)
          ? {
              type: "folder",
              name: item.name,
              items: item.items.map((r) => ({ type: "request", name: r.name, request: r.request, warnings: [] })),
            }
          : { type: "request", name: item.name, request: item.request, warnings: [] },
    ),
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
