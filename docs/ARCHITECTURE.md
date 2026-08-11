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

**Known limitation carried forward**: `@monaco-editor/react` (used for the raw-body JSON editor) defaults to loading Monaco's assets from a CDN (jsdelivr) at runtime rather than the bundled npm package — inconsistent with the zero-install/self-contained goal and an unreviewed third-party runtime dependency. Flagged in code (`apps/web/src/components/request/BodyPanel.tsx`) as a fix-before-relying-on-it item: self-host the Monaco assets and point the loader locally. Still open as of Milestone 2.

### As built — Milestone 2

`packages/request-engine` now exists — the first real engine package, pure TypeScript with no DOM/React runtime dependency beyond `fetch`/`Headers`/`AbortController` type surfaces (typed via TS's `DOM` lib, no actual browser runtime coupling). Exposes:

- `buildUrl` / `buildHeaders` / `buildBody` / `buildRequest` — pure functions turning a `KeyValueRow[]`-based request config into a real `{ url, method, headers, body }`. Never overrides a user-set header (e.g. a user-set `Content-Type` beats the one implied by the chosen body format).
- `validateUrl` / `validateJsonBody` — pre-send validation (empty/malformed/unsupported-protocol URL; invalid JSON body), run before anything is sent.
- `RequestExecutor` interface + `BrowserFetchExecutor` — the only implementation this milestone; sends real requests via native `fetch`, supports `AbortSignal` cancellation, and converts thrown errors (network failure, CORS rejection, abort) into a normalized, friendly result rather than letting them propagate as exceptions.
- `normalizeResponse` — turns a raw `Response` into `ApiResponseResult` (status, headers, body, rawBody, duration, size, bodyKind). Classifies body content (`json`/`text`/`html`/`empty`) but never executes or renders it — HTML is always shown as text, everywhere in the UI.

`apps/web`'s `useAppStore` gained per-tab `requestStatus`/`responses`/`sendErrors`/`abortControllers` state and a `sendRequest`/`cancelRequest`/`resetRequest` action set that orchestrates the engine: validate → build → execute → normalize → store. The response viewer (`components/response/*`) reuses the same Monaco instance pattern as the request body editor (read-only, for the Pretty JSON view) rather than introducing a second rendering approach.

**Transport abstraction, not just an implementation**: `RequestExecutor` is deliberately an interface, not a hardcoded `fetch()` call in the store. `MockExecutor` (Milestone 9) and `PerformanceExecutor` (Milestone 10) implement the same interface later without the store's `sendRequest` orchestration changing.

**New known limitations**:
- **CORS**: API Lab is browser-only in Milestone 2 — a real external API that doesn't send permissive CORS headers will reject the browser's request, and the browser's `fetch()` reports this identically to a plain network failure (no way to distinguish "CORS rejected" from "DNS failed" from "connection refused" — this is a deliberate browser security restriction, not something JavaScript can introspect). The error message reflects this ambiguity honestly rather than guessing. `docs/ROADMAP.md`'s planned `ServerExecutor` (a controlled execution layer) is the architectural answer, not something this milestone works around.
- **Response size** is exact only when the server sends a `Content-Length` header; otherwise it's the decoded body's byte length, which will not match compressed/chunked wire size. `ApiResponseResult.sizeSource` states which case applies rather than presenting a single number as always-exact.
- **Cookies**: the response viewer's Cookies tab is a structural placeholder, not wired up — browsers don't expose `Set-Cookie` response header values to JavaScript for security reasons, so this needs its own design before Milestone 2's UI-parity claim would be accurate; deferred rather than faked.

### As built — Milestone 3

`packages/workspace-engine` now exists, holding the collections/folders/requests domain model and its CRUD. It is **deliberately not** the target tree's `packages/collection-format` — `collection-format` is reserved for Postman/OpenAPI import-export interop (Milestone 6), a different concern from internal CRUD and native persistence. `workspace-engine` owns:

- **Domain model**: `Workspace → Collection[] → CollectionItem[]` where `CollectionItem = SavedRequest | Folder`, and `Folder.items` holds only `SavedRequest[]` — folders are one level deep by design, per the milestone's own permission to keep the UI simple rather than build arbitrary nesting no one asked for yet. Every entity has a stable, non-regenerating ID (`createWorkspaceId`), so renames/moves/edits never silently fork identity.
- **Pure, immutable CRUD**: every operation (`createCollection`, `renameFolder`, `moveRequest`, `moveItemUp`, …) takes a `Workspace` and returns a new one; nothing is mutated in place. This keeps the store's `set()` calls trivial and makes the CRUD layer trivially unit-testable without any DOM or store dependency.
- **Zod-validated versioned serialization**: `serializeWorkspace`/`deserializeWorkspace` wrap the domain model in `{ version, workspace }`. `deserializeWorkspace` never throws — malformed JSON, wrong envelope shape, an unrecognized future `version`, or a structurally invalid workspace all resolve to a typed `{ ok: false, reason, detail }` result instead of an exception, so a corrupt or foreign `localStorage` value can never crash app startup.

**Saved Request vs. Open Tab.** `RequestTabState` (in `apps/web`) gained three optional fields — `savedRequestId`, `savedLocation`, `savedSnapshot` — that link a tab to a `workspace-engine` `SavedRequest` without merging the two concepts. A tab with none of these set is a scratch, never-saved request; Save opens a small Collection → Folder → Name dialog for it. A tab with all three set is "linked": Save updates the existing saved request in place (one click, no dialog), and dirtiness is computed — never stored reactively — by diffing the tab's live config against `savedSnapshot` (`isTabDirty` in `apps/web/src/lib/requestConfig.ts`). **Opening an already-open saved request activates its existing tab** rather than creating a second editing session on the same underlying request — the alternative (silently allowing two tabs to diverge against one saved request) would make "which edit wins on Save" ambiguous, which is worse than just switching to the existing tab.

**Store split.** `useAppStore` now has two state families with different responsibilities: `workspace` (collections/folders/saved requests — the persistent, must-be-correct data) and `tabs`/`activeTabId`/request-execution state (the M1/M2 tab and HTTP-execution state, unchanged in shape). They're still one Zustand store, not two — the coupling between "open a saved request" and "create/update a tab" is inherent to the feature, and splitting the store itself would just move that coupling into extra glue code without buying independence either side actually needs.

**Two-tier persistence.** `apps/web/src/lib/persistence.ts` treats the two state families differently, matching their actual risk profiles: the workspace is written to `localStorage["api-lab-workspace"]` as a versioned, Zod-validated envelope (`WORKSPACE_FORMAT_VERSION = 1`) — data the user would be upset to lose, so it's read back through full schema validation and a load failure surfaces a **"Reset Local Workspace"** recovery banner rather than silently discarding it. Tabs/session UI state go to `localStorage["api-lab-tabs"]` with only minimal shape validation (`isPersistedTabsBlob`) — losing an open-tab layout on a corrupt value just means falling back to one fresh tab, not a data-loss event worth interrupting the user over. Both writes are debounced 400ms (`lib/debounce.ts`) via a `useAppStore.subscribe()` listener, so rapid typing in the URL/body editors doesn't hit `localStorage` on every keystroke.

**Recovery, not silent data loss.** If `loadWorkspaceFromStorage()` returns an error (malformed JSON, invalid schema, or an unsupported future version), the workspace starts as empty and `workspaceLoadError` is set; the sidebar shows the corrupt payload's detail and a "Reset Local Workspace" button, and — critically — the (still present but unreadable) `localStorage` value is left untouched (the persistence subscriber skips writes while `workspaceLoadError` is set) until the user explicitly confirms the reset via a native `confirm()`. This means a corrupt value is always recoverable by hand (e.g. via devtools) even if the user never clicks Reset.

**Why localStorage over IndexedDB.** The target architecture (§2, "Explicitly deferred") left this as a Milestone 3 decision. `localStorage` was chosen because the workspace is small (collections of requests, not response bodies or binary attachments), synchronous access keeps the debounce/subscribe pattern simple, and the two-tier strict/best-effort validation strategy above already covers the corruption-handling need that IndexedDB's transactional guarantees would otherwise be solving. If a future milestone (e.g. large offline response caching, or binary body storage) needs more headroom than `localStorage`'s ~5-10MB origin quota, that's a concrete, revisit-able trigger — not something to build against speculatively now.

**UI.** The collections sidebar (`apps/web/src/components/collections/*`) now drives real CRUD: `CollectionSidebar` (create-collection, empty state, the recovery banner), `CollectionItem`/`FolderItem`/`RequestItem` (rename/delete/reorder via native `prompt`/`confirm`, new-folder/new-request, duplicate, per-item empty states), and `SaveRequestDialog` (the one genuinely multi-field dialog, used only for first-time saves). `RequestTabs` gained a dirty (`*`) indicator and a close-tab `confirm()` guard so an unsaved edit is never discarded silently. `RequestBar` gained a `Save` button that either updates a linked request in place or opens the Save dialog.

### As built — Milestone 4

`packages/environment-engine` now exists at exactly the location the target tree (§1) already reserved for it. It owns three things: the environment/variable domain model and CRUD, the variable resolver, and environment persistence — deliberately not request execution (still `request-engine`'s job) or auth (Milestone 5's `auth-engine`).

- **Domain model**: `Environment { id, name, variables: Variable[] }`, `Variable { id, key, value, enabled, secret }`, `EnvironmentWorkspace { environments: Environment[], activeEnvironmentId: string | null }`. CRUD (`createEnvironment`, `renameEnvironment`, `deleteEnvironment`, `duplicateEnvironment`, `setActiveEnvironment`, `addVariable`/`updateVariable`/`removeVariable`) is pure and immutable, mirroring `workspace-engine`'s pattern exactly — every function takes a workspace and returns a new one. Deleting the active environment resets `activeEnvironmentId` to `null` rather than leaving a dangling reference; duplicating an environment gives every variable a new ID so editing the copy can never mutate the original.

- **Resolver** (`resolver.ts`): `resolveVariables(input, context)` is a pure function with no dependency on the environment/workspace types — it operates on a plain `Record<string, string>` context, so any future scope (Local/Collection/Global) plugs in by contributing to that flat object before resolution, not by changing the resolver. Syntax is strictly `{{name}}` (`name` matching `[A-Za-z_][A-Za-z0-9_]*`); malformed or near-miss syntax (`{{`, `{{invalid`, `{{ spaced }}`) is left untouched rather than guessed at. **Unknown variables** are never silently replaced with an empty string — they're collected into `unresolvedVariables` and the original `{{name}}` text is left in place, so a caller (the store's `sendRequest`) can block the request with a specific, named error instead of silently sending a broken URL. **Circular references** (`a = {{b}}`, `b = {{a}}`, including direct self-reference) are detected via a per-resolution `visited` set threaded through recursive expansion — the moment a name would be revisited, expansion stops and `hasCircularReference` is set, rather than recursing forever. A `MAX_RESOLUTION_DEPTH` (20) is a separate safety net for long non-cyclic chains, so even a pathological (but not strictly circular) chain can't hang the browser.

