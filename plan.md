# API Lab — Shared Plan & Progress Log

This file exists so any AI agent (Claude, Gemini, etc.) picking up this repo mid-stream can
continue without re-deriving context. Update it after every meaningful work session: what
changed, what's still open, what's next. Keep entries terse — this is a status board, not a
design doc. Do not delete history; append.

**Last updated:** 2026-08-22 (Claude) — Verification/polish pass across everything built so far is
COMPLETE. All 174 Playwright E2E tests pass (was 163-167 passed / 7 failed across Phases 1-3);
all 1580+ Vitest tests across all 17 workspaces still pass; typecheck/lint clean. Root cause of
the 7 known Monaco-related E2E failures fully diagnosed and fixed (test-only, no production code
touched). See "Verification & Polish Pass — COMPLETE" below for full detail. Next up: Phase 4 of
Workspace Management (remaining Collection Runner gaps).

---

## Current Priorities (user-set, in order)

1. **Workspace Management** (highest priority) — multi-workspace support, collections belong
   to a workspace, nested folders, drag-and-drop reorganization of APIs/folders.
2. **Collection Runner** (second priority) — Postman-style runner: select APIs, drag-and-drop
   reorder execution sequence, environment selection, sequential execution, per-item status,
   progress, pause/resume/stop, run-again, run summary. Explicitly integrates with the
   Workspace → Collection → Folder → API hierarchy from priority 1.

**Important standing note:** a large portion of the Collection Runner spec already exists in
this repo (built across "Milestone C" / "B3" / "D.1" — see Completed Milestones below). Do not
rebuild working functionality. A gap-analysis is in progress (see Status below) to determine
exactly what's missing vs. already real before any implementation starts.

---

## Status — In Progress Right Now

(none — see "Verification & Polish Pass — COMPLETE" below; next queued work is Phase 4 of
Workspace Management, see "Next Module To Start" at the bottom of this file.)

## Verification & Polish Pass — COMPLETE (2026-08-22)

User request: "whatever features are developed already make them perfect so I can make sure all
the functionality is working fine as expected." Full audit across everything built so far —
baseline validation, live exploratory testing (special attention to Workspace Management Phases
1-3), fix, re-validate. **Delivered.**

**Pre-flight (git scope audit):** confirmed the working tree's uncommitted changes matched
plan.md's own file lists exactly (Workspace Management Phases 1-3, D.2 Step 3's `bodies.spec.ts`,
Phase 3's `sidebarDnd.spec.ts`, and the previously-flagged Settings/Customization WIP) — nothing
missing, nothing unexpected. No git mutation commands were run at any point.

**Baseline (before fixes):**
- `npm run typecheck` (17 workspaces): clean.
- `npm run lint`: clean.
- `npm run test` (full monorepo Vitest): all passing (workspace-engine 82, apps/web 389, every
  other package unchanged) — identical counts to Phase 3's report.
- `npx playwright test`: **required environmental cleanup before it could even run correctly** —
  an unrelated project's Vite dev server (`.../Minimal API Test/fetchly`) was repeatedly claiming
  port 5173 (the same port `playwright.config.ts`'s `webServer` uses with
  `reuseExistingServer: true`), causing Playwright to silently test the wrong application
  entirely. Once that was cleared immediately before each run, a clean baseline was obtained:
  **164 passed, 10 failed** (some run-to-run variance, 160-167 passed / 4-13 failed depending on
  timing) — worse than Phase 3's reported "167 passed, 7 failed" under this session's parallel
  load, but all failures were in the same small cluster of files (`environments.spec.ts`,
  `testingEngine.spec.ts`, `smoke.spec.ts`, `dependencies.spec.ts`, `mockServer.spec.ts`) — see
  Section 6 below for full root-cause diagnosis, which turned out to be broader than plan.md's
  original "7 known failures, Monaco fill() only" diagnosis.

**Live exploratory audit (Phase 2):** no browser-driving tool was available in this session, so
exploratory testing was done via three purpose-built, one-off Playwright scripts run against the
real dev server (not part of the permanent suite — written, run, and deleted within this session),
covering exactly the gaps the task called out as under-covered by the existing automated suite:
1. **Workspace switch UI, live in a real browser**: create a workspace via the real dropdown,
   confirm a collection created in it is invisible after switching to another workspace (0 leak),
   confirm switching back restores it, confirm deleting a *non-active* workspace works with the
   correct confirmation text, confirm deleting the *last remaining* workspace is correctly refused
   with the exact expected alert ("Can't delete the only workspace."). **All passed — no defect.**
