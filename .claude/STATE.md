# API Lab — Resume State

Read this file FIRST on session resume, before re-reading conversation history or the full docs/ narrative files. Update it at natural checkpoints (after a commit, after a milestone completes) — keep it terse.

## Current position

- **Last commits**: Milestone 13 — `7614faf`, `557c61d`, `30532a5` — **LOCAL ONLY, NOT PUSHED**. `origin/main` is at `866fff6` (the M12 docs commit), so M12 *is* pushed and the four unpushed commits are `5bdc360` (UI polish) plus the three M13 ones. The user pushes manually: `git push origin main`.
- **Milestone 13 (API Documentation Generation) — COMPLETE.** Reported and STOPPED per workflow rule. Waiting for explicit user approval before Milestone 14.
- **Workflow rule (from repo CLAUDE.md)**: Analyze → Plan → Explain → Implement → Validate → Report → STOP. Never auto-start the next milestone.
- **Next milestone recommended**: Milestone 14 — Full QA & Release. Not started. No prompt drafted yet.
- `5bdc360` (UI polish: resizable sidebar, home view, working seed collection) is unpushed and is not part of any numbered milestone.

## What exists (packages/apps)

`packages/`: shared, request-engine, auth-engine, environment-engine, workspace-engine, collection-format, test-engine, runner-engine, mock-engine, performance-engine, contract-engine, security-engine, **documentation-engine**.

**Repo-wide convention**: ALL packages use explicit `.ts` extensions on relative imports (`export * from "./types.ts"`), with `allowImportingTsExtensions` in every package tsconfig.

`apps/web`: the full React/Vite/Zustand SPA — collections/folders/requests, environments, auth, import/export, assertions + extractions, Collection Runner, Mock Server manager, Performance workspace, Contract tab + dialog, (M12) a **Security** dialog in the top bar (Generate / Preview / Results / Report) plus a `src/workers/` directory, and (M13) a **Docs** dialog in the top bar (settings column + live preview).
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

## Milestone 13 specifics worth not re-deriving

- **The architecture decision was "a third projection", not a wider contract model.** M11's `ContractModel` deliberately drops descriptions/tags/examples/response-descriptions. M13 does NOT widen it and does NOT re-parse. `generate/index.ts` calls contract-engine's `parseSpecSource` **once** and feeds the one parsed value to `buildContractModel` (structure) and `extractOpenApiDocMetadata` (prose). If you ever feel tempted to add prose fields to `ContractModel`, re-read `contract-engine/src/parse.ts`'s header first — M6 importer / M11 validator / M13 docs are three projections by design.
- **`provenance` is a required field on every documented fact**, not a document-level flag. That is what enforces spec §2 (no invented behavior) and §7 (label collection-derived material) structurally.
- **Precedence: the contract defines, the collection illustrates.** `generate/combine.ts` can only *add* examples and *fill* an absent description — there is deliberately no code path where a collection value replaces an existing contract value.
- **Recursion guard is path-scoped, not global** (`schema/describe.ts`). Global scoping would collapse sibling reuse of `Address` into bare references, which is not a cycle. Sibling reuse expands; only genuine recursion emits `{kind:"reference"}`.
- **`extractCollectionPath` delegates server-base-path stripping to contract-engine's `extractRequestPath`.** It originally did this itself and got it wrong: `/v1/orders` vs `/orders` silently broke the combined-source merge. Do not reimplement.
- **The canary suite caught two real leaks** neither redactor covered, because neither value went through a body: an OpenAPI parameter's `default`/`example`, and a collection query parameter's value. `redactNamedValue` + `isCredentialName` closed them. `secretCanary.test.ts` has a negative control so it cannot become vacuous.
- **`isPlaceholderOnly` uses a closed four-word scheme allowlist** (`bearer`/`basic`/`token`/`apikey`), not a heuristic — same reasoning as M12's closed `MutationOperation` union. `Authorization: Bearer {{token}}` must publish; anything else in prefix position is redacted.
- **`serializeForScript` is not decoration.** `JSON.stringify` alone is unsafe inside `<script>`: the HTML parser ends the element at the literal bytes `</script` regardless of JS quoting. `<`/`>` are escaped to unicode escapes.
- **The preview iframe is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`** — that combination is load-bearing (both together lets framed script remove its own sandbox). No `dangerouslySetInnerHTML` anywhere, and no sanitizer dependency.
- **Determinism is opt-out via `includeTimestamp`, default off.** Ids are pure content functions, every list is explicitly sorted, no counters, no randomness.
- **Only configuration persists** (`localStorage["api-lab-documentation"]`), never rendered output (spec §42). Credential-free by construction — there is no body/header/example field in the persisted shape.
- **Changing format re-renders; changing source regenerates.** `useDocumentationStore` splits these deliberately — parsing is the expensive half and is format-independent.
- **"Try Request" is deferred** per spec §31's own recommendation, and PDF is a §43 non-goal. Do not add either without revisiting docs/ARCHITECTURE.md.

## Validation status as of last commit

`typecheck` / `lint` / `test` (**1356** unit/integration across all workspaces) / `build` / `test:e2e` (**138/138** Playwright, includes 12 new documentation E2E) all passing. No known regressions.

Test split: documentation-engine 211, security-engine 222, contract-engine 284, mock-server 35 (16 are real-HTTP integration), apps/web 215, rest unchanged.

## Known gotchas

- `apps/mock-server/data/*.json` is gitignored and **accumulates routes across local runs**. If M9 mockServer E2E test 3 fails oddly, delete `apps/mock-server/data/mock-routes*.json` and re-run — stale-data pollution, not a regression.
- Security and documentation E2E seed the workspace via `localStorage` rather than clicking through collection/body UI (Monaco is slow to drive) — same precedent as `contract.spec.ts`'s `setMockRoute`. The features themselves are fully driven through the real UI.
- An `environments.spec.ts` Monaco assertion flakes occasionally under full-parallel E2E load (element not found within 5s); it passes in isolation and is a pre-existing timing issue, not a regression.
- In the Documentation dialog the specification select shows `spec.name` only (e.g. `docs-api`), **without** the `(OpenAPI 3.0.3)` suffix the Contract dialog adds — E2E label selectors differ between the two dialogs for that reason. `getByLabel("Collection")` is also ambiguous there (it matches the "Include collection examples" checkbox), so the E2E addresses those selects by id.
- A request with no assertions has runner status `skipped`, not `passed` — so "Functional: 0/1" is correct, not a bug.

## Where to look for detail (only if this file isn't enough)

- `docs/ROADMAP.md` — milestone-by-milestone status, one paragraph each, ✅ marks on completed ones.
- `docs/ARCHITECTURE.md` — "As built — Milestone N" sections have the actual design decisions and reasoning.
- `docs/FEATURE-MATRIX.md` — per-feature Done/Deferred/Planned status.
- `docs/SECURITY.md` — security posture per milestone, including M12's explicit non-goals and the QA-vs-pentest boundary.

Do not re-read full conversation history to reconstruct status — this file plus `docs/ROADMAP.md`'s status lines are sufficient.
