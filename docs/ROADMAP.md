# API Lab — Roadmap

Milestones are sequential checkpoints. Per `CLAUDE.md`'s Development Workflow, each milestone is Analyzed, Planned, Explained, Implemented, and Validated before being summarized — and the project stops for review after each one. Nothing below is a commitment to a date; it's a commitment to an order.

## Milestone 0 — Repository & Architecture

- Repository created and added to the workspace
- Baseline files (`README.md`, `LICENSE`, `.gitignore`)
- `CLAUDE.md` engineering principles and workflow
- `docs/PRODUCT-SCOPE.md`, `docs/FEATURE-MATRIX.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`
- Development standards established

**Status**: In progress (this document is part of it).

## Milestone 1 — Application Shell ✅

- Monorepo workspace tooling set up (`apps/web`, `packages/shared`)
- UI foundation: sidebar, workspace area, request tabs, response area
- Theme (light/dark)
- Responsive layout

**Status**: Complete. Shipped: npm-workspaces monorepo, `packages/shared` domain types, the full application shell (top bar, collections sidebar, request tabs, method selector, URL bar, Params/Authorization/Headers/Body/Scripts/Tests panels, response panel with empty state), Zustand-based UI state, light/dark theme, responsive layout down to tablet width, an accessibility pass (labels, focus states, keyboard navigation), 16 Vitest unit tests, and a 5-scenario Playwright smoke suite. No request execution — `Send` shows a "not available yet" notice instead of a fake response, per this milestone's explicit non-goal.

## Milestone 2 — Request Builder ✅

- HTTP methods, URL bar, query/path parameters
- Headers editor
- Body editor (JSON, form-data, urlencoded, binary)
- Send request, view response (status, headers, body, timing)

**Status**: Complete (raw-body JSON/Text/XML/HTML; form-data and x-www-form-urlencoded remain UI-only, deferred). Shipped: `packages/request-engine` (URL/header/body builders, pre-send validation, a `RequestExecutor` transport abstraction with `BrowserFetchExecutor` as its only implementation, response normalization); real HTTP execution wired into the store per tab with loading/cancel state via `AbortController`; a response viewer with real status/time/size, Pretty (Monaco, read-only)/Raw views, a Headers tab, and correct empty/non-JSON/HTML handling (HTML always shown as inert text); 43 request-engine unit tests, 8 new apps/web unit tests, and a 14-scenario Playwright suite running against a small dependency-free local HTTP fixture (`apps/web/e2e/fixtures/server.mjs` — not the Mock Engine). CORS and response-size precision are documented, real limitations, not bugs — see `docs/ARCHITECTURE.md`.

## Milestone 3 — Collections

- Collections and folders
- Request CRUD (create, rename, duplicate, delete, reorder)
- Local persistence

## Milestone 4 — Environments

- Global, environment, collection, and local variable scopes
- Variable interpolation
- Environment switching

## Milestone 5 — Authentication

- API Key, Basic, Bearer, JWT
- OAuth 2.0 (authorization code, client credentials)
- Auth inheritance (collection → request)

## Milestone 6 — Import / Export

- Postman Collection import
- OpenAPI import (JSON, YAML)
- API Lab native format import/export

## Milestone 7 — API Testing Engine

- Assertions (status, headers, JSON body, schema, JSONPath, response time)
- Pre-request / post-response scripts, sandboxed (design finalized in `SECURITY.md` before implementation starts)
- Test result reporting

## Milestone 8 — Collection Runner

- Sequential collection execution, iterations, delays
- Data-driven execution (CSV, JSON)
- Run reports

## Milestone 9 — Mock API Engine

- Mock endpoint definitions
- Status-code and named scenarios
- Latency and error simulation

## Milestone 10 — Performance Engine

- Virtual users, concurrency, duration, ramp-up
- Metrics: RPS, avg, P50/P90/P95/P99, error rate, status distribution
- Performance reports

## Milestone 11 — Documentation Generation

- Endpoint documentation from collections
- Request/response examples, schema documentation
- Collection-level documentation

## Milestone 12 — Security Hardening

- Script sandbox implementation and audit
- SSRF protection
- Credential protection
- Resource limits (script execution time/memory)
- XSS protection
- Prototype pollution protection

## Milestone 13 — Full QA & Release

- Unit and integration test coverage across all packages
- Playwright E2E coverage of core user flows
- Build validation, accessibility pass, responsive testing
- Deployment
- Production smoke testing

---

**Process note**: at the end of each milestone, the agent reports what was built and how it was validated, then recommends the next milestone by name — it does not begin that next milestone without explicit approval.
