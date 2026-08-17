import type { AuthConfig } from "@api-lab/auth-engine";

/**
 * Resolves a Request's `{type:"inherit"}` auth against its containing
 * Folder and Collection, per D.1 Step 5's inheritance rules.
 *
 * Lives at the app layer, not `auth-engine`: auth-engine only knows how to
 * *apply* a concrete, already-resolved `AuthConfig` (see `apply.ts`'s
 * docstring) — it has no concept of a Collection or Folder. This is the
 * composition point, mirroring how `authResolve.ts`'s `resolveAuthConfig`
 * (variable interpolation) is also app-layer for the same reason.
 *
 * Rules:
 * - Request has explicit (non-inherit) auth, including explicit
 *   `{type:"none"}` → use it as-is. Explicit "none" disables inheritance;
 *   it is NOT the same thing as "inherit".
 * - Request is `{type:"inherit"}` → look at the containing Folder's auth
 *   (skipped entirely if the request has no folder, i.e. lives directly in
 *   a collection).
 *   - Folder has explicit auth → use the Folder's auth.
 *   - Folder is `{type:"inherit"}` (or there is no folder) → look at the
 *     containing Collection's auth.
 *     - Collection has explicit auth (including "none") → use it.
 *     - Collection is somehow `{type:"inherit"}` too (should not happen —
 *       Collection's schema/creation default is "none", never "inherit",
 *       see workspace-engine's `schema.ts`/`collection.ts`) → fall through
 *       to "none" rather than recursing further.
 *
 * Cycle guard: this is a fixed, non-recursive 3-level lookup (Request →
 * Folder → Collection) driven by the caller's already-resolved container
 * objects, not a graph walk — there is no path back to a request or folder,
 * so no cycle can occur. The Collection case is still handled defensively
 * (falls through to "none" instead of ever re-consulting anything) so a
 * malformed/legacy document can never cause unbounded resolution.
 */
export function resolveInheritedAuth(
  requestAuth: AuthConfig,
  folderAuth: AuthConfig | undefined,
  collectionAuth: AuthConfig | undefined,
): AuthConfig {
  if (requestAuth.type !== "inherit") return requestAuth;

  if (folderAuth && folderAuth.type !== "inherit") return folderAuth;

  if (collectionAuth && collectionAuth.type !== "inherit") return collectionAuth;

  // Nothing concrete found anywhere in the chain (no folder/collection, or
  // both still "inherit", which should not happen for a Collection but is
  // handled defensively) — the safe, non-recursing default is "No Auth".
  return { type: "none" };
}