- **Scope precedence (documented, not fully implemented)**: only the **Environment** scope is implemented this milestone — matching the milestone's own instruction to build the minimum sound foundation rather than every scope speculatively. The documented future precedence, highest to lowest, is:

  ```text
  Local (per-request override)
       ↓
  Collection (Milestone 3's collections)
       ↓
  Environment (this milestone)
       ↓
  Global (workspace-wide defaults)
  ```

  This order matches conventional API-client precedence (more specific wins) and was chosen — not assumed — because it's the only order under which "override just this one request" and "override just this one collection" behave the way a user would expect. Adding a scope later means building its own small CRUD module (same pattern as `environment.ts`) and merging its variables into the resolver's context object in the right order; the resolver itself needs no change, because it was built scope-agnostic from the start.

- **Secret handling**: `Variable.secret` is a UI/behavior flag, not encryption. `buildVariableContext` builds the real resolution context (used only at send time); `buildDisplayVariableContext` builds a parallel context where every secret variable's value is replaced with a fixed mask *before* it ever reaches the resolver — so the resolved-URL preview (`RequestBar`) can show accurate URL *structure* without ever holding, let alone rendering, the real secret value, even transiently. The variable editor masks secret values as a password-style input by default, with a per-row show/hide toggle (revealing one secret doesn't reveal every secret in the environment). See `docs/SECURITY.md` for the full secret-handling and localStorage-limitation writeup.

