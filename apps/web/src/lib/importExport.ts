import { createCollection, createFolder, createRequest, type Workspace } from "@api-lab/workspace-engine";
import { createEnvironment, addVariable, updateVariable, type EnvironmentWorkspace } from "@api-lab/environment-engine";
import type { NormalizedCollectionImport, NormalizedEnvironmentImport, NormalizedItem } from "@api-lab/collection-format";

/** Non-destructive collision handling: an imported name that already exists
 * gets a distinguishing suffix rather than silently overwriting or
 * blocking the import — see docs/ARCHITECTURE.md's Milestone 6 section. */
function uniqueName(existing: Set<string>, name: string): string {
  if (!existing.has(name)) return name;
  let candidate = `${name} (Imported)`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${name} (Imported ${n})`;
    n += 1;
  }
  return candidate;
}

/**
 * Recreates a (possibly nested — see `packages/collection-format`'s
 * de-flattened Postman import, Phase 2 of Workspace Management) tree of
 * `NormalizedItem`s under a collection or folder. `parentFolderPath` is the
 * ordered ancestor chain (outermost first) of the folder being populated —
 * empty for the collection's own top level — and grows by one id each time
 * a nested `NormalizedFolder` is recursed into, so import depth is no
 * longer capped at one level.
 */
function applyItems(
  workspace: Workspace,
  collectionId: string,
  items: NormalizedItem[],
  parentFolderPath: string[],
): Workspace {
  let w = workspace;
  const immediateParentId = parentFolderPath[parentFolderPath.length - 1];
  for (const item of items) {
    if (item.type === "folder") {
      const folderResult = createFolder(w, collectionId, item.name, immediateParentId);
      w = applyItems(folderResult.workspace, collectionId, item.items, [...parentFolderPath, folderResult.folderId]);
    } else {
      w = createRequest(w, { collectionId, folderPath: parentFolderPath }, item.name, item.request).workspace;
    }
  }
  return w;
}

export function applyCollectionImport(
  workspace: Workspace,
  normalized: NormalizedCollectionImport,
): { workspace: Workspace; collectionId: string } {
  const name = uniqueName(new Set(workspace.collections.map((c) => c.name)), normalized.name);
  const created = createCollection(workspace, name);
  const collectionId = created.collectionId;
  const w = applyItems(created.workspace, collectionId, normalized.items, []);
  return { workspace: w, collectionId };
}

export function applyEnvironmentImport(
  environments: EnvironmentWorkspace,
  normalized: NormalizedEnvironmentImport,
): { workspace: EnvironmentWorkspace; environmentId: string } {
  const name = uniqueName(new Set(environments.environments.map((e) => e.name)), normalized.name);
  const created = createEnvironment(environments, name);
  let w = created.workspace;

  for (const variable of normalized.variables) {
    const added = addVariable(w, created.environmentId);
    w = updateVariable(added.workspace, created.environmentId, added.variableId, {
      key: variable.key,
      value: variable.value,
      enabled: variable.enabled,
      secret: variable.secret,
    });
  }

  return { workspace: w, environmentId: created.environmentId };
}

/** Triggers a browser download of JSON data — used for every export path
 * (Postman collection export, native workspace export). Client-side only,
 * no server round-trip. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function slugifyFilename(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}
