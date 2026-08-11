# API Lab — Resume State

Read this file FIRST on session resume, before re-reading conversation history or the full docs/ narrative files. Update it at natural checkpoints (after a commit, after a milestone completes) — keep it terse.

## Current position

- **Last commit**: `cedf8a0` — "feat: add mock server and api simulation (Milestone 9)" — pushed to `origin/main`, working tree clean.
- **Milestone 9 (Mock Server & API Simulation) — COMPLETE.** Reported and STOPPED per workflow rule. Waiting for explicit user approval before Milestone 10.
- **Workflow rule (from repo CLAUDE.md)**: Analyze → Plan → Explain → Implement → Validate → Report → STOP. Never auto-start the next milestone.
- **Next milestone recommended**: Milestone 10 — Performance Engine. Not started. No prompt drafted yet.

## What exists (packages/apps)

`packages/`: shared, request-engine, auth-engine, environment-engine, workspace-engine, collection-format, test-engine, runner-engine, mock-engine.
`apps/web`: the full React/Vite/Zustand SPA — collections/folders/requests, environments, auth, import/export (Postman/OpenAPI/native), assertions + extractions, Collection Runner with datasets/chaining/iterations, Mock Server manager UI.
`apps/mock-server`: standalone Fastify server (real TCP port, browser can't open one itself) — route/scenario CRUD via `/__mock/*` admin API, real mock traffic on every other path. Run via `npm run dev:mock-server` (port 4010 default). Persists routes to `apps/mock-server/data/mock-routes.json` (gitignored). Runs as plain `node src/index.ts` — Node 24's built-in TS type-stripping, no bundler/tsx/build step (all internal relative imports need explicit `.ts` extensions because of this — see docs/ARCHITECTURE.md Milestone 9 section if touching these packages).

## Validation status as of last commit

`typecheck` / `lint` / `test` (all packages, 117 mock-engine+mock-server+web unit/integration tests) / `build` / `test:e2e` (86/86 Playwright, includes 12 new mock-server E2E) all passing. No known regressions.

## Where to look for detail (only if this file isn't enough)

- `docs/ROADMAP.md` — milestone-by-milestone status, one paragraph each, ✅ marks on completed ones.
- `docs/ARCHITECTURE.md` — "As built — Milestone N" sections have the actual design decisions and reasoning.
- `docs/FEATURE-MATRIX.md` — per-feature Done/Deferred/Planned status.
- `docs/SECURITY.md` — security posture per milestone.

Do not re-read full conversation history to reconstruct status — this file plus `docs/ROADMAP.md`'s status lines are sufficient to resume work or answer "what's done so far."