- **Prototype-pollution hardening**: because a variable's `key` is arbitrary user-entered text, `buildVariableContext`/`buildDisplayVariableContext` build their context objects via `Object.create(null)` rather than `{}` — so a variable literally named `__proto__` or `constructor` becomes an ordinary own property, never an inherited accessor that could otherwise cause a crash (`{{__proto__}}` reading `Object.prototype` and passing a non-string into `.replace`) or, in a differently-written resolver, pollution. The resolver additionally checks membership with `Object.hasOwn` rather than the `in` operator, so this protection holds even if a caller passes a context object that *isn't* null-prototype. Covered by explicit regression tests in `resolver.test.ts`.

- **Request-engine integration**: `resolveRequestConfig(config, context)` (in `requestResolver.ts`) resolves a `{url, params, headers, bodyRawContent}` shape — deliberately duck-typed against `@api-lab/shared`'s `KeyValueRow`, not against a `request-engine` or `workspace-engine` type, so `environment-engine` has zero dependency on either. `useAppStore.sendRequest` calls it before `buildRequest`: resolve → check for unresolved/circular → validate the *resolved* URL/body → build → execute. `request-engine` itself is untouched — it still just receives a fully-resolved config and has no awareness that variables exist, matching the milestone's explicit boundary requirement. **The saved/tab request config is never mutated by resolution** — `tab.url` stays `{{baseUrl}}/users` after a send; only a local, ephemeral `resolved` copy is built per send.

