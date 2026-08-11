# API Lab — Architecture

This document defines the system architecture and the technology decisions behind it, and the reasoning for each. It is a living document — update it when an architectural decision changes, and record *why* it changed.

## 1. Target Repository Structure

```text
api-lab/
│
├── apps/
│   ├── web/                  # The API Lab UI (React + Vite)
│   ├── mock-server/          # Standalone mock API engine, runnable independently of the browser
│   └── performance-worker/   # Load-generation worker, runs the performance engine at scale
│
├── packages/
│   ├── collection-format/    # Native + Postman + OpenAPI collection schema, parsing, serialization
│   ├── request-engine/       # Builds and sends HTTP requests; method/param/header/body handling
│   ├── environment-engine/   # Variable scoping, interpolation, environment resolution
│   ├── auth-engine/          # Auth strategy implementations (API Key, Basic, Bearer, JWT, OAuth2)
│   ├── script-engine/        # Sandboxed pre-request/post-response script execution
│   ├── test-engine/          # Assertions, JSON Schema validation, JSONPath, test result model
│   ├── runner-engine/        # Collection execution orchestration, iteration, data-driven runs
│   ├── mock-engine/          # Mock endpoint definition, scenario matching, response generation
│   ├── performance-engine/   # Load-test orchestration, metrics aggregation (P50/P90/P95/P99 etc.)
│   └── shared/                # Cross-package types, utilities with no engine-specific logic
│
├── docs/
├── examples/
├── tests/
└── .github/
```

**This is a target architectural direction, not a build order.** Not every package listed here is created immediately — each is introduced when the milestone that needs it arrives (see `ROADMAP.md`). Creating empty package shells ahead of need would violate the "no speculative features" and "no placeholder functionality" principles in `CLAUDE.md`.

### Milestone 0 adjustment

At this initialization stage, **no `apps/` or `packages/` directories are created yet.** The full monorepo scaffold (workspaces, build tooling, package boundaries) is Milestone 1's concern, once there's an actual application shell to organize. Creating an empty monorepo skeleton now would be scaffolding with nothing in it — better to introduce each workspace package at the milestone that gives it real content, so every directory that exists has a reason to exist.

The structure above is the **agreed target**, established now so every later milestone builds toward it consistently, not decided ad hoc per milestone.

### As built — Milestone 1

`apps/web` and `packages/shared` now exist, wired together via npm workspaces (no Turborepo/Nx — unjustified for a two-package repo). `packages/shared` holds only the domain types the UI needs right now (`HttpMethod`, `KeyValueRow`, `AuthType`, `BodyMode`/`BodyRawFormat`) — no logic, no engine placeholders. The remaining `apps/*` and `packages/*-engine` directories in the target tree above are still deliberately not created; each arrives at the milestone that gives it real content, per the Milestone 0 principle above.

`apps/web`'s internal structure follows `components/{layout,collections,request,response,common}` + `store/` (Zustand) + `types/` + `lib/`. State: a single Zustand store (`useAppStore`) holds cross-cutting UI state — open tabs, each tab's full editable request state, theme, environment selection, sidebar visibility — because Milestone 1 itself needed it (sidebar, tabs, request bar, and six config panels all read/write the same tab state; prop-drilling across that many siblings was the alternative, not a simpler one).

**Known limitation carried forward**: `@monaco-editor/react` (used for the raw-body JSON editor) defaults to loading Monaco's assets from a CDN (jsdelivr) at runtime rather than the bundled npm package — inconsistent with the zero-install/self-contained goal and an unreviewed third-party runtime dependency. Flagged in code (`apps/web/src/components/request/BodyPanel.tsx`) as a fix-before-relying-on-it item: self-host the Monaco assets and point the loader locally. Still open as of Milestone 2.

### As built — Milestone 2

