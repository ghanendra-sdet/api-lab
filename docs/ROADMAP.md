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

## Milestone 3 — Collections ✅

- Collections and folders
- Request CRUD (create, rename, duplicate, delete, reorder)
- Local persistence

**Status**: Complete. Shipped: `packages/workspace-engine` (pure, immutable CRUD over a `Workspace → Collections → (Folders → Requests) | Requests` domain model, one level of folder nesting, stable non-regenerating IDs, Zod-validated versioned serialization); a store split between workspace state and request-execution state in `apps/web/src/store/useAppStore.ts`; the Saved-Request/Open-Tab distinction (opening an already-open saved request activates its existing tab rather than duplicating it); a functional collections sidebar (create/rename/delete/reorder for collections and folders, create/rename/duplicate/move/delete/reorder for requests, empty states) driven by native `prompt`/`confirm`; a small Save dialog for first-time saves and one-click re-save for linked tabs; a dirty (`*`) indicator with a close-tab confirmation guard; two-tier debounced localStorage persistence (strict versioned schema for the workspace, best-effort for the tab/session UI state) with corrupt/invalid/unknown-version recovery via a "Reset Local Workspace" banner that never crashes startup or silently discards data; 31 workspace-engine unit tests, 20 new apps/web unit tests, and an 11-scenario Playwright suite including a real (non-mocked) browser-reload persistence test — plus the full 14-scenario Milestone 2 regression suite, unmodified in intent, still passing. Postman/OpenAPI import-export remains out of scope (Milestone 6); `workspace-engine` is deliberately a separate package from the future `collection-format` adapter layer — see `docs/ARCHITECTURE.md`.

## Milestone 4 — Environments ✅

- Global, environment, collection, and local variable scopes
- Variable interpolation
- Environment switching