- **Persistence — a dedicated versioned boundary, not reused from the workspace envelope.** Environments are stored under `localStorage["api-lab-environments"]` as their own `{version, data}` envelope (`ENVIRONMENT_FORMAT_VERSION = 1`), separate from `api-lab-workspace`. This was a deliberate choice (the milestone spec explicitly asked for one): environments are a sibling concept to collections, not nested inside them; they carry secret values that deserve their own documented storage story; and they may evolve on a different schema timeline (e.g. adding scopes) than collections do — coupling the two migration paths would make either one harder to change safely later. Corrupt/invalid/unsupported-version data is handled exactly like the workspace's: `environmentsLoadError` is set, the (still-present) bad value is left untouched until the user explicitly confirms via the Environment Manager's "Reset Local Environments" banner, and the app never crashes on startup because of it.

- **UI**: `TopBar`'s environment `<select>` replaces the Milestone 1/2 static placeholder — it lists real environments plus "No Environment" and a "Manage Environments…" entry. `components/environments/EnvironmentManager.tsx` is a focused two-pane dialog (environment list with create/rename/duplicate/delete on the left, a `VariableEditor` table on the right) — deliberately not a general settings screen, per the milestone's own "keep it simple" instruction. Switching environments only changes `activeEnvironmentId`; it never touches saved request data.

### As built — Milestone 5

`packages/auth-engine` now exists, added to the target tree (§1) at the location already reserved for it. It owns the auth configuration model, pre-send validation, and header/query-param generation — deliberately not variable resolution (still `environment-engine`'s job) or request execution (`request-engine`'s).

- **Domain model**: `AuthConfig` is a discriminated union — `{type:"none"} | {type:"apiKey", key, value, addTo} | {type:"basic", username, password} | {type:"bearer", token} | {type:"jwt", token} | {type:"oauth2"}` — serializable, and deliberately not one generic "auth fields" bag, so each variant only carries the fields it actually needs and TypeScript can exhaustively check every switch over `auth.type`. `createDefaultAuthConfig(type)` gives a clean, empty config when the user switches types in the UI.