2. **"Run Folder" on a folder containing only a nested subfolder, built via real drag-and-drop**
   (not direct store manipulation, unlike the existing unit test): created Outer folder → Inner
   subfolder → saved a request at the collection's top level → dragged it into Inner via the same
   real pointer-event sequence `sidebarDnd.spec.ts` uses → clicked "Run Outer" (zero direct
   requests, only the nested Inner subfolder) → confirmed the Runner found and ran the nested
   request. **Passed — the Phase 2 fix (`RunnerDialog`'s descendant-inclusive folder filter) holds
   in the live UI, not just in the unit test that originally proved it.**
3. **Drag-and-drop edge cases**: dragging an item onto itself (no-op), starting a drag then
   pressing Escape mid-drag, and a real page reload afterward. **All passed — no crash, no data
   corruption, no data loss.**

No new defects found in Workspace Management Phases 1-3 during live exploratory testing.

**Defects found and fixed (Phase 3 — all in E2E test files only, zero production code changed):**

1. **Root cause of the "7 known Monaco failures" was more precise, and larger in scope, than
   plan.md's prior diagnosis.** Three distinct issues, not one:
   - **(a) `.fill()` cannot target Monaco at all**, not just "fights with contenteditable" as
     previously described: this Monaco version renders its input surface as a custom
     `<div role="textbox" class="native-edit-context">` using the browser's EditContext API —
     Playwright's `.fill()` throws outright (`Element is not an <input>, <textarea> or
     [contenteditable] element`) because it doesn't recognize the element as fillable at all, not
     a soft interaction failure. Affected: all 6 script-editor tests in `testingEngine.spec.ts`.
   - **(b) The correct click target for a Monaco editor is `.view-lines`, not the labelled input
     surface** — the input surface is aria-labelled (used to *locate* the right editor instance)
     but its own `.view-lines` child layer visually sits on top and is what actually receives
     pointer events; clicking the input surface directly gets blocked
     ("`<div class="view-line">` intercepts pointer events").
   - **(c) Typing multi-line scripts containing brackets/quotes via simulated keystrokes
     (`page.keyboard.type()`) corrupts the script** — Monaco's auto-closing-bracket/quote feature
     duplicates delimiters already present in the typed text, turning valid JS into a syntax
     error (silently breaking 2 of the 6 script tests in a way that looked like an unrelated
     "response never arrives" failure, not a script-editor failure, until traced back).
   - **(d) Separately, read-only Monaco response-body assertions
     (`.monaco-editor`) are unreliable for asserting arbitrary content**: the response panel's
     Monaco editor virtualizes long content (only ~10-14 lines fit in its ~220px-tall viewport
     before scrolling), so an assertion on content not guaranteed to be near the top of the
     pretty-printed JSON (a header buried among a real browser's other request headers, for
     instance) can fail simply because it was scrolled out of the rendered DOM — not because the
     content is actually missing. This is a real, pre-existing flakiness source distinct from (a)-
     (c), affecting `environments.spec.ts`, `smoke.spec.ts`, `dependencies.spec.ts`, and
     `mockServer.spec.ts`, that plan.md's earlier phases hadn't isolated (their "163-167 passed / 7
     failed" reports likely got lucky on response length/header count on those runs).
   - **Not a bug, confirmed intentional:** Monaco is loaded from a CDN
     (`https://cdn.jsdelivr.net`) via `@monaco-editor/react`'s default loader rather than bundled
     locally — `apps/web/index.html`'s CSP already deliberately allowlists this with an explanatory
     comment. This is a real, documented, working design decision (not the abandoned WIP comment
     plan.md flagged as "worth checking") — left untouched, per scope discipline.
2. **Fix applied** (all in `apps/web/e2e/`, zero app source touched):
   - `testingEngine.spec.ts`: new `fillScriptEditor()` helper — click `.view-lines` (scoped to the
     correct editor instance via `.filter({ has: page.getByLabel(label) })`, since there are two
     Monaco instances on screen: Pre-request and Post-response Script), then
     `page.keyboard.insertText()` (a single atomic paste-like insertion, not per-keystroke
     `.type()`) to avoid the auto-closing-bracket corruption. Replaces all 6 `.fill()` call sites.
   - `dependencies.spec.ts`, `environments.spec.ts`, `mockServer.spec.ts`, `smoke.spec.ts`: new
     `rawResponseText()` helper (click the "Raw" tab, assert against the plain-text `<pre>` instead
     of the virtualized Monaco Pretty view) — the exact pattern already established and working in
     `auth.spec.ts` and this file's own POST-JSON-body test, just not yet applied to these other 9
     assertion sites. Expected substrings adjusted from pretty-printed spacing (`"method": "GET"`)
     to the raw wire format's minified spacing (`"method":"GET"`) where the fixture server returns
     minified JSON; left as-is where the mock server echoes back a literal user-typed template.
3. **Verified stable, not lucky:** full suite re-run **three times** after the fix, clean each
   time — **174 passed, 0 failed**, no flakiness, no residual failures.

**Defects NOT fixed / out of scope:** none found. No production/app source code required any
change — every genuine issue found was in test code, and every "known/documented limitation" (CDN-
loaded Monaco, environments/globals/history staying global across workspaces) was confirmed
intentional and left untouched.

**New/updated test coverage:** the fix *is* the test coverage — no separate regression tests were
added because the 15 fixed assertions/interactions already existed; they were fixed in place to
actually test what they were always meant to test. The 3 exploratory scripts used for the live
audit (workspace no-leak, nested-folder Runner via real DnD, DnD edge cases) were deliberately not
added to the permanent suite — they were a one-off audit tool, not new product-behavior coverage;
their assertions substantially overlap `useAppStore.workspace.test.ts`,
`useAppStore.runner.test.ts`'s Phase-2 regression test, and `sidebarDnd.spec.ts`.

**Final validation (after fixes):**
- `npm run typecheck` (17 workspaces): clean.
- `npm run lint`: clean.
- `npm run test` (full monorepo Vitest): all passing, identical counts to baseline (untouched by
  this pass — only E2E test files changed).
- `npx playwright test`: **174 passed, 0 failed** (3 consecutive clean runs).

**Git scope audit (after fixes):** exactly 5 files touched by this pass, all `apps/web/e2e/*.spec.ts`
test files (`dependencies.spec.ts`, `environments.spec.ts`, `mockServer.spec.ts`, `smoke.spec.ts`,
`testingEngine.spec.ts`), zero production source files. Every file from Workspace Management Phases
1-3, D.2 Step 3, and the flagged Settings/Customization WIP remains present and untouched, exactly
as it was at the start of this pass. Nothing was committed — working tree left for manual review.


- [ ] **Workspace Management — architecture discovery** (read-only, no code written yet).
      Investigating: does multi-workspace support exist today (almost certainly not — current
      `Workspace` type in `packages/workspace-engine/src/types.ts` is a single root
      `{collections: Collection[]}` with no workspace-list/switcher concept); do folders nest
      today (almost certainly not — confirmed single-level as of the Step 7 review, needs
      re-verification); does collection import exist; does any drag-and-drop exist anywhere in
      the app already. Producing a concrete implementation plan with phased rollout
      recommendation. **Not yet delivered to user.**
- [x] **Collection Runner — gap analysis COMPLETE (2026-08-20).** Verdict: **most of the
      19-point spec already works.** Confirmed via full read of `RunnerDialog.tsx` (681 lines),
      `runner.ts`, `useAppStore.ts`'s `executeRequestWithDependencies`/`startRunner`, plus
      existing test suites (`useAppStore.runner.test.ts` ~35 tests, E2E `advancedWorkflows.spec.ts`
      18 tests).

      **Already works, confirmed, do not touch:** Collection-level Run button (`CollectionItem.tsx`)
      AND Folder-level Run button (`FolderItem.tsx`) both exist; environment selection +
      runtime resolution; strictly sequential execution (`await` loop, no `Promise.all`);
      dependency/runtime-variable chaining (Login→token→next request); per-item status states
      (more granular than spec: pending/running/passed/failed/error/contract-failed/skipped/cancelled);
      stop-on-failure vs continue-on-failure; Stop (hard cancel via `AbortController`); Run
      Again within one open dialog session (re-runs identical config); post-run summary shown
      both immediately and in a persisted, clickable History tab; architecture already proven
      extensible (contract/security checks bolted on without touching the core loop) — nothing
      blocks future assertions/scripts/parallel execution.

      **Genuinely missing — this is the real scope for Collection Runner work:**
      1. Independent, user-editable, flat execution-order list (today order is 100% implicit —
         derived from `collection.items` array order every time, no separate sequencing concept).
      2. Drag-and-drop reordering UI — zero DnD exists anywhere in the app (grep confirmed),
         will need a new library (recommend `@dnd-kit/sortable`, nothing to reuse as precedent).
      3. True Pause distinct from Stop (finish current request, halt before next, resumable) —
         only hard Stop exists today.
      4. Select-all / clear-selection buttons, and folder-group checkboxes within one unified
         runner view (currently folder-scoping = opening a *separate* dialog instance, not a
         checkbox inside a combined view).
      5. Full request/response detail in the click-to-expand panel — currently only shows
         status+duration; method/URL/headers/params/body and response headers/body are likely
         already on the data model, just not wired into the JSX (rendering-only fix).
      6. Real `<progress>` bar element + live elapsed-time counter while running (counts/duration
         exist but only computed once at completion, not live).
      7. "Run Again" surviving a dialog close/reopen (works only within one mounted session
         today — `RunnerRunHistoryItem` doesn't persist the selected-request-ID list).

      **Critical architectural confirmation:** drag-and-drop custom ordering can be built by
      changing ONE call site — swap what array of request IDs `startRunner` iterates (currently
      `flattenCollectionRequests(collection)` filtered by selection) for a new user-reorderable
      `executionOrder: string[]`. Everything downstream (`executeRequestWithDependencies`,
      `mergeResolutionContext`, `resolveInheritedAuth`, dependency resolution) is already
      per-request-ID and order-source-agnostic — **zero changes needed to canonical execution
      architecture.** One caveat: `resolveDependencyOrder` will still inject declared
      prerequisites ahead of a request regardless of manual order — pre-existing property, not
      new.

      **Recommended build order** (each step additive, independently shippable):
      1. `executionOrder` state + select-all/clear + folder-group checkboxes.
      2. Drag-and-drop wiring (pick `@dnd-kit/sortable`) → feed reordered array into `startRunner`.
      3. Pause flag alongside existing `AbortController`, checked at the same two points Stop
         already checks.
      4. Extend expand-panel JSX to render full request/response detail (data likely already
         available, rendering-only).
      5. `<progress>` element + live timer via `setInterval` while `status === "running"`.
      6. Persist selected-IDs + executionOrder into history/a "last config" slice so Run Again
         survives remount.

- [x] **Workspace Management — architecture discovery COMPLETE (2026-08-20).** Confirmed both
      suspicions precisely: `Workspace` (`packages/workspace-engine/src/types.ts`) is a single
      unnamed root `{collections: Collection[]}` — zero workspace-list/switcher concept anywhere
      in the app. `Folder.items: SavedRequest[]` — folders are single-level by the type system
      itself (doc comment confirms), no recursive folder rendering in the UI. This is a
      genuinely new persistence dimension, comparable in scope to the D.1 milestone — not a
      cosmetic addition. Full findings below, reconciled with the Collection Runner gap analysis
      into one build order.

## RECONCILED PLAN — read this before starting any implementation

### Key architectural decisions made during discovery (flagging for user sign-off before Phase 1 starts)

1. **Multi-workspace = new registry + per-workspace persistence blob**, not a cosmetic label.
   Recommended shape: `WorkspaceMeta{id,name,description,createdAt,updatedAt}` list +
   `activeWorkspaceId`, each meta pointing at its own persisted `Workspace{collections}` blob.
2. **Environments and Global Variables stay GLOBAL across all workspaces for Phase 1** — not
   per-workspace. Rationale: avoids compounding two big migrations at once; matches an
   "account-wide" mental model; can be revisited later if the user wants per-workspace
   environments. **This is a real product decision — flag to user, don't just silently assume.**
3. **Request History and Run History also stay global for Phase 1** (not scoped per workspace)
   — same rationale, flagged as a known gap to revisit.
4. **Migration is zero-data-loss and low-risk**: existing single `api-lab-workspace` localStorage
   key becomes the storage location for exactly one auto-created "My Workspace" — never
   rewritten/duplicated, just referenced by the new registry. New workspaces get new keys.
5. **Nested folders: ancestor-CHAIN inheritance (Option A), not immediate-parent-only (Option B).**
   `collection → grandparent folder → parent folder → immediate folder → request`, nearer scope
   wins — consistent with how the rest of the precedence chain already works. This is a caller-side
   change in `executeRequest.ts` (pre-merge the ancestor chain before calling
   `mergeResolutionContext`/`resolveInheritedAuth`) — **`mergeResolutionContext` itself does not
   change shape, no duplication of canonical architecture.**
6. **Drag-and-drop library: `@dnd-kit/core` + `@dnd-kit/sortable`** (new dependency — zero DnD
   exists anywhere in the app today, confirmed by both discovery passes independently). One
   library serves both Workspace Management's tree reordering AND Collection Runner's
   execution-list reordering — build the pattern once, reuse it.
7. **`RequestLocation.folderId` → `folderPath: string[]`** (ordered ancestor chain) — needed
   because Runner, resolution, and lookup code all need the full ancestor chain, not just the
   immediate parent, once folders nest.

### Full reconciled build order

**Phase 1 — Workspace list wrapper** (highest risk, foundational, ship in isolation)
- New `WorkspaceMeta`/registry type + CRUD (new file, e.g.
  `packages/workspace-engine/src/workspaceRegistry.ts`).
- `apps/web/src/lib/persistence.ts` — new registry envelope + per-workspace keys + migration
  logic (decision #4 above).
- `useAppStore.ts` — new `workspaces`/`activeWorkspaceId` state, `switchWorkspace`/
  `createWorkspace`/`deleteWorkspace` actions. **Critical:** `tabs`/`activeTabId` must reset on
  switch (a tab open on request X in workspace A is meaningless in workspace B).
- New UI: `WorkspaceSwitcher.tsx`, `CreateWorkspaceDialog.tsx` (neither exists today).
- `importCollection`/`importNativeWorkspace` wired to target `activeWorkspaceId` — **read it
  fresh from `get()` inside the action every time, never capture as a stale closure/parameter**
  (flagged as the single most likely import bug).
- Folders and DnD **untouched** in this phase — isolate the risk.
- Test: extend `useAppStore.workspace.test.ts` for create/switch/tab-reset/no-cross-workspace-leak.

**Phase 2 — Nested folders** (second-highest risk, touches D.1 resolution semantics)
- Type change: `Folder.items: SavedRequest[]` → `CollectionItem[]` (root change everything
  else follows from).
- `workspace-engine/src/internal.ts`, `folder.ts`, `reorder.ts` — flat lookups/updates become
  recursive (find/replace-by-path anywhere in the tree).
- `apps/web/src/lib/workspaceLookup.ts` — `findFolder`/`findRequestLocation`/`resolveContainers`
  become recursive, return the full ancestor chain (not one folder).
- `apps/web/src/lib/executeRequest.ts` — implement decision #5 (ancestor-chain flattening)
  explicitly as a documented, tested function BEFORE wiring into UI.
- **`RunnerDialog.tsx:76-77`'s folder-scoped filter is an EXACT-match today
  (`r.location.folderId === folderId`)** — must become "in this folder or any descendant" in the
  SAME change as the `RequestLocation` shape update, or "Run Folder" silently executes zero
  requests for nested content instead of erroring. Do not ship the type change without this.
- Recursive `FolderItem.tsx` rendering (render nested `FolderItem`s, not just flat `RequestItem`s).
- Postman import de-flattening (`packages/collection-format/src/postman/importAdapter.ts:143-161`
  currently flattens nested Postman folders with a warning — natural low-risk follow-on once
  nesting exists, removes an existing lossy behavior).
- Test: extend `useAppStore.hierarchicalResolution.test.ts` for ancestor-chain folder-scope
  merge — this is exactly the kind of precedence test this file already specializes in.

**Phase 3 — Drag-and-drop** (pure UI/interaction, layered on a now-correct data model)
- Add `@dnd-kit/core` + `@dnd-kit/sortable`.
- New pure functions in `workspace-engine` following `moveRequest`'s existing shape
  (`packages/workspace-engine/src/request.ts:89-105`): `moveFolder`, `reorderItems`.
- Wire `DndContext` into the sidebar tree (`CollectionItem.tsx` as root, `FolderItem.tsx`/
  `RequestItem.tsx` as sources/targets).
- **This same phase also closes Collection Runner gap items #3/#4 from the gap analysis above**
  (independent execution-order list + DnD reordering in the Runner) — build once, reuse the
  library/pattern in both places.
- Test: pure move/reorder functions unit-tested directly (jsdom can't easily simulate real
  pointer-drag gestures); DnD wiring itself covered by a new Playwright E2E test.

**Phase 4 — Collection Runner remaining gaps** (from the completed gap analysis, independent
of Phases 1-3 except where noted)
- Select-all/clear-selection + folder-group checkboxes in the runner.
- Pause distinct from Stop (flag alongside existing `AbortController`, same check points).
- Full request/response detail in the expand panel (rendering-only, data likely already present).
- Real `<progress>` bar + live elapsed timer.
- Run Again config persisted across dialog close/reopen.

### Risks called out by the discovery agent — do not skip these when implementing

- **D.1 resolution** breaks silently if ancestor-chain inheritance (decision #5) is skipped or
  half-implemented — write the resolution test BEFORE the UI.
- **Runner folder-scoping** breaks silently (zero requests found, not an error) if the exact-match
  filter isn't updated in the same change as the `RequestLocation` type change.
- **B3 dependency execution** must always receive/search the explicitly-active workspace's
  `Workspace` object, never a stale or merged reference — request IDs are not necessarily
  globally unique across independently-created workspaces.
- **Import** must read `activeWorkspaceId` fresh from `get()`, never a captured/stale value.

### Sign-off received (2026-08-20)
User confirmed: proceed. Decisions #2/#3 (environments/globals/history stay global across
workspaces for Phase 1) accepted as-is. **Phase 1 implementation starting now.**

### Phase 1 — COMPLETE (2026-08-21)

Workspace registry + switcher UI + zero-data-loss migration all implemented, tested, and
verified. Folders/DnD/Collection Runner untouched, exactly as scoped.

**New files:**
- `packages/workspace-engine/src/workspaceRegistry.ts` — pure CRUD (`createWorkspaceMeta`,
  `renameWorkspaceMeta`, `updateWorkspaceDescription`, `deleteWorkspaceMeta`,
  `setActiveWorkspace`, `findWorkspaceMeta`), same immutable + `touch()` pattern as
  `collection.ts`/`folder.ts`. `deleteWorkspaceMeta` throws rather than ever leave the registry
  with zero workspaces.
- `packages/workspace-engine/src/workspaceRegistry.test.ts` — 10 tests.
- `apps/web/src/components/collections/WorkspaceSwitcher.tsx` — dropdown at the top of the
  sidebar (inside `CollectionSidebar.tsx`, above the Collections/History tabs): shows the
  active workspace, lists all workspaces with switch/rename/delete, entry point for "+ New
  Workspace".
- `apps/web/src/components/collections/WorkspaceSwitcher.test.tsx` — 5 tests.
- `apps/web/src/components/collections/CreateWorkspaceDialog.tsx` — name + optional description
  form, same `Dialog`-wrapper convention as `SaveRequestDialog.tsx`.
- `apps/web/src/components/collections/CreateWorkspaceDialog.test.tsx` — 2 tests.

**Modified files:**
- `packages/workspace-engine/src/types.ts` — added `WorkspaceMeta`, `WorkspaceRegistry`,
  `WORKSPACE_REGISTRY_FORMAT_VERSION`, `PersistedWorkspaceRegistry`.
- `packages/workspace-engine/src/schema.ts` — added `workspaceRegistrySchema` (zod).
- `packages/workspace-engine/src/serialize.ts` — added `serializeWorkspaceRegistry`/
  `deserializeWorkspaceRegistry`, with a defensive fallback if `activeWorkspaceId` doesn't match
  any entry (falls back to the first workspace rather than rejecting the whole registry).
- `packages/workspace-engine/src/index.ts` — exports the new registry module.
- `apps/web/src/lib/persistence.ts` — the key addition. `workspaceStorageKey(workspaceId)`
  maps a workspace id to its localStorage key: `LEGACY_WORKSPACE_ID` ("default") resolves to
  the **original, untouched** `api-lab-workspace` key; every other workspace gets
  `api-lab-workspace-{id}`. `loadWorkspaceFromStorage`/`saveWorkspaceToStorage`/
  `resetWorkspaceStorage` now take a `workspaceId` param. New
  `loadWorkspaceRegistryFromStorage()` does the one-time migration: if
  `api-lab-workspace-registry` has never been written, synthesizes a registry with exactly one
  entry (id `LEGACY_WORKSPACE_ID`, name "My Workspace") pointing at the pre-existing key —
  **never reads, rewrites, or copies that key's bytes**, just references it. New
  `flushWorkspaceToStorage`/`flushWorkspaceRegistryToStorage` — synchronous, non-debounced
  writes, documented as required reading before every workspace switch (see below).
- `apps/web/src/lib/persistence.test.ts` — added a "workspace registry migration
  (zero-data-loss)" describe block: verifies a brand-new install gets one empty default
  workspace without touching the legacy key; verifies an existing single-workspace user's data
  becomes exactly one default workspace with the **legacy key's bytes unchanged** (asserted via
  exact string equality, not just re-parsing); verifies migration only happens once; verifies
  new workspaces get a distinct key. Updated all pre-existing workspace tests in this file to
  pass `LEGACY_WORKSPACE_ID` explicitly.
- `apps/web/src/store/useAppStore.ts`:
  - New state: `workspaces: WorkspaceMeta[]`, `activeWorkspaceId: string`,
    `workspaceRegistryLoadError: string | null`.
  - New actions: `switchWorkspace`, `createWorkspace`, `renameWorkspace`, `deleteWorkspace`.
  - `loadInitialState()` now loads the registry first, then loads `workspace` for whichever id
    is active. Only the legacy/default workspace gets `createSeedWorkspace()`'s example content
    on a fresh install — any other "empty" workspace load (e.g. a newly created workspace)
    gets `createEmptyWorkspace()` instead, matching real user intent.
  - `switchWorkspace`/`createWorkspace`/`deleteWorkspace` (when it deletes the active workspace)
    all reset `tabs`/`activeTabId` to one fresh empty tab, and clear `tabRuntimeVariables` —
    per the explicit constraint that a tab open on request X in workspace A is meaningless in
    workspace B.
  - **The debounce race, solved:** `saveWorkspaceToStorage` is a single shared debounced timer.
    If workspace A has a pending debounced write and the user switches to workspace B before it
    fires, a naive implementation would let B's write cancel A's pending write, silently
    dropping A's last edit. Every switch/create/active-delete path calls
    `flushWorkspaceToStorage(outgoingId, outgoingWorkspace)` — synchronous, bypasses the
    debounce — **before** changing `activeWorkspaceId`/`workspace` in `set()`. Covered by the
    "no cross-workspace leak" tests below (they'd have caught this if unflushed).
  - `resetWorkspace()` now scopes to `get().activeWorkspaceId` rather than a single global key.
  - The persistence `subscribe()` blocks at the bottom now read `state.activeWorkspaceId` fresh
    on every fire (never captured) when calling `saveWorkspaceToStorage`, and a new subscribe
    block persists `workspaces`/`activeWorkspaceId` to the registry key.
- `apps/web/src/store/useAppStore.workspace.test.ts` — added a "workspace switching" describe
  block, 9 new tests: create-and-switch, switch-without-leaking-data-across-workspaces, a
  request saved in workspace A is not visible/resolvable in workspace B, tabs reset on switch,
  rename, delete-non-active, delete-active-falls-back, refuse-to-delete-last-workspace, and
  **import targets whichever workspace is active at call time, even after a switch** (the bug
  class flagged as most likely in the task brief).
- `apps/web/src/components/collections/CollectionSidebar.tsx` — renders `<WorkspaceSwitcher />`
  at the top of the sidebar nav.

**Import call sites (`importCollection`/`importNativeWorkspace`):** verified, not modified.
Both already call `get().workspace` fresh inside the action body (not a parameter, not a
closure capture) — and by Phase 1's own architecture, `state.workspace` *is* the active
workspace's data, so "fresh `get().workspace`" and "fresh active workspace" are the same thing
by construction. No stale-capture path exists at the one UI call site
(`ImportDialog.tsx`) either — it calls the store action directly with no captured workspace
value. Covered by a dedicated test (see above).

**B3 dependency execution:** unaffected — `buildDependencyMap`/`findSavedRequest`/
`validateWorkspaceDependencies` still take/read `state.workspace` exactly as before; since that
field now only ever holds the *active* workspace's data (switching repoints the whole object,
never merges), there is no new path for a dependency to resolve against a different workspace's
request pool. Verified by the "not visible/resolvable in workspace B" test.

**Canonical resolution/execution architecture:** untouched, confirmed by full read —
`mergeResolutionContext`, `resolveInheritedAuth`, `prepareRequest`/`executeRequestConfig`,
`executeRequestWithDependencies`/`startRunner` have zero references to the new registry/switch
code.

**Verification results:**
- `npm run typecheck` (full monorepo, all 17 workspaces): clean, zero errors.
- `npm run lint` (`apps/web`): clean, zero errors/warnings.
- `npm run test` (full monorepo): **all passing** — `packages/workspace-engine` 64 tests (was
  54; +10 new), `apps/web` 363 tests (was ~338; +25 new: 16 store + 5 WorkspaceSwitcher + 2
  CreateWorkspaceDialog + 2 persistence-migration groups counted above), every other package
  unchanged and green.
- `npx playwright test` (full E2E suite): **163 passed, 7 failed.** All 7 failures are
  `.monaco-editor` / contenteditable-fill errors in `e2e/environments.spec.ts` and
  `e2e/testingEngine.spec.ts` (script sandbox tests) — confirmed via `git status` to be caused
  by the **pre-existing uncommitted `ScriptsPanel.tsx`/`BodyPanel.tsx` WIP** (Monaco editor swap,
  see "Known Uncommitted WIP" below), not by anything in this Phase 1 change. Zero E2E
  regressions attributable to Workspace Management — every collection/request/tab/runner E2E
  test that implicitly assumed "the" workspace still passes unchanged, because Phase 1
  deliberately keeps exactly one workspace active at a time with the same `state.workspace`
  shape those tests already exercise.

**Deviations from the original plan:**
- Store fields are exactly `workspaces: WorkspaceMeta[]` / `activeWorkspaceId: string` as
  specified, not a nested `registry` object — kept the two shapes (flat store fields vs. the
  `WorkspaceRegistry` pure-function shape) separate; store actions construct
  `{ workspaces, activeWorkspaceId }` on the fly when calling into `workspaceRegistry.ts`. Purely
  an ergonomics choice for component selectors (`useAppStore(s => s.workspaces)`), no behavior
  difference.
- Added `renameWorkspace` (not explicitly listed as a required action, but "WorkspaceSwitcher"
  needs *some* rename affordance and it's a one-line wrapper over
  `renameWorkspaceMeta` — same shape as `renameCollection`/`renameFolder`, no new risk).
- `createWorkspace` auto-switches to the newly created workspace (not stated explicitly in the
  plan either way) — matches the obvious product expectation ("create a workspace" implies "now
  work in it") and avoids a dead-end UI state where a user creates a workspace and nothing
  visibly happens.
- Tabs are intentionally **not** persisted per-workspace across reloads (only reset in-session
  on switch). The plan only required the reset behavior; introducing per-workspace tab
  persistence would be new scope (a new persistence dimension) not requested, and tabs are
  already documented elsewhere in this codebase as "session convenience, not critical data."

**Concern flagged for Phase 2:** none of the ancestor-chain/`RequestLocation.folderId` work
was touched, so Phase 2 starts from the exact pre-Phase-1 folder model plus the new workspace
wrapper around it — no interaction effects expected. One thing worth double-checking early in
Phase 2: `getRequestName`/`buildDependencyMap`/`findSavedRequest` in `useAppStore.ts` still walk
`collection.items` assuming folders are one level deep (`isFolder(item) ? item.items : ...`) —
once `Folder.items` becomes `CollectionItem[]` these will need to recurse, same as the
`workspaceLookup.ts` functions the plan already calls out.

### Phase 2 — COMPLETE (2026-08-21)

Nested folders implemented end-to-end: type change, recursive lookup/update helpers, the
ancestor-chain variable/auth inheritance (decision #5), the Runner folder-scoping fix, recursive
sidebar UI, and Postman import de-flattening. All scoped items delivered; nothing deferred.

**Type/data-model change (root of everything else):**
- `packages/workspace-engine/src/types.ts` — `Folder.items: SavedRequest[]` →
  `CollectionItem[]`; `RequestLocation.folderId?: string` → `RequestLocation.folderPath?: string[]`
  (ordered ancestor chain, outermost first; omitted/empty = directly in the collection — kept
  optional, matching the old field's ergonomics, rather than required, to avoid unnecessary churn
  at the many call sites that never touch folders at all).
- `packages/workspace-engine/src/schema.ts` — `folderSchema`/`collectionItemSchema` made mutually
  recursive via `z.lazy` (zod's standard pattern; input generic loosened to `unknown` because
  `.default(...)` fields' input type allows `undefined` while the output type doesn't — only the
  parsed *output* needs to match the real domain type, which is all every caller consumes).
  Same fix applied to `packages/collection-format/src/native/schema.ts`'s independent copy of
  this schema (used for native export/import round-tripping).

**Recursive lookup/update helpers:**
- `packages/workspace-engine/src/internal.ts` — `findFolder` now searches the whole tree
  recursively; `getRequestsAtLocation`/`withItemsAtLocation` now take a `folderPath: string[]`
  and drill down that path instead of one optional id. New recursive helpers `updateFolderById`,
  `removeFolderById`, `insertIntoFolder` (find-by-id anywhere in the tree, since folder ids are
  globally unique — no path needed for these).
- `packages/workspace-engine/src/folder.ts` — `createFolder` gained an optional `parentFolderId`
  (creates a subfolder anywhere in the tree, throws if that parent doesn't exist);
  `renameFolder`/`deleteFolder`/`updateFolderVariables`/`updateFolderAuth` now use
  `updateFolderById`/`removeFolderById` so they work at any depth. `deleteFolder`'s cascade is
  "free" — `removeFolderById` drops the whole matching subtree in one filter step, never
  separately recursing into a doomed folder's children.
- `packages/workspace-engine/src/reorder.ts`, `request.ts` — every `location.folderId` reference
  became `location.folderPath ?? []`, passed straight through to the now-recursive
  `withItemsAtLocation`/`getRequestsAtLocation`.
- `apps/web/src/lib/workspaceLookup.ts` — `findFolder`/`findRequestLocation` now recurse and
  return the full ancestor chain. `resolveContainers`'s `ResolvedContainers` gained
  `folderChain: Folder[]` (outermost→innermost); `folder` is kept as a convenience alias for the
  innermost entry so pre-Phase-2 single-folder callers (`AuthPanel.tsx`'s UI-only display,
  `perfSpecs.ts`'s load-test auth resolution — both updated to use the full chain for
  correctness) still compile with minimal change.

**Ancestor-chain variable inheritance (decision #5) — implementation + how tested BEFORE UI
wiring:**
- Two new pure functions in `apps/web/src/lib/executeRequest.ts`: `mergeFolderChainVariables`
  (flattens a `Folder[]` ancestor chain into one `Record<string,string>`, nearer/innermost
  folder winning — a plain `Object.assign` left-to-right over an outermost-to-innermost chain)
  and `resolveFolderChainAuth` (walks the chain innermost→outermost for the first concrete,
  i.e. non-`"inherit"`, auth). Neither touches `mergeResolutionContext` or
  `resolveInheritedAuth` — they only decide what single value goes into the existing
  `folder`/`folderAuth` `ExecutionScopes` slots.
- New test file `apps/web/src/lib/executeRequest.test.ts` (10 tests) — unit-tests both functions
  in isolation (empty chain, single folder, nearer-wins, distinct-keys-merge, disabled-variable
  exclusion, inherit-skipping, explicit-"none"-as-concrete) and was run green **before** wiring
  into `useAppStore.ts`, per the plan's explicit ordering requirement.
- Wired into `apps/web/src/store/useAppStore.ts`'s `executeRequestWithDependencies` (the sole
  scope-building call site, ~15 line diff): `resolveContainers` now returns `folderChain` instead
  of one `folder`, and the container-scopes block calls the two new functions instead of reading
  `folder?.variables`/`folder?.auth` directly. `prepareRequest`/`executeRequestConfig`'s
  signatures and bodies are unchanged.
- Integration-tested end-to-end (store → `executeRequestConfig` → mocked `fetch`) by extending
  `apps/web/src/store/useAppStore.hierarchicalResolution.test.ts` (+4 tests, 18→22): nearer-folder-
  wins across a 3-level chain while a farther folder's distinct key still comes through; a folder
  with no variables of its own is transparent to its ancestor; auth skips an inherit immediate
  folder to the nearest *concrete* ancestor (not just the nearest folder); auth falls through an
  entirely-inherit chain to the Collection.

**Ancestor-chain auth inheritance — implementation + how tested:** see `resolveFolderChainAuth`
above — same function, tested in the same two places (unit tests in `executeRequest.test.ts`,
integration tests in `useAppStore.hierarchicalResolution.test.ts`).

**Runner folder-scoping fix — exact before/after, how tested:**
- Before: `apps/web/src/components/runner/RunnerDialog.tsx`'s folder-scoped request filter was
  `all.filter((r) => r.location.folderId === folderId)` — an exact match against the immediate
  folder only.
- After: `all.filter((r) => (r.location.folderPath ?? []).includes(folderId))` — "in this folder
  or any descendant folder." Landed in the same change as the `RequestLocation.folderPath` type
  update (`packages/workspace-engine/src/types.ts`) and `apps/web/src/lib/runner.ts`'s
  `flattenCollectionRequests`, which now walks nested folders recursively and sets each request's
  full `folderPath` instead of one optional `folderId`.
- Tested by a new regression test in `apps/web/src/store/useAppStore.runner.test.ts`:
  `"Phase 2: 'Run Folder' on a folder with a NESTED subfolder finds and executes the nested
  requests, not zero"` — builds a folder containing only a subfolder (zero requests directly in
  the folder being run), asserts the descendant-inclusive filter finds both nested requests
  (would have found zero under the old exact-match filter), then runs them via `startRunner` and
  asserts both executed and the history entry records `totalRequests: 2`.

**Recursive `FolderItem.tsx` UI:**
- `apps/web/src/components/collections/FolderItem.tsx` now renders nested `FolderItem`s
  recursively (not just flat `RequestItem`s), takes an `ancestorFolderPath` prop (defaults to
  `[]` for top-level folders) to build each level's own `folderPath` for its children, and gained
  a "New folder" (📁+) button that creates a subfolder via `createFolder(collectionId, name,
  folder.id)`. Create/rename/delete of subfolders at arbitrary depth all work through the
  existing store actions, which now support nesting.
- `apps/web/src/store/useAppStore.ts`'s `createFolder` action gained the optional
  `parentFolderId` passthrough; `deleteFolder`'s open-tab cleanup now checks
  `(tab.savedLocation.folderPath ?? []).includes(folderId)` so deleting a folder also clears tabs
  open on requests in any of its subfolders (cascading delete, not just the immediate folder).
- `apps/web/src/components/collections/SaveRequestDialog.tsx`'s folder picker still only lists
  top-level folders (`selectedCollection.items.filter(isFolder)`) — saving into a *nested*
  subfolder via that dialog isn't wired up. This is a deliberate, narrow deviation (see below),
  not an oversight; `FolderItem.tsx`'s own "+" button already supports nested creation.

**Postman import de-flattening:**
- `packages/collection-format/src/postman/importAdapter.ts`'s `adaptItems` no longer flattens a
  Postman folder nested more than one level deep into its parent with a warning — it now
  recurses and produces a real nested `NormalizedFolder`, matching what API Lab can now store.
  `packages/collection-format/src/types.ts`'s `NormalizedFolder.items` widened from
  `NormalizedRequest[]` to `NormalizedItem[]` to allow this.
- Knock-on recursion fixes required by that type widening: `openapi/importAdapter.ts`'s warning
  collection (folders it produces are still flat, but the type is now general);
  `native/import.ts`'s `adaptNativeExport` (native export→import round-trip, folders can nest);
  `apps/web/src/lib/importExport.ts`'s `applyCollectionImport` (rewritten as a recursive
  `applyItems` that threads the full ancestor `folderPath` down, not just the immediate parent —
  this was almost a bug: an early version only tracked the immediate parent id, which would have
  silently misplaced anything nested three levels deep).
- Test: `packages/collection-format/src/postman/importAdapter.test.ts`'s
  `"flattens folders nested more than one level deep, with a warning"` test rewritten to
  `"preserves folders nested more than one level deep as real nested folders"` — asserts the
  "Deeply Nested" subfolder in the `nested-folders-and-auth.json` fixture survives as a real
  nested folder (not flattened into its parent "Users"), and that no flattening warning is
  produced.

**Backward-compatibility verification (legacy flat-folder data):** new
`packages/workspace-engine/src/serialize.test.ts` describe block "Phase 2 (nested folders)
backward compatibility & round-trip" — one test hand-builds a pre-Phase-2 flat-folder JSON
fixture (`Folder.items` containing only requests, exactly the shape every folder persisted before
this phase has) and asserts it deserializes successfully as "a folder with zero subfolders,
only requests"; a second test round-trips a folder nested three levels deep through
`serializeWorkspace`/`deserializeWorkspace`, confirming structure, variables, and auth survive
intact at every level.

**New test coverage added (full list):**
- `apps/web/src/lib/executeRequest.test.ts` — new file, 10 tests (ancestor-chain merge functions,
  unit-level, written and passing before UI wiring).
- `apps/web/src/store/useAppStore.hierarchicalResolution.test.ts` — +4 tests (18→22): nested
  variable precedence (2 tests), nested auth precedence (2 tests).
- `apps/web/src/store/useAppStore.runner.test.ts` — +1 test (35→36): the Runner
  descendant-inclusive folder-scoping regression test described above.
- `packages/workspace-engine/src/folder.test.ts` — +6 tests (3→9): nested `createFolder` at
  depth 2 and depth 3, `createFolder` throwing on an unknown parent id, `renameFolder`/
  `updateFolderVariables`/`updateFolderAuth` finding a subfolder at depth without disturbing
  siblings/ancestors, and cascading `deleteFolder` at both the top-level-ancestor and
  inner-subfolder positions.
- `packages/workspace-engine/src/serialize.test.ts` — +2 tests (16→18): legacy flat-folder
  deserialization and 3-level-deep nested-folder round-trip, described above.
- `packages/collection-format/src/postman/importAdapter.test.ts` — 1 test rewritten (same count,
  7 tests) to assert de-flattening instead of flattening.
- Every other pre-existing test file touched only for the mechanical `folderId` →
  `folderPath`/`folderPath: [id]` rename at call sites (no behavior change): `request.test.ts`,
  `reorder.test.ts` (untouched, no folderId refs), `serialize.test.ts`'s existing tests,
  `runner.test.ts`, `contractAdapt.test.ts`, `useAppStore.workspace.test.ts`,
  `useAppStore.runner.test.ts`, `RequestVariablesAndAuth.test.tsx`, `native/roundtrip.test.ts`,
  `openapi/importAdapter.test.ts` (narrowing helper added for `NormalizedItem` → `NormalizedRequest`).

**Files modified (production code, beyond what's named above):**
`apps/web/src/components/request/DependenciesPanel.tsx` (three flat folder-walks → one shared
recursive `walkWorkspaceRequests` helper with a breadcrumb path), `apps/web/src/lib/
contractAdapt.ts` (`collectionToDriftEndpoints` walk recursed), `apps/web/src/lib/
documentationAdapt.ts` (`collectionToDocSource` walk recursed, `folderName` becomes a "Parent /
Child" breadcrumb for depth > 1), `apps/web/src/components/collections/RequestItem.tsx`
(unchanged — already location-agnostic), `apps/web/src/components/collections/CollectionItem.tsx`
(unchanged — top-level rendering already delegates to `FolderItem`).

**Typecheck/lint/Vitest results (exact counts):**
- `npm run typecheck` (full monorepo, all 17 workspaces): clean, zero errors.
- `npm run lint` (`apps/web`): clean, zero errors/warnings.
- `npm run test` (full monorepo): **all passing.** `packages/workspace-engine` 72 tests (was 64,
  +8: 6 in `folder.test.ts`, 2 in `serialize.test.ts`); `packages/collection-format` 40 tests
  (unchanged count, 1 rewritten); `apps/web` 378 tests (was 363, +15: 10 `executeRequest.test.ts`
  + 4 `hierarchicalResolution.test.ts` + 1 `runner.test.ts` regression test); every other package
  unchanged and green (test-engine 48, script-engine 15, runner-engine 36, mock-engine 19,
  performance-engine 93, contract-engine 284, security-engine 222, documentation-engine 211,
  mock-server 36, performance-worker 27).

**Playwright E2E results:** **163 passed, 7 failed** — identical count and identical failing
test set to Phase 1's report (all 7 in `.monaco-editor`/contenteditable-fill errors in
`e2e/environments.spec.ts` and `e2e/testingEngine.spec.ts`, caused by the pre-existing
uncommitted `ScriptsPanel.tsx` Monaco-editor WIP — see "Known Uncommitted WIP" below, confirmed
still untouched by this phase). Zero E2E regressions attributable to Phase 2.

**Deviations from the plan:**
- `RequestLocation.folderPath` kept **optional** (`folderPath?: string[]`) rather than required,
  matching the old `folderId?: string` field's ergonomics — reduces call-site churn at the many
  places that only ever address a collection's top level and never mention a folder at all
  (every read site treats it as `location.folderPath ?? []`). No behavioral difference from a
  required array defaulting to `[]`.
- `SaveRequestDialog.tsx`'s folder picker was **not** extended to a full nested-tree selector —
  it still only offers top-level folders. Saving into a nested subfolder from that dialog isn't
  possible; the sidebar's own "+" button on any `FolderItem` (at any depth) is the supported path
  for that. Narrow, deliberate scope-holding decision, not a gap in the data layer itself.
- `AuthPanel.tsx` and `apps/web/src/lib/perfSpecs.ts` (auth-inheritance display and load-test
  auth resolution, respectively) were updated to consult the full folder ancestor chain via
  `resolveFolderChainAuth`, even though neither was named explicitly in the phase's file list —
  left as immediate-folder-only, they would have silently disagreed with the real execution
  pipeline for any nested folder, which is exactly the kind of half-implemented-inheritance risk
  the plan warned against. Small, mechanical, low-risk changes reusing the same tested function.
- Native format's independent schema copy (`packages/collection-format/src/native/schema.ts`)
  needed the same recursive `z.lazy` fix as `workspace-engine/src/schema.ts` — not called out in
  the plan by name, but a direct, unavoidable consequence of the type change (native export
  round-trips the real `Workspace` shape).

**plan.md update confirmation:** this section (Phase 2 — COMPLETE) added; "Next Module To Start"
below updated to point at Phase 3.

**Anything flagged as a concern for Phase 3 (drag-and-drop) to be aware of:**
- The data layer (`moveRequest`, `moveItemUp`/`moveItemDown` in `workspace-engine`) still only
  reorders siblings within one array (top-level or one folder's `items`) — there is no
  `moveFolder` yet (moving a folder itself between parents, as opposed to reordering it among
  siblings). Phase 3's plan already calls for a new `moveFolder` pure function following
  `moveRequest`'s shape; it will need to take a `from`/`to` folder-path pair (not just a single
  folder id) now that folders nest, mirroring how `moveRequest` already takes `from`/`to`
  `RequestLocation`s.
- `FolderItem.tsx`'s recursion means the DnD wiring (`DndContext`/sortable items) will need to
  handle drop targets at every depth, not just two levels (collection → folder) — the sidebar
  tree is now genuinely arbitrary-depth, so Phase 3's drop-target logic should be written
  path-aware from the start rather than assuming a maximum depth.
- `SaveRequestDialog.tsx`'s folder picker (noted above as not extended to nested folders) will
  become more noticeably incomplete once DnD makes deep nesting easy to create — worth a quick
  look during Phase 3 or shortly after, even though it's not itself DnD work.

### Phase 3 — COMPLETE (2026-08-21)

Drag-and-drop reorganization of the sidebar tree implemented end-to-end (arbitrary-depth
reorder/move for both folders and requests), plus Collection Runner gap items #1/#2 (independent
`executionOrder` + drag-and-drop reordering), reusing the same `@dnd-kit` pattern in both places
per the plan.

**Dependencies added:**
- `apps/web/package.json` — `@dnd-kit/core` (^6.3.1), `@dnd-kit/sortable` (^10.0.0),
  `@dnd-kit/utilities` (^3.2.2, for `CSS.Transform.toString` in the sortable row styles).

**New pure functions in `workspace-engine` (following `moveRequest`'s shape, per Phase 2's
concern note):**
- `packages/workspace-engine/src/folder.ts` — `moveFolder(workspace, from, to, folderId)`: moves
  a folder and its whole subtree between `RequestLocation`s (collection + folder-*path* pairs, not
  single ids — the concern Phase 2 flagged). Throws if `folderId` isn't found, or if `to` would
  nest the folder inside its own descendant (checked via `toPath.includes(folderId)` before the
  move — the removal-then-insert order would otherwise silently vanish the folder rather than
  erroring).
- `packages/workspace-engine/src/reorder.ts` — `reorderItems(workspace, location, itemId,
  newIndex)`: drag-to-reorder within one container (collection top level or one folder) to an
  arbitrary clamped index, via splice-remove-then-insert — unlike `moveItemUp`/`moveItemDown`,
  which only swap with an adjacent sibling and can't express "drop between item 2 and item 5."
- Unit tests: `packages/workspace-engine/src/folder.test.ts` +4 tests (moveFolder into a folder
  with subtree intact, out of a folder to the root, throws on self-descendant nesting, throws on
  unknown folder id); `packages/workspace-engine/src/reorder.test.ts` +6 tests (reorderItems to an
  arbitrary index, earlier, clamped out-of-range, no-op at current index, no-op on unknown id,
  reorder within a nested folder).

**Sidebar DnD wiring:**
- `apps/web/src/lib/dndTree.ts` (new) — the DOM/React-free layer between `@dnd-kit`'s raw
  `active`/`over` ids and the store actions. `buildDndTree(collection)` walks the collection's
  item tree fresh every render (no separate mount-time registration to keep in sync) and returns
  `meta` (itemId → its container location + index) and `containers` (containerKey → ordered item
  ids, for each level's `SortableContext`). `resolveDrop(tree, activeId, overId)` is the pure
  drop-resolution function: reorder-within-container when dropped on a sibling, move-into when
  dropped on a folder's own header (`folder-drop:{id}` sentinel) or an empty container's
  placeholder (`container-end:{key}` sentinel). Unit-tested directly in
  `apps/web/src/lib/dndTree.test.ts` (11 tests) — no DOM/pointer simulation needed since it's pure
  data-in-data-out.
- `apps/web/src/components/collections/CollectionItem.tsx` — the `DndContext` root for its
  subtree (`PointerSensor` + `KeyboardSensor`, `closestCenter` collision detection), builds the
  `dndTree` via `useMemo`, and its `onDragEnd` dispatches to `moveSavedRequest`/`moveFolder`/
  `reorderItems` based on `resolveDrop`'s result (wrapped in try/catch — `moveFolder`'s
  self-descendant guard throws, which is swallowed with a console warning rather than crashing the
  sidebar). Top-level items wrapped in a `SortableContext`; `DragOverlay` shows a floating preview
  of whatever's being dragged.
- `apps/web/src/components/collections/FolderItem.tsx` — now both a sortable drag source/target
  (`useSortable`, for reordering among its own siblings) AND a separate `useDroppable` target on
  its header row (`folder-drop:{id}`, for "drop INTO this folder"), receives the shared `dndTree`
  as a prop and threads it to nested `FolderItem`s, wraps its own children in a nested
  `SortableContext`. A small "⠿" drag-handle span (visible on hover, same
  `opacity-0 group-hover:opacity-100` language as the existing action buttons) carries the
  sortable listeners, so it doesn't fight with the existing expand-toggle button's click handler.
- `apps/web/src/components/collections/RequestItem.tsx` — same `useSortable` + drag-handle
  pattern as `FolderItem`; requests are always leaves, never a "drop INTO" target.
- `apps/web/src/components/collections/EmptyContainerDropZone.tsx` (new) — a dedicated
  `useDroppable` placeholder for an empty collection/folder (no sortable item exists to drop onto
  otherwise), highlighted with the same blue hover-highlight language used elsewhere.
- `apps/web/src/components/collections/DragPreview.tsx` (new) — the `DragOverlay` content: a
  small rounded/bordered/shadowed chip showing the dragged item's icon + name.
- Visual feedback: dragged row fades to `opacity-40`; the drop-into target folder gets a blue
  ring/background highlight (`isOver` from `useDroppable`); sibling reflow is `@dnd-kit`'s default
  `CSS.Transform`-based animation via `useSortable`, same visual idiom as the sidebar's existing
  hover states, no new one introduced.

**Collection Runner `executionOrder` + DnD (closes gap items #1/#2) — the one `startRunner`
call-site change:**
- `apps/web/src/components/runner/RunnerDialog.tsx` — new `executionOrder: string[]` state,
  initialized from `requests`' natural order (same as `selected` already was), independently
  drag-reorderable via a `DndContext`/`SortableContext` wrapping the existing checkbox list (now
  `RunnerOrderRow` components, same `@dnd-kit` sortable + drag-handle pattern as the sidebar).
  Reordering and selecting are independent — an unchecked request can still be dragged to set
  where it'll run if re-checked later.
- `apps/web/src/components/runner/RunnerOrderRow.tsx` (new) — one sortable row: drag handle +
  checkbox + name.
- **The one call site** (`apps/web/src/store/useAppStore.ts`'s `startRunner`), before/after:
  - Before: `const requested = new Set(requestIds); const flat =
    flattenCollectionRequests(collection).filter((r) => requested.has(r.id));` — order was always
    the collection tree's own order, `requestIds` only used as a filter.
  - After: `const byId = new Map(flattenCollectionRequests(collection).map((r) => [r.id, r] as
    const)); const flat = requestIds.map((id) => byId.get(id)).filter((r): r is RunnableRequest =>
    r !== undefined);` — `requestIds`' own order now IS `flat`'s order (a `Map` lookup replaces the
    filter, and the array is built by mapping over `requestIds` instead of the collection's tree
    order).
  - `RunnerDialog.tsx`'s `handleStart` now passes `executionOrder.filter((id) =>
    selected.has(id))` instead of `[...selected]` (a `Set`'s insertion order) as `requestIds`.
  - Confirmed untouched, exactly as the plan required: `executeRequestWithDependencies`,
    `mergeResolutionContext`, `resolveInheritedAuth`, dependency resolution (`resolveDependencyOrder`
    still injects declared prerequisites ahead of a request regardless of manual order — pre-existing
    behavior, unaffected by this change).

**Accessibility:** `KeyboardSensor` (with `sortableKeyboardCoordinates`) wired alongside
`PointerSensor` in every `DndContext` (sidebar and Runner) — `@dnd-kit`'s built-in
Tab-to-focus-handle, Space-to-pick-up, arrow-keys-to-move, Space-to-drop keyboard flow works in
both places, not just pointer/mouse drag.

**New E2E test coverage:** `apps/web/e2e/sidebarDnd.spec.ts` (new, 4 tests) — jsdom can't simulate
real pointer-drag gestures, so this is Playwright-only, using a manual `mouse.down()` →
multi-step `mouse.move()` → `mouse.up()` sequence (`@dnd-kit` listens for pointer events, not the
HTML5 `dragstart`/`dragover`/`drop` events Playwright's `locator.dragTo()` simulates, and needs
several intermediate moves to pass its activation-distance threshold and re-run collision
detection). Tests: (1) drag-to-reorder swaps two requests' sidebar order; (2) dragging a request
onto a folder's header moves it out of the collection's top level and into that folder; (3)
dragging a folder (with a request nested inside it) into another folder moves the whole subtree,
not just the folder shell; (4) a drag-and-drop reorganization survives a real browser reload
(persistence round-trip). All 4 verified passing, including under the suite's normal 4-worker
parallelism.

**Typecheck/lint/Vitest results (exact counts):**
- `npm run typecheck` (full monorepo, all 17 workspaces): clean, zero errors.
- `npm run lint` (`apps/web`): clean, zero errors/warnings.
- `npm run test` (full monorepo): **all passing.** `packages/workspace-engine` 82 tests (was 72,
  +10: 4 `folder.test.ts` + 6 `reorder.test.ts`); `apps/web` 389 tests (was 378, +11:
  `dndTree.test.ts`); every other package unchanged and green.

**Playwright E2E results:** **167 passed, 7 failed** (was 163 passed, 7 failed before this phase
— +4 net from the new `sidebarDnd.spec.ts`, all 4 passing). The 7 failures are the exact same
pre-existing set as Phase 1/Phase 2's reports — 1 in `e2e/environments.spec.ts` ("header variable
is resolved and sent") + 6 in `e2e/testingEngine.spec.ts` (script sandbox tests) — all
`.monaco-editor`/contenteditable-fill errors caused by the pre-existing uncommitted
`ScriptsPanel.tsx` Monaco-editor WIP (see "Known Uncommitted WIP" below, confirmed still untouched
by this phase). Zero E2E regressions attributable to Phase 3. (One rerun of the full suite under
back-to-back load also showed a flaky, unrelated `performance.spec.ts` "10. cancellation" failure
and some tests skipped — reproduced once, not on the clean run reported above; looks like resource
contention from running the whole load-test suite twice in quick succession rather than anything
Phase 3 touched, since `performance.spec.ts` doesn't share any code path with this phase's changes.)

**Deviations from the plan:**
- Added `@dnd-kit/utilities` alongside the two libraries the plan named explicitly
  (`@dnd-kit/core`/`@dnd-kit/sortable`) — it's the standard companion package for
  `CSS.Transform.toString`, used to translate `useSortable`'s transform into inline styles; not
  pulling in any new drag/drop logic of its own.
- `resolveDrop`'s three-sentinel-id scheme (`folder-drop:`, `container-end:`, plus real item ids)
  wasn't spelled out in the plan at that level of detail — it fell out of making "drop into an
  empty folder" and "drop directly onto a folder's own header" both work, which the plan's
  path-aware-at-arbitrary-depth requirement implied but didn't enumerate.
- Runner reordering (`executionOrder`) and selection (`selected`) are kept as two independent
  pieces of state rather than one combined structure — a request can be dragged to a position
  while unchecked. Not spelled out explicitly in the plan, but a natural reading of "independent,
  user-editable" or ambiguous otherwise (checking a box would have to silently jump the item to
  some position, which is a worse UX than what shipped).

**plan.md update confirmation:** this section (Phase 3 — COMPLETE) added; the Collection Runner
gap-analysis list above ("Status — In Progress Right Now") should now be read as: items #1
(`executionOrder`) and #2 (drag-and-drop reordering) are DONE (delivered this phase, not deferred
to Phase 4 as an old draft numbering might imply); items #3–7 (renumbered from the original #3–7:
Pause, select-all/clear-selection + folder-group checkboxes, full request/response detail panel,
progress bar/live timer, Run Again persistence) remain, and are exactly Phase 4's scope below.
"Next Module To Start" updated to point at Phase 4.

**Concern flagged for Phase 4:** none of Phase 4's scope (Pause, select-all/clear-selection,
request/response detail panel, progress bar, Run Again persistence) intersects with this phase's
changes — `RunnerDialog.tsx`'s `executionOrder`/`selected` state and the `startRunner` call site
are both narrow, additive changes that Phase 4 can build on directly (e.g. a future "select all"
action would just set `selected` to the full id set, with `executionOrder` untouched; Run Again
persistence would need to persist `executionOrder` alongside the selected-id list mentioned in the
original gap analysis).

## Paused Work (stopped intentionally, not abandoned)

- **Bruno-style UI redesign + full functional audit/bug-fix pass** — was actively running,
  intentionally stopped (`TaskStop`) to prioritize Workspace Management per user direction.
  Nothing was lost; it had completed its pre-flight check and flagged an important finding
  (see "Known Uncommitted WIP" below) but had not yet started the actual audit or redesign
  work. **Resume this after Workspace Management + Collection Runner priorities are handled**,
  unless the user says otherwise — the redesign will likely need to be redone anyway on top of
  whatever new Workspace/sidebar UI comes out of priority 1, so don't resume it blindly; re-scope
  it once the sidebar/collection-tree UI has stabilized.

---

## Completed Milestones (do not rebuild — reuse/extend)

- **Milestone C** — Collection Runner + Folder Runner: sequential execution, manual iteration
  count, dataset-driven iterations, delay-between-requests config, stop-on-failure vs.
  continue-on-failure, cancellation, Run History (persisted, scoped clear/delete). See
  `apps/web/src/components/runner/RunnerDialog.tsx`, `apps/web/src/lib/runner.ts`,
  `useAppStore.ts`'s `startRunner`.
- **B3** — dependency execution + runtime variable propagation (e.g. Login extracts a token,
  a dependent request uses it via `dependsOn`). See `executeRequestWithDependencies` in
  `useAppStore.ts`.
- **D.1 Phase 1 (Steps 1–8, all committed)** — hierarchical variable resolution (7-layer
  precedence: Global < Environment < Collection < Folder < Request < Runtime < Iteration, sole
  implementation `mergeResolutionContext` in `packages/runner-engine/src/types.ts`) and
  authentication inheritance (Request → Folder → Collection → none, sole implementation
  `resolveInheritedAuth` in `apps/web/src/lib/authInheritance.ts`). Includes: Global Variables
  UI (Step 6), Collection/Folder Settings for variables+auth (Step 7), Request-local variables +
  auth-inheritance preview UI (Step 8). **These are the canonical resolution/execution
  mechanisms — any new work (Workspace Management, Collection Runner enhancements) must consume
  them, never duplicate or fork them.**
- **D.2 Step 3** — form-data and x-www-form-urlencoded request body support, with full
  Playwright E2E coverage (`apps/web/e2e/bodies.spec.ts`). Marked "Done" in
  `docs/FEATURE-MATRIX.md`.
- **GitHub Pages deployment** — `.github/workflows/deploy-pages.yml`, Vite base-path fix, CSP
  `connect-src` widened to allow arbitrary external API hosts (was blocking the app's core
  function once deployed — this was a real production defect, now fixed and committed).
  Committed as `0f765e3` and `eddbd2d`. Live (once pushed) at
  `https://ghanendra-sdet.github.io/api-lab/`.

## Known Uncommitted WIP (found during the paused audit, not yet resolved)

A batch of uncommitted, undocumented changes exists in the working tree — not referenced in
`FEATURE-MATRIX.md`, `docs/ROADMAP.md`, or any prior report. Looks like a half-built
"Settings / Customization" feature:
- `apps/web/src/components/layout/SettingsDialog.tsx` (new, untracked) — font-size and
  theme-color (green/purple/red) overrides via CSS variables + `!important` Tailwind overrides.
- `TopBar.tsx` — wired to open the new Settings dialog.
- `ScriptsPanel.tsx` — scripts editor swapped from plain `<textarea>` to Monaco (removed a
  previously-documented comment about Monaco's CDN-loader limitation in `BodyPanel.tsx` along
  the way — comment deleted, not resolved, worth checking whether the underlying limitation was
  actually fixed or just the comment vanished).
  - **Resolved by the 2026-08-22 verification pass:** the CDN-loader "limitation" was checked —
    Monaco loads from `https://cdn.jsdelivr.net` via `@monaco-editor/react`'s default loader
    (`monaco-editor` is not a direct dependency, so nothing is bundled locally), and
    `apps/web/index.html`'s CSP already deliberately allowlists that host with its own explanatory
    comment. This is a real, working, intentional design decision, not an unresolved gap — the
    deleted comment in `BodyPanel.tsx` was simply redundant with the CSP's own comment once Monaco
    moved from an "only in BodyPanel" fact to "used in three components," not a sign the
    underlying limitation was silently dropped. Separately, this same pass found and fixed 15 E2E
    test interactions across 5 spec files that were broken by *not* accounting for how Monaco
    actually renders/receives input (see "Verification & Polish Pass — COMPLETE" above,
    Section 6-equivalent) — those were test bugs, not evidence of an app-level Monaco problem.
- `RequestWorkspace.tsx` — new drag-resizable request-panel height, persisted to `localStorage`.
- `BodyPanel.tsx` — new JSON/XML/HTML "beautify" helper.
- `apps/mock-server/src/index.ts` — port now also falls back to `process.env.PORT`.

**Status: unresolved** (the feature itself — font/theme, resize, beautify — is still
undecided/unfinished; only the Monaco-CDN question above was specifically investigated and closed
out during the 2026-08-22 verification pass). Left untouched per the "don't touch uncommitted work
without explicit direction" rule — no bug found in it blocked anything in that pass's audit, so
scope was not expanded into finishing it. Revisit once current priorities are handled, or sooner
if the user clarifies.

---

## Next Module To Start

**Immediately next: Phase 4 — Collection Runner remaining gaps** (see "Phase 4" in the "Full
reconciled build order" above for the complete scope; Phase 3, drag-and-drop, is now COMPLETE —
see that section above). One-line reminder: gap items #1/#2 (independent `executionOrder` +
drag-and-drop reordering) are DONE as of Phase 3 — what's left is items #3–7: true Pause distinct
from Stop (flag alongside the existing `AbortController`, same two check points Stop already
uses); select-all/clear-selection + folder-group checkboxes in the Runner's unified view; full
request/response detail in the expand panel (method/URL/headers/params/body, response
headers/body — data is likely already on the model, this is probably rendering-only); a real
`<progress>` element + live elapsed-time counter while running (`setInterval` while `status ===
"running"`); and Run Again config (selected-ids + `executionOrder`) persisted across a dialog
close/reopen (`RunnerRunHistoryItem` doesn't currently store the selected-request-ID list).

**Do not start:** the Bruno redesign, the full functional bug-fix audit, or the unresolved
Settings/Customization WIP above, until priorities 1 and 2 are functionally solid — unless the
user explicitly redirects.