`packages/request-engine` now exists — the first real engine package, pure TypeScript with no DOM/React runtime dependency beyond `fetch`/`Headers`/`AbortController` type surfaces (typed via TS's `DOM` lib, no actual browser runtime coupling). Exposes:

- `buildUrl` / `buildHeaders` / `buildBody` / `buildRequest` — pure functions turning a `KeyValueRow[]`-based request config into a real `{ url, method, headers, body }`. Never overrides a user-set header (e.g. a user-set `Content-Type` beats the one implied by the chosen body format).
- `validateUrl` / `validateJsonBody` — pre-send validation (empty/malformed/unsupported-protocol URL; invalid JSON body), run before anything is sent.
- `RequestExecutor` interface + `BrowserFetchExecutor` — the only implementation this milestone; sends real requests via native `fetch`, supports `AbortSignal` cancellation, and converts thrown errors (network failure, CORS rejection, abort) into a normalized, friendly result rather than letting them propagate as exceptions.
- `normalizeResponse` — turns a raw `Response` into `ApiResponseResult` (status, headers, body, rawBody, duration, size, bodyKind). Classifies body content (`json`/`text`/`html`/`empty`) but never executes or renders it — HTML is always shown as text, everywhere in the UI.

`apps/web`'s `useAppStore` gained per-tab `requestStatus`/`responses`/`sendErrors`/`abortControllers` state and a `sendRequest`/`cancelRequest`/`resetRequest` action set that orchestrates the engine: validate → build → execute → normalize → store. The response viewer (`components/response/*`) reuses the same Monaco instance pattern as the request body editor (read-only, for the Pretty JSON view) rather than introducing a second rendering approach.

**Transport abstraction, not just an implementation**: `RequestExecutor` is deliberately an interface, not a hardcoded `fetch()` call in the store. `MockExecutor` (Milestone 9) and `PerformanceExecutor` (Milestone 10) implement the same interface later without the store's `sendRequest` orchestration changing.

**New known limitations**:
- **CORS**: API Lab is browser-only in Milestone 2 — a real external API that doesn't send permissive CORS headers will reject the browser's request, and the browser's `fetch()` reports this identically to a plain network failure (no way to distinguish "CORS rejected" from "DNS failed" from "connection refused" — this is a deliberate browser security restriction, not something JavaScript can introspect). The error message reflects this ambiguity honestly rather than guessing. `docs/ROADMAP.md`'s planned `ServerExecutor` (a controlled execution layer) is the architectural answer, not something this milestone works around.
- **Response size** is exact only when the server sends a `Content-Length` header; otherwise it's the decoded body's byte length, which will not match compressed/chunked wire size. `ApiResponseResult.sizeSource` states which case applies rather than presenting a single number as always-exact.
- **Cookies**: the response viewer's Cookies tab is a structural placeholder, not wired up — browsers don't expose `Set-Cookie` response header values to JavaScript for security reasons, so this needs its own design before Milestone 2's UI-parity claim would be accurate; deferred rather than faked.

### As built — Milestone 3

`packages/workspace-engine` now exists, holding the collections/folders/requests domain model and its CRUD. It is **deliberately not** the target tree's `packages/collection-format` — `collection-format` is reserved for Postman/OpenAPI import-export interop (Milestone 6), a different concern from internal CRUD and native persistence. `workspace-engine` owns:

- **Domain model**: `Workspace → Collection[] → CollectionItem[]` where `CollectionItem = SavedRequest | Folder`, and `Folder.items` holds only `SavedRequest[]` — folders are one level deep by design, per the milestone's own permission to keep the UI simple rather than build arbitrary nesting no one asked for yet. Every entity has a stable, non-regenerating ID (`createWorkspaceId`), so renames/moves/edits never silently fork identity.
- **Pure, immutable CRUD**: every operation (`createCollection`, `renameFolder`, `moveRequest`, `moveItemUp`, …) takes a `Workspace` and returns a new one; nothing is mutated in place. This keeps the store's `set()` calls trivial and makes the CRUD layer trivially unit-testable without any DOM or store dependency.
- **Zod-validated versioned serialization**: `serializeWorkspace`/`deserializeWorkspace` wrap the domain model in `{ version, workspace }`. `deserializeWorkspace` never throws — malformed JSON, wrong envelope shape, an unrecognized future `version`, or a structurally invalid workspace all resolve to a typed `{ ok: false, reason, detail }` result instead of an exception, so a corrupt or foreign `localStorage` value can never crash app startup.

**Saved Request vs. Open Tab.** `RequestTabState` (in `apps/web`) gained three optional fields — `savedRequestId`, `savedLocation`, `savedSnapshot` — that link a tab to a `workspace-engine` `SavedRequest` without merging the two concepts. A tab with none of these set is a scratch, never-saved request; Save opens a small Collection → Folder → Name dialog for it. A tab with all three set is "linked": Save updates the existing saved request in place (one click, no dialog), and dirtiness is computed — never stored reactively — by diffing the tab's live config against `savedSnapshot` (`isTabDirty` in `apps/web/src/lib/requestConfig.ts`). **Opening an already-open saved request activates its existing tab** rather than creating a second editing session on the same underlying request — the alternative (silently allowing two tabs to diverge against one saved request) would make "which edit wins on Save" ambiguous, which is worse than just switching to the existing tab.

**Store split.** `useAppStore` now has two state families with different responsibilities: `workspace` (collections/folders/saved requests — the persistent, must-be-correct data) and `tabs`/`activeTabId`/request-execution state (the M1/M2 tab and HTTP-execution state, unchanged in shape). They're still one Zustand store, not two — the coupling between "open a saved request" and "create/update a tab" is inherent to the feature, and splitting the store itself would just move that coupling into extra glue code without buying independence either side actually needs.

**Two-tier persistence.** `apps/web/src/lib/persistence.ts` treats the two state families differently, matching their actual risk profiles: the workspace is written to `localStorage["api-lab-workspace"]` as a versioned, Zod-validated envelope (`WORKSPACE_FORMAT_VERSION = 1`) — data the user would be upset to lose, so it's read back through full schema validation and a load failure surfaces a **"Reset Local Workspace"** recovery banner rather than silently discarding it. Tabs/session UI state go to `localStorage["api-lab-tabs"]` with only minimal shape validation (`isPersistedTabsBlob`) — losing an open-tab layout on a corrupt value just means falling back to one fresh tab, not a data-loss event worth interrupting the user over. Both writes are debounced 400ms (`lib/debounce.ts`) via a `useAppStore.subscribe()` listener, so rapid typing in the URL/body editors doesn't hit `localStorage` on every keystroke.

**Recovery, not silent data loss.** If `loadWorkspaceFromStorage()` returns an error (malformed JSON, invalid schema, or an unsupported future version), the workspace starts as empty and `workspaceLoadError` is set; the sidebar shows the corrupt payload's detail and a "Reset Local Workspace" button, and — critically — the (still present but unreadable) `localStorage` value is left untouched (the persistence subscriber skips writes while `workspaceLoadError` is set) until the user explicitly confirms the reset via a native `confirm()`. This means a corrupt value is always recoverable by hand (e.g. via devtools) even if the user never clicks Reset.

**Why localStorage over IndexedDB.** The target architecture (§2, "Explicitly deferred") left this as a Milestone 3 decision. `localStorage` was chosen because the workspace is small (collections of requests, not response bodies or binary attachments), synchronous access keeps the debounce/subscribe pattern simple, and the two-tier strict/best-effort validation strategy above already covers the corruption-handling need that IndexedDB's transactional guarantees would otherwise be solving. If a future milestone (e.g. large offline response caching, or binary body storage) needs more headroom than `localStorage`'s ~5-10MB origin quota, that's a concrete, revisit-able trigger — not something to build against speculatively now.

**UI.** The collections sidebar (`apps/web/src/components/collections/*`) now drives real CRUD: `CollectionSidebar` (create-collection, empty state, the recovery banner), `CollectionItem`/`FolderItem`/`RequestItem` (rename/delete/reorder via native `prompt`/`confirm`, new-folder/new-request, duplicate, per-item empty states), and `SaveRequestDialog` (the one genuinely multi-field dialog, used only for first-time saves). `RequestTabs` gained a dirty (`*`) indicator and a close-tab `confirm()` guard so an unsaved edit is never discarded silently. `RequestBar` gained a `Save` button that either updates a linked request in place or opens the Save dialog.

### Why a monorepo

- Multiple runtime targets (`apps/web`, `apps/mock-server`, `apps/performance-worker`) need to share core logic (`request-engine`, `collection-format`, `environment-engine`) without duplicating it or publishing intermediate packages to a registry just to consume them internally.
- The `packages/*-engine` boundary keeps business logic independent of any UI framework — every engine must be usable from a script or a test without importing React. This is enforced by the workspace boundary itself, not just convention.
- A single repository keeps versioning, CI, and cross-package refactors tractable for a project at this stage. If a package ever needs independent versioning/publishing (e.g., `collection-format` as a standalone npm package for interop with other tools), it can be extracted later — the packages/ boundary already makes that extraction low-cost.

## 2. Technology Stack

### Frontend — `apps/web`

| Choice | Reason |
|---|---|
| **React + TypeScript** | Component-based UI with a large ecosystem; TypeScript is non-negotiable per `CLAUDE.md`'s strong-typing principle. |
| **Vite** | Fast dev server and build for a SPA with no server-rendering requirement — API Lab is a client-side application by design. |
| **Tailwind CSS** | Utility-first styling keeps the "extremely simple, clean, fast" UI goal achievable without a growing custom CSS surface; pairs well with a small, composable component set. |
| **Zustand** | Minimal, unopinionated state management. API Lab's state (active collection, open tabs, environment selection, in-flight requests) doesn't need Redux-level ceremony; Zustand avoids the boilerplate while staying fully typed. |
| **Monaco Editor** | Needed specifically for the pre-request/post-response script editor and raw body/JSON editing — syntax highlighting, JSON validation, and a familiar editing experience are hard to justify building from scratch. |

### Testing

| Choice | Reason |
|---|---|
| **Vitest** | Unit/integration testing for both `packages/*` engines and `apps/web` components; Vite-native, fast, and shares config style with the build tool already in use. |
| **Playwright** | End-to-end testing of real user flows (build a request, send it, see a response; run a collection; etc.) — required by `CLAUDE.md`'s Definition of Done for user-facing flows. |

### Backend / Execution Services

| Choice | Reason |
|---|---|
| **Node.js + TypeScript** | Consistent language across the entire stack — engines, mock server, and performance worker share types and logic with the frontend where relevant (e.g., `request-engine`, `collection-format`). |
| **Fastify** | Chosen over Express for `apps/mock-server`: built-in schema validation hooks, lower overhead, and first-class TypeScript support suit a service whose entire job is deterministic, schema-driven mock responses. Express remains an acceptable fallback if a specific milestone surfaces a concrete Fastify limitation — this is a default, not a permanent commitment. |

### Validation

| Choice | Reason |
|---|---|
| **Zod** | Runtime validation at every boundary that receives external/untrusted data: imported Postman/OpenAPI files, mock request payloads, script engine inputs/outputs. Zod's inferred TypeScript types keep the runtime schema and the compile-time type as a single source of truth, which is the whole point of using it instead of hand-written type guards. |

### Explicitly deferred / not yet decided

- **OAuth 2.0 flow handling**: needs a concrete design (popup vs. redirect, token storage) before a library choice is made — deferred to Milestone 5.
- **Performance worker execution model**: whether load generation runs in the browser (Web Workers), in a Node process, or both, is a Milestone 10 architectural decision requiring its own analysis, not a default assumed here.

## 3. Data Flow — Mock-First Principle

The default API experience routes through a controlled mock layer, not directly at arbitrary external hosts by default:

```text
API Lab UI
     │
     ▼
Request Engine
     │
     ├── Mock API           (deterministic, project-controlled — default target for examples/onboarding)
     │
     ├── External API       (real endpoints, user-configured — the normal case once a user has a real API to test)
     │
     └── Performance Worker (load generation, routes through Request Engine's same request model)
```

`request-engine` is the single execution path all three targets share — the mock server, real external requests, and the performance worker all build and send requests through the same engine, so request-building logic is never duplicated or allowed to drift between "normal" sends and load-test sends.

The mock server is deterministic and versioned with the rest of the codebase specifically so example collections, onboarding flows, and future E2E/Playwright tests have a stable, project-controlled target that doesn't depend on any external service being up.

## 4. Script Execution Boundary

`script-engine` (pre-request/post-response scripts) is architecturally isolated from the main application context. No user-authored script runs with direct access to the DOM, `apps/web`'s own state, or stored credentials. The concrete sandboxing mechanism, resource limits, and isolation boundaries are specified in [`SECURITY.md`](SECURITY.md) and must be designed and reviewed before `script-engine` is implemented (Milestone 7) — not treated as something to harden after the feature ships.

## 5. Open Architectural Questions

Recorded here rather than silently decided, so they get an explicit answer at the milestone that needs one:

1. ~~Persistence layer for collections/environments~~ — resolved in Milestone 3: `localStorage`, versioned/Zod-validated envelope, two-tier strict/best-effort strategy. See "As built — Milestone 3" above. Revisit only if a future milestone needs storage headroom `localStorage`'s quota can't cover.
2. OAuth 2.0 token flow implementation (popup/redirect, token storage strategy) — Milestone 5.
3. Script sandbox mechanism (Web Worker + restricted global scope vs. a WASM-based sandbox vs. an iframe-based isolate) — must be resolved before Milestone 7 begins, documented in `SECURITY.md`.
4. Performance worker execution model (browser-based vs. Node-based load generation) — Milestone 10.
5. Whether `collection-format`, once stable, should be published as a standalone npm package for external interoperability — deferred until there's real external demand, not decided speculatively now.
6. Whether Environments (Milestone 4) need their own persisted state slice alongside `workspace`, or should live inside it — a Milestone 4 decision, made when there's a real variable-scoping model to persist.