**Status**: Complete (Environment scope only — Global/Collection/Local variable scopes are designed and documented but deliberately not implemented; see below). Shipped: `packages/environment-engine` (an `Environment { id, name, variables[] }` / `Variable { id, key, value, enabled, secret }` domain model, pure CRUD mirroring workspace-engine's pattern, Zod-validated versioned serialization); a pure, independently-tested `resolveVariables(input, context)` resolver supporting `{{name}}` interpolation with unknown-variable detection (never silently becomes an empty string), circular-reference detection, and a resolution-depth safety net — malformed syntax (`{{`, `{{invalid`, `{{ spaced }}`) is left untouched rather than guessed at; a `resolveRequestConfig` bridge that resolves URL/query/header/body fields without ever mutating the saved/tab config (resolution happens only at send time); store integration in `useAppStore.sendRequest` that resolves against the active environment and blocks sending — with a named error, not a broken request — on unresolved or circular variables; a real environment selector and a focused Environment Manager dialog (create/rename/duplicate/delete environments; add/edit/delete/enable-disable/secret-flag variables) replacing the Milestone 1/2 placeholder selector; secret masking (per-row show/hide in the editor, always-masked in the resolved-URL preview, never logged); a dedicated versioned localStorage boundary for environments (separate from the workspace envelope, with its own corrupt-data "Reset Local Environments" recovery banner); 40 environment-engine unit tests (including explicit prototype-pollution regression tests for `__proto__`/`constructor`-named variables), 12 new apps/web unit tests, and a 9-scenario Playwright suite exercising real HTTP execution against the local fixture server — plus the full Milestone 2 (14) and Milestone 3 (11) regression suites, unmodified in intent, still passing. Documented scope precedence for future scopes (Local → Collection → Environment → Global) in `docs/ARCHITECTURE.md`, chosen so a future scope only needs to merge into the resolver's flat context object in the right order — no resolver rewrite required.

## Milestone 5 — Authentication ✅

- API Key, Basic, Bearer, JWT
- OAuth 2.0 (authorization code, client credentials)
- Auth inheritance (collection → request)

**Status**: Complete (No Auth/API Key/Basic/Bearer/JWT Bearer implemented and execution-tested; OAuth 2.0 and auth inheritance deliberately deferred with the architecture documented — see below). Shipped: `packages/auth-engine` (a serializable `AuthConfig` discriminated union — `none | apiKey | basic | bearer | jwt | oauth2` — with pure, independently-tested `validateAuthConfig` and `applyAuth` functions; `applyAuth` merges auth-generated headers/query-params on top of a request's existing ones under a documented, tested precedence rule: **the auth configuration wins on a name collision** — a manually typed `Authorization` header is silently replaced rather than sent alongside a conflicting duplicate, chosen because a user who explicitly configures auth almost always wants that credential actually sent); a small app-layer `resolveAuthConfig` bridge that resolves `{{variables}}` inside auth fields (API key value, username/password, bearer/JWT token) through the same environment-engine resolver already used for the URL/headers/body, keeping both engines mutually unaware of each other; `useAppStore.sendRequest` extended to resolve → validate → apply auth (after variable resolution, before `buildRequest`) — blocking on unresolved/circular auth variables or a missing required field with a named error, never sending a malformed request; a rewritten `AuthPanel` with real per-type fields, a Show/Hide values toggle (masked `password` inputs by default), and an honest "OAuth 2.0 support is planned" placeholder that blocks sending rather than pretending to work; `RequestConfig.auth` replacing the old cosmetic `authType` field, with full backward compatibility for every request saved before this milestone (defaults to `{type: "none"}` — verified by an explicit regression test, since no real credentials were ever stored under the old field); 17 auth-engine unit tests, 7 new apps/web unit tests (including a precedence-rule integration test asserting the actual outgoing `fetch` headers), and an 11-scenario Playwright suite exercising real HTTP execution — plus the full Milestone 2 (14), Milestone 3 (11), and Milestone 4 (9) regression suites, unmodified in intent, still passing. OAuth 2.0's browser-flow requirements, redirect-URI/token-storage concerns, and why a "safe minimal" flow isn't attempted this milestone are documented in `docs/ARCHITECTURE.md` and `docs/SECURITY.md`.

## Milestone 6 — Import / Export ✅

- Postman Collection import
- OpenAPI import (JSON, YAML)
- API Lab native format import/export

**Status**: Complete (OpenAPI import supports JSON documents only — YAML deferred, see below). Shipped: `packages/collection-format` (`postman/`, `openapi/`, `native/` sub-modules) implementing the format-independent import boundary `File → detect → parse (zod-validated) → adapt → NormalizedImport`, so the UI never parses external JSON itself and adding a future format (Insomnia, HAR, curl) means one more parser+adapter pair, not a redesign. Every adapter targets the same `NormalizedCollectionImport`/`NormalizedEnvironmentImport` shape built directly on `workspace-engine`'s real `RequestConfig` — no fourth request model. Postman Collection v2.1 import maps method/URL/query/headers/body(raw)/auth(noauth, apikey, basic, bearer) with a documented, tested "preserve-or-warn, never fake" policy for what Milestone 2 doesn't execute yet (form-data/urlencoded bodies preserved as readable text; unsupported auth types imported as No Auth; scripts counted and warned about, **never executed, never evaluated** — no `eval`/`new Function` anywhere in the parser); nested folders beyond API Lab's one level are flattened with an explicit warning rather than silently dropped or crashing. Postman Environment import maps `values[]` to API Lab variables, `type: "secret"` to the `secret` flag. OpenAPI 3.0.x/3.1.x import groups operations by first tag into folders, maps path parameters to `{{variable}}` syntax (a deliberate, documented choice — query/header parameters become ordinary empty rows instead, since they don't share the "must resolve before the URL is valid" property path parameters do), and maps `apiKey`/`http bearer`/`http basic` security schemes (oauth2/openIdConnect warn and import as No Auth). Postman Collection export and the native API Lab workspace export (`{format:"api-lab", version:1, workspace, environments}`) are both deterministic (no timestamps/random IDs) and round-trip tested — export → re-import → verify. Import always shows a mandatory preview (name, folder/request or variable counts, every warning) before the workspace is touched at all; a name collision gets a non-destructive `"X (Imported)"` suffix rather than overwriting; a 5MB file-size limit and a top-level try/catch around the whole parse/adapt pipeline (covering the recursive-structure stack-overflow case a maliciously deep-but-under-the-size-limit document could trigger) mean a hostile or malformed file can never crash the app. 40 collection-format unit tests (parsers, adapters, exporters, detection, negative/malicious-input fixtures, round-trip), 5 new apps/web unit tests, and an 8-scenario Playwright suite (import-preview-confirm, execute an imported request, import-environment-and-resolve-a-variable, Postman export, native export/reset/restore, OpenAPI import, invalid-file recovery, partial-import warnings) — plus the full Milestone 2 (14), Milestone 3 (11), Milestone 4 (9), and Milestone 5 (11) regression suites, unmodified in intent, still passing.

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