- **Validation** (`validateAuthConfig`): mirrors `request-engine`'s `validateUrl`/`validateJsonBody` pattern exactly — a typed `{field: "auth", message}` result instead of a throw. API Key requires both a non-empty key name and value; Basic requires both username and password; Bearer/JWT require a non-empty token; `oauth2` is **always** invalid to send, with the message explicitly stating OAuth 2.0 is planned but not implemented — an honest block, not a silently-broken request.

- **Application** (`applyAuth`): pure, given an already-resolved `AuthConfig` and the request's current headers/params, returns new headers/params with the auth-generated header or query param merged in. **Precedence rule (documented and tested)**: an auth-generated header/param always wins over a manually entered one with the same name — the manual entry is dropped rather than sent as a conflicting duplicate. Header name comparison is case-insensitive (matching HTTP semantics); query-param key comparison is exact. This was chosen over "manual wins" because a user who explicitly configures an auth type is very unlikely to also want a stray manually typed `Authorization` header silently overriding it with no error shown anywhere — "auth wins" makes the configured credential's effect predictable and matches conventional API-client behavior. Basic auth's `Authorization: Basic <base64>` uses `btoa(unescape(encodeURIComponent(...)))`, the standard workaround for encoding non-Latin1 credentials with `btoa` (available as a global in both browsers and Node 18+, so no platform-specific branch or `Buffer` dependency is needed).

- **Variable integration — composed at the app layer, not inside either engine.** Auth field values (API key value, username/password, bearer/JWT token) can reference `{{variables}}` exactly like the URL/headers/body. Rather than making `auth-engine` depend on `environment-engine` (or vice versa), the composition lives in `apps/web/src/lib/authResolve.ts`: a small `resolveAuthConfig(auth, context)` that calls environment-engine's `resolveVariables` per string field and returns a resolved `AuthConfig` plus the same `unresolvedVariables`/`hasCircularReference` shape the URL/body resolution already produces. This keeps `auth-engine` testable with plain strings and no environment concept, and keeps `environment-engine` with no concept of what an `AuthConfig` even is — each engine's tests need to know about only its own domain.

- **Request-engine integration and boundary**: `useAppStore.sendRequest`'s order is now variables → auth: resolve URL/params/headers/body variables → resolve auth field variables → validate the resolved auth config → `applyAuth` (merge auth-generated headers/params over the resolved ones) → validate the resolved URL → validate the resolved body → `buildRequest` → execute. `request-engine` itself is completely untouched by this milestone — it still just receives a final `{headers, params}` and has no idea whether a given header came from the user typing it, an auth config, or (in a future milestone) a script. The saved/tab request config is never mutated by any of this — `tab.auth` still holds `{{token}}`, not the resolved value, after a send.

- **Backward compatibility**: `RequestConfig.auth` replaces Milestones 2–4's `authType: AuthType` field, which was purely cosmetic (the Auth panel was an explicit non-functional placeholder until this milestone — no real credential was ever built from it). `workspace-engine`'s `requestConfigSchema` makes `auth` `.default({type:"none"})`; zod strips the now-unrecognized legacy `authType` key rather than rejecting it. Since no real credentials ever existed under the old field, "No Auth" is the only safe reconstruction — attempting to guess a real config from the old enum value would be actively misleading. Verified by an explicit regression test in `workspace-engine/src/serialize.test.ts` that loads a hand-constructed pre-Milestone-5 payload and asserts it still parses, with `auth` defaulting correctly.

- **UI**: `AuthPanel` gained real per-type fields (API Key: key/value/add-to; Basic: username/password; Bearer/JWT: token), a single Show/Hide values toggle per panel (fields render as `type="password"` by default), and a hint that fields accept `{{variables}}` and that this configuration overrides a same-named manual header. Selecting OAuth 2.0 shows the honest placeholder text and does not present a fake "connect" button or any other non-functional control.

#### OAuth 2.0 — architecture, not implementation

