# CLAUDE.md — API Lab Agent Instructions

This file governs how AI-assisted development is carried out in this repository. It applies to every session, not just the first one.

## Mission

Build API Lab as a production-quality, open-source, browser-based API testing platform — a real, usable tool, not a demo. Comparable in workflow to existing commercial API clients, but independently designed and implemented: own name, own UI, own architecture, own source code.

## Engineering Principles

- **TypeScript-first** — no untyped `.js` in application or package source.
- **Strong typing** — avoid `any`; prefer explicit types and runtime validation (Zod or equivalent) at every boundary that receives external data (imported files, network responses, user scripts).
- **Modular architecture** — the `packages/` boundary is real: engines (`request-engine`, `test-engine`, `mock-engine`, etc.) must not reach into `apps/` internals, and must be usable independently of the web UI.
- **Small, reusable components** — prefer composition over large monolithic components or modules.
- **No unnecessary dependencies** — every new dependency needs a stated architectural reason before it's added. Prefer the standard library or an existing dependency over a new one.
- **Clear separation of concerns** — UI, state, request execution, scripting, and persistence are distinct layers with explicit interfaces between them.
- **Security-first design** — anything that executes user-authored code, makes network calls, or handles credentials is designed for its security model *before* it's implemented. See `docs/SECURITY.md`.
- **Test-driven validation where practical** — engine packages (`request-engine`, `test-engine`, `runner-engine`, etc.) should have unit tests written alongside their implementation, not after.
- **No speculative features** — build what the current milestone calls for. Future protocols (GraphQL, WebSocket, SSE, SOAP, gRPC) are roadmap items, not partial implementations.
- **No unnecessary repository-wide changes** — a milestone's changes should be scoped to what that milestone requires. Don't refactor unrelated code opportunistically.
- **No placeholder functionality presented as complete** — a feature is either implemented and validated, or it doesn't exist yet. No stub UI that looks functional but isn't wired up.
- **No hardcoded production credentials.**
- **No secrets committed to Git** — `.env*` is gitignored; document required environment variables in an `.env.example` file instead.

## Development Workflow

Every milestone follows this sequence, in order:

```
Analyze → Plan → Explain → Implement → Validate → Summarize → Recommend Next Milestone → STOP
```

- **Analyze**: understand the milestone's actual requirements and how they interact with what already exists.
- **Plan**: decide the concrete implementation approach before writing code.
- **Explain**: state the plan in plain terms before implementing it.
- **Implement**: build exactly the current milestone's scope.
- **Validate**: run the Definition of Done checks below — don't assume something works because it compiles or looks right manually.
- **Summarize**: report what was built, how it was validated, and current repository state.
- **Recommend Next Milestone**: name the next milestone and what it would involve, without starting it.
- **STOP**: wait for explicit approval before continuing.

**The agent must not automatically continue to the next milestone.** Each milestone is a checkpoint for human review.

## Definition of Done

A milestone is not complete until:

- [ ] Feature implemented per its scope in `docs/ROADMAP.md` / `docs/FEATURE-MATRIX.md`
- [ ] Unit tests added for new logic
- [ ] Integration tests added where applicable
- [ ] Playwright E2E tests added where applicable (user-facing flows)
- [ ] TypeScript compiles with no errors
- [ ] Lint passes with no errors
- [ ] Production build succeeds
- [ ] No console errors in the running app
- [ ] No broken links in documentation
- [ ] Relevant docs updated (`FEATURE-MATRIX.md` status, `ROADMAP.md` if scope shifted, package-level READMEs)
- [ ] `git status` clean — everything intended to be committed is committed, nothing else is

A milestone is never marked complete solely because the UI appears to work in manual testing.

## Git Discipline

- Commit messages follow Conventional Commits style: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Commits are scoped to one logical change — no giant commits mixing unrelated concerns.
- Before every commit: run `git status` and `git diff` to review exactly what's being committed.
- After every milestone: `git status` and `git log -1` to confirm a clean final state.
- Never push changes unrelated to the current milestone's scope.

## Scope Boundaries

- This repository (`api-lab`) is independent. Do not modify other repositories in the workspace (TestAtlas, Automation Playground, Raasta FM, or any other project) unless explicitly instructed for that specific task.
- Do not implement functionality beyond the current milestone's approved scope, even if it seems like a natural next step. Propose it as the next milestone instead.

## Operating Priority

When priorities conflict, resolve in this order:

```
Architecture → Correctness → Security → Usability → Testing → Documentation → Performance → Features
```

Feature count is never the goal. A smaller set of features that is correct, secure, and well-tested is preferred over a larger set that isn't.
