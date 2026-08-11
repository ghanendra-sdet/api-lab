# API Lab — Resume State

Read this file FIRST on session resume, before re-reading conversation history or the full docs/ narrative files. Update it at natural checkpoints (after a commit, after a milestone completes) — keep it terse.

## Current position

- **Last commit**: `ee2e0a0` — "feat: add performance testing engine" (preceded by `2cd53af`, the .ts-extension normalization) — pushed to `origin/main`, working tree clean.
- **Milestone 10 (Performance Engine) — COMPLETE.** Reported and STOPPED per workflow rule. Waiting for explicit user approval before Milestone 11.
- **Workflow rule (from repo CLAUDE.md)**: Analyze → Plan → Explain → Implement → Validate → Report → STOP. Never auto-start the next milestone.
- **Next milestone recommended**: Milestone 11 — API Contract Testing & OpenAPI Validation. Not started. No prompt drafted yet.

## What exists (packages/apps)

`packages/`: shared, request-engine, auth-engine, environment-engine, workspace-engine, collection-format, test-engine, runner-engine, mock-engine, performance-engine.

**Repo-wide convention (changed in M10)**: ALL packages now use explicit `.ts` extensions on relative imports (`export * from "./types.ts"`), with `allowImportingTsExtensions` in every package tsconfig. Before M10 only mock-engine did. Required because Node's ESM resolver never infers extensions and the performance worker imports these packages directly. Vite handles both forms; if you add a file to any package, use the `.ts` extension.
`apps/web`: the full React/Vite/Zustand SPA — collections/folders/requests, environments, auth, import/export (Postman/OpenAPI/native), assertions + extractions, Collection Runner with datasets/chaining/iterations, Mock Server manager UI, and a Performance workspace (config form, live metrics, report, inline-SVG charts, JSON/CSV export) reached from the "Performance" button in the top bar.
`apps/mock-server`: standalone Fastify server (real TCP port, browser can't open one itself) — route/scenario CRUD via `/__mock/*` admin API, real mock traffic on every other path. Run via `npm run dev:mock-server` (port 4010 default). Persists routes to `apps/mock-server/data/mock-routes.json` (gitignored). Runs as plain `node src/index.ts` — Node 24's built-in TS type-stripping, no bundler/tsx/build step (all internal relative imports need explicit `.ts` extensions because of this — see docs/ARCHITECTURE.md Milestone 9 section if touching these packages).
`apps/performance-worker`: the load generator (M10). Fastify control plane on port 4020 (`npm run dev:performance-worker`), binds 127.0.0.1, spawns a `worker_threads` Worker per run (`src/loadWorker.ts`). Same no-build-step convention as mock-server — and yes, Node's type-stripping DOES work for Worker entry points (verified empirically; that's why this architecture was chosen). API: `GET /__perf/status`, `POST /__perf/runs`, `GET /__perf/runs/:id/stream` (SSE), `POST /__perf/runs/:id/cancel`, `GET /__perf/runs/:id`. The browser NEVER generates load — if you're tempted to "just fetch in a loop", read docs/ARCHITECTURE.md's Milestone 10 section first.

## Validation status as of last commit

`typecheck` / `lint` / `test` (528 unit/integration tests across all workspaces) / `build` / `test:e2e` (102/102 Playwright, includes 16 new performance E2E) all passing. No known regressions.

## Where to look for detail (only if this file isn't enough)

- `docs/ROADMAP.md` — milestone-by-milestone status, one paragraph each, ✅ marks on completed ones.
- `docs/ARCHITECTURE.md` — "As built — Milestone N" sections have the actual design decisions and reasoning.
- `docs/FEATURE-MATRIX.md` — per-feature Done/Deferred/Planned status.
- `docs/SECURITY.md` — security posture per milestone.

Do not re-read full conversation history to reconstruct status — this file plus `docs/ROADMAP.md`'s status lines are sufficient to resume work or answer "what's done so far."