OAuth 2.0 is **deliberately not implemented** this milestone. `{type: "oauth2"}` exists in the type system as a reserved, non-executable variant — `validateAuthConfig` always blocks it from being sent — so the UI can honestly list it as a type without pretending it works. This is not a placeholder oversight; it's the milestone spec's own explicit instruction ("do not implement a fake OAuth flow... OAuth should receive its own dedicated milestone if necessary"), and here is why a same-milestone implementation would be premature:

- **Browser flow requirements**: a real OAuth 2.0 Authorization Code flow needs either a popup window or a full-page redirect to the authorization server, a registered redirect URI that API Lab controls, and — for a public client with no backend — Authorization Code **+ PKCE** specifically, since a pure-browser app cannot keep a client secret confidential (anything shipped to the browser is readable by the user). Client Credentials and Device Authorization are meant for machine/headless or input-constrained clients respectively, not a use-you're-testing-APIs-in-a-browser-tab tool, and would need their own UX story.
- **Redirect URI**: API Lab would need a stable, documented callback route (e.g. `/oauth/callback`) that every configured OAuth provider must be told to trust — a concrete piece of product surface (routing, a redirect page, state validation to prevent CSRF on the callback) that doesn't exist yet and shouldn't be bolted on as a side effect of this milestone's header-generation work.
- **Token storage**: an access token (and, worse, a refresh token) obtained this way is exactly the kind of secret `docs/SECURITY.md` already documents localStorage's limitations for — storing it there is the same non-negotiable tradeoff as any other environment secret, and must be documented as such rather than implied to be safe, whenever it's implemented.
- **Refresh-token handling**: token refresh needs its own state machine (detect 401/expiry, refresh silently, retry once, surface a re-auth prompt on refresh failure) — a real feature, not a corner of `applyAuth`.
- **CORS/browser limitations**: token endpoints must support CORS for a pure-browser exchange to work at all; many real-world OAuth providers don't allow this for public clients, which is a hard external constraint API Lab can't work around from the browser alone — this is exactly the kind of gap `docs/ROADMAP.md`'s future `ServerExecutor` concept (see Milestone 2's CORS note) would exist to solve.
- **Never invent an insecure shortcut**: a client-secret-in-the-browser flow, or storing a long-lived token without documenting the plaintext-localStorage tradeoff, would be a deliberate security regression to avoid a "not implemented" label — explicitly rejected by both the milestone spec and `docs/SECURITY.md`.

When OAuth 2.0 is implemented, it will need its own milestone covering: the popup/redirect UX decision, the callback route and CSRF-safe state handling, PKCE code-verifier generation and storage, the refresh-token state machine, and an explicit `docs/SECURITY.md` update — not an extension of `auth-engine`'s current `applyAuth`.

#### Documented future auth model (not implemented)

Auth inheritance — `Collection Auth → Folder Auth → Request Auth`, where a more specific level overrides a less specific one, exactly mirroring the variable-scope precedence pattern from Milestone 4 — is a natural extension once there's real user demand for "set auth once per collection." It isn't implemented now because `workspace-engine`'s `Collection`/`Folder` types have no `auth` field yet, and adding one speculatively (with no UI, no resolution logic) would be exactly the "unnecessary complexity to satisfy a theoretical future requirement" the milestone spec explicitly warns against. The path to add it later is small: an optional `auth?: AuthConfig` field on `Collection`/`Folder`, and a resolution step in the store (`request auth if not "none", else folder auth if not "none", else collection auth`) before the existing `resolveAuthConfig`/`applyAuth` call — no change to `auth-engine` itself.

### As built — Milestone 6

`packages/collection-format` now exists, at the location the target tree (§1) already reserved for it, with the exact `postman/`, `openapi/`, `native/` sub-module split the milestone spec suggested. It owns interoperability with external formats — parsing, validation, and translation to/from API Lab's domain model — and deliberately nothing about how the app applies an import to the live workspace (that's app-layer orchestration, described below).

