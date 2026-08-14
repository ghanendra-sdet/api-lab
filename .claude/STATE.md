# API Lab — Resume State

Read this file FIRST on session resume, before re-reading conversation history or the full docs/ narrative files. Update it at natural checkpoints (after a commit, after a milestone completes) — keep it terse.

## Current position

- **Last commit**: `feat: add security and negative api testing` (Milestone 12) — **LOCAL ONLY, NOT PUSHED**. The user pushes manually: `git push origin main`.
- **Milestone 12 (Security Hardening & Advanced API Testing) — COMPLETE.** Reported and STOPPED per workflow rule. Waiting for explicit user approval before Milestone 13.
- **Workflow rule (from repo CLAUDE.md)**: Analyze → Plan → Explain → Implement → Validate → Report → STOP. Never auto-start the next milestone.
- **Next milestone recommended**: Milestone 13 — Documentation Generation. Not started. No prompt drafted yet.

## What exists (packages/apps)

`packages/`: shared, request-engine, auth-engine, environment-engine, workspace-engine, collection-format, test-engine, runner-engine, mock-engine, performance-engine, contract-engine, **security-engine**.

**Repo-wide convention**: ALL packages use explicit `.ts` extensions on relative imports (`export * from "./types.ts"`), with `allowImportingTsExtensions` in every package tsconfig.

`apps/web`: the full React/Vite/Zustand SPA — collections/folders/requests, environments, auth, import/export, assertions + extractions, Collection Runner, Mock Server manager, Performance workspace, Contract tab + dialog, and (M12) a **Security** dialog in the top bar (Generate / Preview / Results / Report) plus a `src/workers/` directory.
`apps/mock-server`: Fastify on port 4010. Plain `node src/index.ts`, Node 24 type-stripping, no build step. M12 added six security fixtures under `/__security/*`.
`apps/performance-worker`: load generator, Fastify control plane on port 4020. Same no-build-step convention.

## Milestone 12 specifics worth not re-deriving

- **`MutationOperation` is a closed union of nine operations — this is the security control, not a stylistic choice.** There is no `set-arbitrary`/`inject`/payload-dictionary and adding one requires revisiting docs/SECURITY.md. Every substitute credential is a hardcoded self-identifying constant in `credentials.ts` (so brute force is structurally impossible, not merely unimplemented).
- **ReDoS is now three AND-ed layers**, because M11's static screening was measured to have a real blind spot: `^[a-z]+[a-z]+…[a-z]+$` (10 consecutive quantified groups) passes *every* static check and still ran >8 seconds on a 40-char input. Layers: M11 shape screening → M12 complexity caps (`patternComplexity.ts`) → **M12 isolated Web Worker with 50ms timeout + `terminate()`** (`apps/web/src/workers/patternVetting.worker.ts` + `apps/web/src/lib/patternVetting.ts`). `terminate()` is the ONLY thing in JS that stops a running regex. `redosGap.test.ts` pins the blind spot so nobody removes the worker. A `safe` worker verdict deliberately does NOT loosen the static layers.
- Pattern vetting is **pre-flight** (on spec import and on restore-from-storage), not inline — validation is synchronous and can't await a worker. A `timeout` verdict also calls `clearContractCache()`, or a model parsed before the verdict would keep the pattern.
- **Boundary tests emit both polarities** (`minimum - 1` expects 4xx, `minimum` expects 2xx) via `BoundaryCase.expectValid`. The mock fixture `/__security/validation` enforces exactly what `e2e/fixtures/security/security-api.json` declares — if you change one, change both.
- **The tool cannot fail a test for something the tester never declared.** Unrequested observations are `warning`, never `failed` and never folded into a pass. Severity stops at `high` (no "critical") and `high` requires evidence — `createFinding` downgrades unevidenced ones.
- **Only test *definitions* persist** (`localStorage["api-lab-security"]`); results/findings are session-only by deliberate decision (spec §40). Definitions are credential-free by construction.
- `executeRequest.ts` gained an extracted **`prepareRequest`** shared by Send, the Runner, and security testing — do not fork it, or security tests would mutate a different request than the user configured.
- Mock fixtures are **canned responses, not a vulnerable app**, namespaced `/__security/*` so user mock routes are never shadowed.
- Disclosure detection uses **literal substrings only, zero regexes** — deliberate, so the scanner can't itself be a ReDoS vector.
- M11's YAML config was re-audited and confirmed already safe; 9 regression tests added (`yamlSecurity.test.ts`).

## Validation status as of last commit

`typecheck` / `lint` / `test` (**1111** unit/integration across all workspaces) / `build` / `test:e2e` (**126/126** Playwright, includes 12 new security E2E) all passing. No known regressions.

Test split: security-engine 222, contract-engine 284, mock-server 35 (16 are real-HTTP integration), apps/web 181, rest unchanged.

## Known gotchas

- `apps/mock-server/data/*.json` is gitignored and **accumulates routes across local runs**. If M9 mockServer E2E test 3 fails oddly, delete `apps/mock-server/data/mock-routes*.json` and re-run — stale-data pollution, not a regression.
- Security E2E seeds the workspace via `localStorage` rather than clicking through collection/body UI (Monaco is slow to drive) — same precedent as `contract.spec.ts`'s `setMockRoute`. The security feature itself is fully driven through the real UI.
- A request with no assertions has runner status `skipped`, not `passed` — so "Functional: 0/1" is correct, not a bug.

## Where to look for detail (only if this file isn't enough)

- `docs/ROADMAP.md` — milestone-by-milestone status, one paragraph each, ✅ marks on completed ones.
- `docs/ARCHITECTURE.md` — "As built — Milestone N" sections have the actual design decisions and reasoning.
- `docs/FEATURE-MATRIX.md` — per-feature Done/Deferred/Planned status.
- `docs/SECURITY.md` — security posture per milestone, including M12's explicit non-goals and the QA-vs-pentest boundary.

Do not re-read full conversation history to reconstruct status — this file plus `docs/ROADMAP.md`'s status lines are sufficient.
