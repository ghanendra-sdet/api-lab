# API Lab — Resume State

Read this file FIRST on session resume, before re-reading conversation history or the full docs/ narrative files. Update it at natural checkpoints (after a commit, after a milestone completes) — keep it terse.

## Current position

- **Last commit**: `feat: add api contract testing` (Milestone 11) — **LOCAL ONLY, NOT PUSHED**. The user pushes manually: `git push origin main`.
- **Milestone 11 (API Contract Testing & OpenAPI Validation) — COMPLETE.** Reported and STOPPED per workflow rule. Waiting for explicit user approval before Milestone 12.
- **Workflow rule (from repo CLAUDE.md)**: Analyze → Plan → Explain → Implement → Validate → Report → STOP. Never auto-start the next milestone.
- **Next milestone recommended**: Milestone 12 — Security Hardening & Advanced API Testing. Not started. No prompt drafted yet.

## What exists (packages/apps)

`packages/`: shared, request-engine, auth-engine, environment-engine, workspace-engine, collection-format, test-engine, runner-engine, mock-engine, performance-engine, **contract-engine**.

**Repo-wide convention**: ALL packages use explicit `.ts` extensions on relative imports (`export * from "./types.ts"`), with `allowImportingTsExtensions` in every package tsconfig. Required because Node's ESM resolver never infers extensions and the mock server / performance worker import these packages directly. If you add a file to any package, use the `.ts` extension.

`apps/web`: the full React/Vite/Zustand SPA — collections/folders/requests, environments, auth, import/export, assertions + extractions, Collection Runner with datasets/chaining/iterations, Mock Server manager UI, Performance workspace, and (M11) a **Contract** tab per request plus a **Contract** dialog in the top bar (Specifications / Drift / Coverage / Report).
`apps/mock-server`: standalone Fastify server on port 4010 (`npm run dev:mock-server`). Plain `node src/index.ts`, Node 24 type-stripping, no build step.
`apps/performance-worker`: load generator, Fastify control plane on port 4020 (`npm run dev:performance-worker`), `worker_threads` Worker per run. Same no-build-step convention.

## Milestone 11 specifics worth not re-deriving

- **JSON Schema validator is `@cfworker/json-schema`, NOT ajv.** ajv was rejected because it compiles schemas via `new Function` — untrusted OpenAPI documents must never become executed code, and it would force `unsafe-eval` in a CSP. Do not "upgrade" to ajv without revisiting docs/SECURITY.md's Milestone 11 section.
- **One dialect (2020-12) + one explicit 3.0→3.1 translation** in `schemaNormalize.ts`: `nullable: true` → `type: [T,"null"]`, and boolean `exclusiveMinimum/Maximum` → numeric. Applied ONLY to 3.0 docs. Both are load-bearing — without them 3.0 documents produce false violations / silently dropped bounds.
- **ReDoS screening is not optional**: `^(a+)+$` on 31 chars was measured blocking the thread for 60 seconds. `redos.ts` removes unsafe patterns before validation and emits a warning.
- **M6's OpenAPI import code in `collection-format` was deliberately left untouched** — the two are different projections of the same documents, not duplicated ingestion.
- Contract validation plugs into the existing single pipeline in `apps/web/src/lib/executeRequest.ts` (after variable resolution + auth, before send), so Send and the Runner behave identically.
- Runner has a distinct `contract-failed` status; contract failures are never collapsed into assertion failures.
- E2E note: `apps/mock-server/data/*.json` is gitignored and **accumulates routes across local runs**. If M9 mockServer E2E test 3 fails oddly, delete `apps/mock-server/data/mock-routes*.json` and re-run — it's stale-data pollution, not a code regression.

## Validation status as of last commit

`typecheck` / `lint` / `test` (**808** unit/integration tests across all workspaces) / `build` / `test:e2e` (**114/114** Playwright, includes 12 new contract E2E) all passing. No known regressions.

## Where to look for detail (only if this file isn't enough)

- `docs/ROADMAP.md` — milestone-by-milestone status, one paragraph each, ✅ marks on completed ones.
- `docs/ARCHITECTURE.md` — "As built — Milestone N" sections have the actual design decisions and reasoning.
- `docs/FEATURE-MATRIX.md` — per-feature Done/Deferred/Planned status.
- `docs/SECURITY.md` — security posture per milestone.

Do not re-read full conversation history to reconstruct status — this file plus `docs/ROADMAP.md`'s status lines are sufficient to resume work or answer "what's done so far."