**The normalized import boundary.** Every parser/adapter, regardless of source format, produces the same `NormalizedImport` union (`NormalizedCollectionImport | NormalizedEnvironmentImport | NormalizedWorkspaceImport`). Critically, `NormalizedRequest.request` is `workspace-engine`'s real `RequestConfig` — not a fourth, format-specific request shape — so every adapter's actual job is "produce a value that would already be valid saved-request data," and the app's import-preview/confirm UI, store actions, and persistence layer never need special-casing per source format. `parseImportFile(text)` (`importFile.ts`) is the single entry point the UI calls: detect → parse → adapt, wrapped in a try/catch that turns even a pathological-recursion `RangeError` into an ordinary typed failure (see Security below). Adding a future format (Insomnia, HAR, curl) means one more `detectFormat` branch and one more parser/adapter pair — no change to the UI or to `workspace-engine`.

**Format detection is structural, never extension-based** (`detect.ts`): API Lab's native envelope (`format: "api-lab"`), OpenAPI's required `openapi: "3.x"` field, Postman Collection's `info.schema`/`info._postman_id` + `item[]` combination, and Postman Environment's `values[]` (specifically *without* an `item[]`, which would make it a collection instead) are checked in order of specificity. A file that matches none of these returns `"unknown"` rather than guessing.

**Postman Collection import** (`postman/`): validated against a zod schema that is strict at the top level (`info.name`, `item[]` are required) but deliberately loose at the leaves (auth/body variant fields use `.passthrough()`/`z.unknown()`) — modeling every documented Postman auth or body variant exhaustively was explicitly out of scope; the adapter reads only what it knows how to map and warns on the rest. Concrete, tested mapping decisions:
- **Nested folders**: Postman folders nest arbitrarily; API Lab folders are one level deep (Milestone 3). A sub-folder found while flattening a folder's contents has its requests flattened into the parent, with an explicit per-folder warning — never silently dropped, never a crash on deep recursion (bounded by the try/catch described below regardless).
- **Body modes**: `raw` maps directly (language → `BodyRawFormat`); `urlencoded`/`formdata` are preserved as readable `key=value` text with a warning that sending them isn't executable yet (Milestone 2's own deferred capability) — never silently discarded, never claimed to work.
- **Auth**: `noauth`→none, `apikey`/`basic`/`bearer` map directly to `auth-engine`'s `AuthConfig`; anything else (`oauth2`, `digest`, `hawk`, `aws`, `ntlm`, …) imports as No Auth with a named warning — never a fabricated equivalent.
- **Scripts**: counted for the warning message only — the script text itself is never read into any field of the imported `RequestConfig`, never `eval`'d, never passed to `new Function`. There is no code path by which an imported script could execute.

**Postman Environment import**: `values[].type === "secret"` maps to API Lab's `Variable.secret` flag — the closest existing concept — `enabled` and `value` map directly.

**OpenAPI 3.0.x/3.1.x import** (`openapi/`): operations are grouped into folders by their first `tags[]` entry (untagged operations stay at the collection root). **Path parameters become `{{variable}}` syntax** (`/users/{id}` → `/users/{{id}}`) — a deliberate, narrow mapping, applied *only* to path parameters and never to query/header parameters, because a path parameter shares the "must have a value before the URL is even well-formed" property that API Lab variables have, while a query/header parameter doesn't; those instead become ordinary (initially empty) `KeyValueRow`s. JSON request bodies are populated from `example`/`examples` when present; other content types are preserved-as-unattempted with a warning rather than guessed at. `apiKey`/`http bearer`/`http basic` security schemes map to the matching `AuthConfig` variant (with a `{{token}}`/`{{apiKey}}`/`{{username}}`+`{{password}}` placeholder, since OpenAPI security schemes never carry an actual credential); `oauth2`/`openIdConnect` warn and import as No Auth, matching the Postman policy exactly. YAML OpenAPI documents are not supported this milestone — only JSON — since every fixture, test, and the UI's file picker currently assume `JSON.parse`; adding a YAML parser is a small, isolated addition to `openapi/parse.ts` when needed, not a boundary change.

**Postman Collection export** (`postman/exportAdapter.ts`) and the **native workspace export** (`native/export.ts`, `{format:"api-lab", version:1, workspace, environments}`) are both pure functions over already-in-memory domain data — no React/Zustand state, no `AbortController`s, no response history ever enters an export, because the exporters only ever look at `workspace-engine`/`environment-engine` types, which structurally can't contain that state. Both are deterministic: the same collection/workspace always serializes to byte-identical JSON (no timestamps or random IDs are added by the export step itself). Both are round-trip tested: export → the package's own importer → compare.

