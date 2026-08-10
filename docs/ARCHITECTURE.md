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

**Known limitation carried forward**: `@monaco-editor/react` (used for the raw-body JSON editor) defaults to loading Monaco's assets from a CDN (jsdelivr) at runtime rather than the bundled npm package — inconsistent with the zero-install/self-contained goal and an unreviewed third-party runtime dependency. Flagged in code (`apps/web/src/components/request/BodyPanel.tsx`) as a fix-before-relying-on-it item: self-host the Monaco assets and point the loader locally.

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

- **Persistence**: local-first persistence (IndexedDB via a thin wrapper, most likely) is the expected default for a browser-first tool, but the specific library is a Milestone 3 (Collections) decision, made when there's a real data model to persist against.
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

1. Persistence layer for collections/environments (IndexedDB wrapper choice) — Milestone 3.
2. OAuth 2.0 token flow implementation (popup/redirect, token storage strategy) — Milestone 5.
3. Script sandbox mechanism (Web Worker + restricted global scope vs. a WASM-based sandbox vs. an iframe-based isolate) — must be resolved before Milestone 7 begins, documented in `SECURITY.md`.
4. Performance worker execution model (browser-based vs. Node-based load generation) — Milestone 10.
5. Whether `collection-format`, once stable, should be published as a standalone npm package for external interoperability — deferred until there's real external demand, not decided speculatively now.
