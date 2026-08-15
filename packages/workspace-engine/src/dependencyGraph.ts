/**
 * Pure dependency-graph validation for Milestone B3 (Request Chaining).
 *
 * `RequestConfig.dependsOn` (see types.ts) lets a saved request declare that
 * one or more other saved requests must run before it. This module only
 * validates and orders that declared graph — it has no knowledge of HTTP,
 * scripts, extraction, or execution of any kind, and must stay that way so
 * it can be unit-tested and reasoned about independently of
 * `executeRequestConfig` (see docs/ARCHITECTURE.md's B3 discovery notes).
 *
 * Two call sites are expected to use this, at different times:
 * - Save time: reject a `dependsOn` edit that would introduce a cycle,
 *   duplicate, or self-reference before it's ever persisted.
 * - Send time (a future milestone, not implemented here): re-validate and
 *   obtain a deterministic execution order, since a workspace could contain
 *   a cycle baked in by an import that bypassed the save-time check.
 */

/** A minimal view of the workspace: each known request ID mapped to the IDs
 * it declares as `dependsOn`. Callers build this from the real workspace
 * tree; this module never reads a `Workspace`/`Collection` itself. */
export type DependencyMap = Record<string, string[]>;

export type DependencyValidationError =
  | { type: "self-dependency"; requestId: string }
  | { type: "circular-dependency"; chain: string[] }
  | { type: "missing-dependency"; requestId: string; missingId: string }
  | { type: "duplicate-dependency"; requestId: string; duplicateId: string };

export interface DependencyResolutionSuccess {
  ok: true;
  /** Dependencies before dependents, in a deterministic order derived from
   * each request's declared `dependsOn` order, always ending with
   * `requestId` itself. */
  order: string[];
}

export interface DependencyResolutionFailure {
  ok: false;
  error: DependencyValidationError;
}

export type DependencyResolutionResult = DependencyResolutionSuccess | DependencyResolutionFailure;

/**
 * Finds a duplicate ID within a single request's own `dependsOn` list, if
 * any. Intentionally separate from graph traversal — this is a same-request
 * data-entry mistake, not a cross-request graph problem, and should be
 * caught immediately regardless of whether the referenced IDs even exist.
 */
export function findDuplicateDependency(dependsOn: string[]): string | null {
  const seen = new Set<string>();
  for (const id of dependsOn) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/**
 * Validates and orders the transitive dependency graph rooted at
 * `requestId`, using `dependencies` as the lookup for every request's own
 * `dependsOn` list (including `requestId`'s).
 *
 * Traversal is a depth-first post-order walk, visiting each request's
 * declared dependencies in the order they were declared, which is what
 * produces the deterministic ordering guarantee: independent dependencies
 * keep their declared relative order, and a dependency's own transitive
 * dependencies always precede it.
 */
export function resolveDependencyOrder(requestId: string, dependencies: DependencyMap): DependencyResolutionResult {
  const order: string[] = [];
  const resolved = new Set<string>();
  /** Nodes currently on the DFS stack — a re-visit of one of these is a cycle. */
  const inProgress: string[] = [];

  function visit(id: string): DependencyValidationError | null {
    if (resolved.has(id)) return null;

    const cycleIndex = inProgress.indexOf(id);
    if (cycleIndex !== -1) {
      return { type: "circular-dependency", chain: [...inProgress.slice(cycleIndex), id] };
    }

    const dependsOn = dependencies[id];
    if (dependsOn === undefined) {
      // A request with no known entry has, by definition, no dependencies
      // of its own — it's a valid leaf. (A *reference to* an unknown ID
      // from another request is a separate, explicit missing-dependency
      // error, raised at the referencing side below.)
      resolved.add(id);
      return null;
    }

    const duplicate = findDuplicateDependency(dependsOn);
    if (duplicate) {
      return { type: "duplicate-dependency", requestId: id, duplicateId: duplicate };
    }

    inProgress.push(id);

    for (const depId of dependsOn) {
      if (depId === id) {
        return { type: "self-dependency", requestId: id };
      }
      if (dependencies[depId] === undefined) {
        // A dependency isn't automatically "missing" just because it has no
        // entry in the map — a leaf request legitimately has no dependsOn
        // entry at all. It's missing only when nothing in the workspace
        // recognizes that ID. Callers are expected to pass a `dependencies`
        // map that includes every real request ID (even leaves, mapped to
        // `[]`) so this check is meaningful — see resolveDependencyOrder's
        // doc comment and dependencyGraph.test.ts.
        return { type: "missing-dependency", requestId: id, missingId: depId };
      }

      const err = visit(depId);
      if (err) return err;
    }

    inProgress.pop();
    resolved.add(id);
    order.push(id);
    return null;
  }

  const error = visit(requestId);
  if (error) return { ok: false, error };

  return { ok: true, order };
}

/** Renders a circular-dependency chain as `A → B → C → A`, matching the
 * format shown to users elsewhere in the app for chained failures. */
export function formatCircularDependencyChain(chain: string[]): string {
  return chain.join(" → ");
}