**Import UX**: `ImportDialog` (`apps/web/src/components/importExport/`) implements the mandatory preview step — `pick file → parse → preview (name, folder/request or variable counts, every warning) → explicit Import click`. The workspace is never touched before that click. **Collision handling**: `applyCollectionImport`/`applyEnvironmentImport` (`apps/web/src/lib/importExport.ts`) check the current workspace for a name collision and append `" (Imported)"` (then `" (Imported 2)"`, …) rather than overwriting — a deliberately simple, always-non-destructive default, per the milestone's own "choose a simple safe UX" guidance, in place of a three-way Replace/Copy/Cancel prompt. New stable IDs are always assigned on import (via the same `wsCreateCollection`/`wsCreateFolder`/`wsCreateRequest` primitives collections already use internally) — external IDs are never reused as API Lab identity, including on a native re-import, which is treated as "restore a copy," not "resurrect the exact same objects."

**Security — imported files are treated as hostile input by construction, not by convention**: a 5MB size check runs before `JSON.parse` even executes; every external shape is validated through zod before any adapter touches it; `parseImportFile`'s top-level try/catch converts a pathological-recursion `RangeError` (a deeply nested-but-under-the-size-limit document could otherwise exhaust the call stack) into an ordinary typed failure instead of an uncaught exception — verified by a dedicated regression test using a 50,000-level-deep fixture built as a raw string (not a JS object graph, so the test itself doesn't hit the same limit). Imported scripts are counted, never read into any executable path. No `eval`, `new Function`, or `dangerouslySetInnerHTML` appears anywhere in `collection-format` or the import/export UI. See `docs/SECURITY.md` for the full write-up.

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

1. ~~Persistence layer for collections/environments~~ — resolved in Milestone 3: `localStorage`, versioned/Zod-validated envelope, two-tier strict/best-effort strategy. See "As built — Milestone 3" above. Revisit only if a future milestone needs storage headroom `localStorage`'s quota can't cover.
2. OAuth 2.0 token flow implementation (popup/redirect, token storage strategy) — deliberately deferred past Milestone 5; requirements documented in "As built — Milestone 5" above and in `docs/SECURITY.md`. Needs its own milestone (callback route, CSRF-safe state, PKCE, refresh-token state machine) before implementation starts.
3. Script sandbox mechanism (Web Worker + restricted global scope vs. a WASM-based sandbox vs. an iframe-based isolate) — must be resolved before Milestone 7 begins, documented in `SECURITY.md`.
4. Performance worker execution model (browser-based vs. Node-based load generation) — Milestone 10.
5. Whether `collection-format`, once stable, should be published as a standalone npm package for external interoperability — deferred until there's real external demand, not decided speculatively now.
6. ~~Whether Environments need their own persisted state slice alongside `workspace`~~ — resolved in Milestone 4: yes, a dedicated versioned `localStorage["api-lab-environments"]` boundary, separate from the workspace envelope. See "As built — Milestone 4" above.
7. Whether/when to implement Local, Collection, and Global variable scopes beyond Environment — documented precedence exists (see "As built — Milestone 4"); implement the next scope only when a concrete milestone need identifies which one first.
8. Auth inheritance (Collection → Folder → Request) — documented future model in "As built — Milestone 5" above; not implemented (no `auth` field on `Collection`/`Folder` yet). Implement when there's real demand for "set auth once per collection."
9. ~~Whether `collection-format` should live at the target-architecture location~~ — resolved in Milestone 6: yes, built exactly at the `packages/collection-format` location §1 already reserved, with the `postman/`/`openapi/`/`native/` split. See "As built — Milestone 6" above.
10. OpenAPI YAML import — deferred; JSON only in Milestone 6 (see "As built — Milestone 6"). Add a YAML parser to `openapi/parse.ts` when a concrete need arises; no boundary change required.
