# API Lab — Resume State

Read this file FIRST on session resume, before re-reading conversation history or the full docs/ narrative files. Update it at natural checkpoints (after a commit, after a milestone completes) — keep it terse.

## Current position

- **Last commit**: `e004e78` — "feat: add advanced runner workflows (Milestone 8)" — pushed to `origin/main`, working tree clean.
- **Milestone 8 (Advanced API Workflows) — COMPLETE.** Reported and STOPPED per workflow rule. Waiting for explicit user approval before Milestone 9.
- **Workflow rule (from repo CLAUDE.md)**: Analyze → Plan → Explain → Implement → Validate → Report → STOP. Never auto-start the next milestone.
- **Next milestone recommended**: Milestone 9 — Mock Server & API Simulation. Not started. No prompt drafted yet.

## What exists (packages/apps)

`packages/`: shared, request-engine, auth-engine, environment-engine, workspace-engine, collection-format, test-engine, runner-engine.
`apps/web`: the full React/Vite/Zustand SPA — collections/folders/requests, environments, auth, import/export (Postman/OpenAPI/native), assertions + extractions, Collection Runner with datasets/chaining/iterations.

## Validation status as of last commit

`typecheck` / `lint` / `test` (all packages) / `build` / `test:e2e` (74/74 Playwright) all passing. No known regressions.

## Where to look for detail (only if this file isn't enough)

- `docs/ROADMAP.md` — milestone-by-milestone status, one paragraph each, ✅ marks on completed ones.
- `docs/ARCHITECTURE.md` — "As built — Milestone N" sections have the actual design decisions and reasoning.
- `docs/FEATURE-MATRIX.md` — per-feature Done/Deferred/Planned status.
- `docs/SECURITY.md` — security posture per milestone.

Do not re-read full conversation history to reconstruct status — this file plus `docs/ROADMAP.md`'s status lines are sufficient to resume work or answer "what's done so far."
