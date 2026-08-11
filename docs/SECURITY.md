# API Lab — Security Model

API Lab's most significant security surface is that it will eventually execute **user-authored JavaScript** (pre-request and post-response scripts) and make **arbitrary outbound HTTP requests** to endpoints the user configures. Both are normal, necessary features of an API client — and both are exactly the kind of capability that has to be designed securely *before* it's built, not hardened afterward. This document is that design.

**Status as of Milestone 7**: script execution is **not implemented**. Milestone 7 (API Testing Engine) evaluated implementing it and explicitly deferred, per its own instruction that "if a fully safe user-script runtime cannot be implemented confidently in this milestone, implement the assertion engine and runner first, and explicitly defer script execution rather than introducing an unsafe mechanism." This document's Script Execution Sandbox section below remains the requirements a future dedicated milestone must satisfy before `script-engine` is built — it is a design-ahead-of-implementation document, not a description of something already running.

## Threat Model Summary

| Surface | Risk if unaddressed |
|---|---|
| User-authored scripts | Arbitrary code execution in the app's context; access to other collections' data, stored credentials, or the DOM. **Not yet a live risk** — script execution is not implemented (Milestone 7 deferred it); this row stays as a design requirement for when it is. |
| User-configured request targets | Server-Side Request Forgery if any part of API Lab runs server-side and blindly proxies a user-supplied URL |
| Response rendering | Stored/reflected XSS if a response body is rendered as HTML/executed rather than displayed as inert text |
| Imported collections (Postman/OpenAPI) | Malicious or malformed import data used as an injection vector into the app's own state or storage |
| Object merging (imports, variable interpolation, script output) | Prototype pollution via crafted keys (`__proto__`, `constructor.prototype`) |
| Stored credentials (API keys, tokens, OAuth secrets) | Exposure via scripts, exports, logs, or insecure storage |

## Script Execution Sandbox

**Principle**: no user-authored script executes in the same JavaScript context as the main application. This is non-negotiable — `script-engine` is architected around isolation from day one, not retrofitted.

**Current state (post-Milestone 7)**: `tab.preRequestScript`/`tab.postResponseScript` are a plain-text editing surface only. No code path reads them during request execution — `apps/web/src/lib/executeRequest.ts`'s `executeRequestConfig` (the single pipeline both the Send button and the Collection Runner use) never references either field. This was verified directly: an E2E test types a script designed to prove execution (`console.log("SCRIPT_SHOULD_NOT_RUN")`, `document.title = "hacked"`) and confirms neither effect occurs after Send. There is currently no `script-engine` package and no sandbox — because there is nothing to sandbox yet.

Requirements for the sandbox, to be finalized as a concrete implementation decision when a future milestone takes on script execution:

- **Isolation**: the script runs in a context (Web Worker, iframe-based isolate, or WASM sandbox — see `ARCHITECTURE.md` Open Question 3) with no direct reference to `apps/web`'s state, DOM, or `window`.
- **Explicit API surface only**: a script can read/write environment variables and inspect the current request/response through a deliberately narrow, documented API — never through ambient access to the app's internals.
- **No credential access by default**: a script cannot read a stored secret (API key, token, OAuth credential) directly. If a script needs to reference a variable that happens to hold a secret, it goes through the same interpolation mechanism as any other variable, not a privileged read path.
- **Timeout limits**: a script that doesn't complete within a defined time budget is terminated. Exact budget is a Milestone 7 implementation decision; it must be enforced by the sandbox host, not by convention in the script's own code.
- **Memory limits**: the sandbox enforces a memory ceiling; exceeding it terminates the script rather than degrading the host application.
- **Network restrictions**: scripts cannot make their own arbitrary network calls independent of the request/response they're attached to — they operate on data already fetched through `request-engine`, not as a general-purpose fetch-capable runtime.
- **Storage restrictions**: scripts cannot read or write browser storage (localStorage, IndexedDB, cookies) directly — only through the same variable API used for everything else.
- **DOM isolation**: no access to `document`, `window`, or any DOM API.

## SSRF Prevention

Two components make outbound requests on the user's behalf: `apps/mock-server` and `apps/performance-worker`. Both must treat any user-supplied URL as untrusted input:

- Validate and normalize target URLs before use; reject obviously malformed or non-HTTP(S) schemes.
- Where a service runs server-side with any privileged network position (e.g., inside a container with access to internal/metadata endpoints), block requests to private/link-local address ranges and cloud metadata endpoints (e.g., `169.254.169.254`) by default.
- The mock server itself never forwards to an external host as a side effect of a mock definition — mocks are self-contained, deterministic responses, not transparent proxies.

## XSS Prevention

- Response bodies are rendered as inert text/syntax-highlighted content (via Monaco or an equivalent read-only viewer), never injected as live HTML or executed.
- Any place the app renders user- or server-supplied content (response bodies, imported collection names/descriptions, mock definitions) uses React's default escaping — no `dangerouslySetInnerHTML` without a specific, documented, reviewed justification.

## Prototype Pollution Prevention

- Any code that merges external/untrusted objects (collection import, environment variable resolution, script return values) uses safe merge utilities that reject or strip dangerous keys (`__proto__`, `constructor`, `prototype`), or uses `Object.create(null)` / `Map` for untrusted key-value data instead of plain object literals where practical.
- Zod schemas validate imported data's shape before it's merged into application state at all — malformed or unexpected keys are rejected at the boundary, not silently absorbed.
- **Implemented (Milestone 4)**: `environment-engine`'s variable-resolution context is the first concrete case of untrusted, user-defined keys (a variable's `key` field) reaching a plain-object lookup. `buildVariableContext`/`buildDisplayVariableContext` build that context with `Object.create(null)`, and the resolver checks membership with `Object.hasOwn` rather than `in` — see `docs/ARCHITECTURE.md`'s Milestone 4 section and `resolver.test.ts`'s `__proto__`/`constructor` regression tests.

## Environment Variables & Secrets (Milestone 4)

Environment variables — including those flagged `secret` — are resolved and stored the same way as any other API Lab data, with the limitations that implies:

- **`secret` is a UI/behavior flag, not encryption.** A secret variable's value is stored in `localStorage["api-lab-environments"]` in plaintext, exactly like a non-secret variable. `secret: true` controls masking in the app's own UI (password-style input, per-row show/hide, always-masked in the resolved-URL preview) — it does **not** protect the value from another script or browser extension with access to this origin's storage, from someone with access to the browser profile/disk, or from browser devtools. This must never be described as "encrypted" or "secure storage" anywhere in the app or its documentation.
- **Never logged.** No code path passes a resolved variable value (secret or not) to `console.log`/`console.error`/`console.warn`. Validation and send errors reference variable *names* only (e.g. `"Unresolved variable: token"`), never values.
- **Masked in previews.** `buildDisplayVariableContext` substitutes a fixed mask for every secret variable's value *before* that value ever reaches the resolver used for the UI's resolved-URL preview — the real value is never held anywhere in that code path, not even transiently, let alone rendered.
- **Not sent to the resolved-URL preview's underlying string except as a mask.** The only place a secret's real value is ever read is at actual send time, immediately before `buildRequest` — the same point any other variable is resolved.
- **Treated as opaque string data, never executed.** The resolver (`resolveVariables`) does pure string substitution — no `eval`, no `new Function`, no template-literal evaluation of variable content. A variable value containing `<script>` or `${...}` is inserted as literal text, never interpreted.
- **Prototype-pollution resistant.** Because a variable's `key` is arbitrary user text, the resolver's context objects are built with `Object.create(null)` and checked with `Object.hasOwn` rather than `{}` and the `in` operator — so a variable named `__proto__` or `constructor` can neither crash the resolver nor reach `Object.prototype`. See `docs/ARCHITECTURE.md`'s Milestone 4 section for the specific mechanism and its regression tests.
- **Corrupt-storage recovery never silently discards secrets.** Like the workspace envelope, a corrupt/invalid `api-lab-environments` value is left untouched in storage until the user explicitly confirms "Reset Local Environments" — never overwritten automatically.

## Authentication Configuration & Credentials (Milestone 5)

Requests can now carry API Key/Basic/Bearer/JWT credentials directly (`auth-engine`'s `AuthConfig`), in addition to environment variables. The same limitations documented above for environment secrets apply identically here, plus:

- **Never logged.** No code path in `auth-engine`, `authResolve.ts`, or `useAppStore.sendRequest` passes a resolved credential (API key value, password, bearer/JWT token) or a generated `Authorization` header to `console.log`/`console.error`/`console.warn`. Validation errors reference field *names* ("Bearer token is required") never values.
- **Never in error messages.** `validateAuthConfig`'s messages describe what's missing, never echo back a partial or full credential value.
- **Masked in the UI.** `AuthPanel` renders API key value, password, and bearer/JWT token fields as `type="password"` by default, with a single Show/Hide toggle per panel — never revealed by default, never split across multiple separately-persisted "reveal" states that could leak via browser autofill/history in unexpected ways.
- **Resolved only at send time.** Auth field variable resolution (`resolveAuthConfig`) happens in the same place and at the same time as URL/header/body resolution — immediately before `buildRequest` — never earlier, never cached, never written back into the saved request.
- **Saved data always keeps the unresolved form.** A saved request's `auth.token` stays `{{token}}`; the resolved credential exists only as a local variable inside `sendRequest`'s execution, never persisted.
- **Deterministic, non-executable interpolation.** Auth field resolution reuses `environment-engine`'s `resolveVariables` — pure string substitution, the same `eval`/`new Function`-free guarantee documented above for environment variables, with the same prototype-pollution hardening (a variable named `__proto__` used inside a token field is exactly as safe as anywhere else it can appear).
- **Auth-generated headers/params are not distinguishable from manual ones after the fact** (both are just `KeyValueRow`s by the time `request-engine` sees them) — this is intentional per the milestone's own request-engine boundary requirement, and does not weaken any of the above, since the *value* going into that header was already resolved under all the same rules.

## Credential Handling

- No production credentials are ever committed to the repository (enforced by `.gitignore` and code review — see `CLAUDE.md`).
- Locally stored secrets (API keys, tokens the user enters, or environment variables flagged secret) are stored in the browser's local persistence layer (`localStorage`, plaintext — see "Environment Variables & Secrets" above for the concrete limitations), never logged, and never included in an exported collection unless the user explicitly opts in to exporting secrets (off by default, once export exists — Milestone 6).
- **OAuth 2.0 is not implemented** (see "OAuth 2.0 — Deferred, With Requirements" below). `{type: "oauth2"}` is a reserved, non-executable `AuthConfig` variant — `validateAuthConfig` always blocks it from being sent, so the UI never claims functionality that doesn't exist.

## OAuth 2.0 — Deferred, With Requirements

OAuth 2.0 support is architecturally reserved (`AuthConfig`'s `oauth2` variant, `docs/ARCHITECTURE.md`'s Milestone 5 section) but **not implemented**. This was a deliberate scope decision, not an oversight — implementing even a "minimal" flow without the below would mean either a fake/broken feature or an insecure shortcut, both explicitly disallowed. Before any OAuth implementation begins, it needs its own milestone covering:

- **Flow choice**: Authorization Code + PKCE for a pure-browser public client (never a bare Authorization Code flow with a client secret embedded in shipped frontend code — a browser app cannot keep a secret confidential). Client Credentials and Device Authorization are separate, narrower use cases that would need their own UX.
- **Redirect URI**: a dedicated, documented callback route, with CSRF-safe `state` parameter validation on return — new product surface, not a corner of `auth-engine`.
- **Token storage**: an access/refresh token obtained via OAuth is exactly as exposed in `localStorage` as any other secret documented above — this must be stated plainly in-product when implemented, never implied to be more secure because it came from an OAuth exchange.
- **Refresh handling**: silent refresh on expiry, single retry, explicit re-auth prompt on refresh failure — a real state machine, not an afterthought.
- **CORS**: the token endpoint must support CORS for a pure-browser exchange; many providers don't allow this for public clients, which is an external constraint, not something client-side code can route around (see the Milestone 2 CORS note in `docs/ARCHITECTURE.md` and the planned `ServerExecutor`).
- **No insecure shortcuts, ever**: never embed a client secret in shipped code, never skip PKCE for a public client, never store a token without documenting the plaintext-localStorage tradeoff.

## Import Validation & Untrusted External Files (Milestone 6)

Imported files (Postman Collections, Postman Environments, OpenAPI documents, API Lab native exports) are the first genuinely **untrusted, externally-authored** input this application processes — unlike environment/auth values, which the user themselves types in, an import file could come from anywhere. It's treated accordingly:

- **Size limit before parsing.** A file over 5MB (`MAX_IMPORT_FILE_SIZE_BYTES`) is rejected before `JSON.parse` is ever called on it — a large file can't even reach the parser, let alone freeze the tab.
- **Schema-validated before any adapter runs.** Every format is parsed through a Zod schema (`postmanCollectionSchema`, `postmanEnvironmentSchema`, `openApiDocumentSchema`, `nativeExportSchema`) before an adapter touches it. A structurally invalid or unrecognized shape is rejected with a clear, specific error — never partially absorbed into application state.
- **Bounded against pathological recursion.** Postman folder-flattening and OpenAPI/Postman's own recursive zod schemas walk the document's structure; a maliciously deep — but still under the 5MB limit — document could exhaust the JS call stack (`RangeError: Maximum call stack size exceeded`), which is not something `zod`'s `safeParse` catches on its own. `parseImportFile`'s top-level try/catch converts this into an ordinary typed failure result instead of an uncaught exception. Verified by a regression test using a 50,000-level-deep fixture.
- **Scripts are never executed, evaluated, or rendered.** Postman's `event[].script.exec` content is counted (for the "N scripts not imported" warning) and nowhere else — it is never assigned to any field of the resulting `RequestConfig`, never passed to `eval`, `new Function`, or any equivalent, and never reaches a DOM-rendering path. There is no code path in `collection-format` by which an imported script's text could execute.
- **No HTML/markup from an import is ever rendered as HTML.** Collection/folder/request names, descriptions, and header/body content from an import are plain strings rendered through React's default escaping — identical treatment to any other user-entered text, per the XSS Prevention section above.
- **Never `eval()`/`new Function()`/`dangerouslySetInnerHTML` for imported content**, anywhere in `collection-format` or the import/export UI — confirmed by direct code search as part of this milestone's security review.
- **Preview before commit.** No import is applied to the workspace until the user reviews a preview (name, item/variable counts, every warning) and explicitly clicks Import — an import can never silently or automatically alter existing data.
- **Non-destructive collision handling.** A name collision with an existing collection/environment gets a distinguishing suffix (`"X (Imported)"`), never a silent overwrite.
- **Export never leaks internal execution state.** `exportPostmanCollection`/`exportNativeWorkspace` are pure functions over `workspace-engine`/`environment-engine` domain types, which structurally cannot contain React state, `AbortController`s, in-flight request status, or response history — there is nothing to accidentally serialize, because the exporters never see it in the first place.

## Testing Engine — Assertions & JSONPath (Milestone 7)

Assertions and JSON-path expressions are user-authored but never executed as code — reviewed specifically for this because both look, superficially, like the kind of thing that invites a "just eval it" shortcut:

- **Closed assertion model, not an expression language.** `Assertion` is `{target, operator, key?, expected, enabled}` drawn from a fixed set of 7 targets and 11 operators (`test-engine/types.ts`'s `OPERATORS_BY_TARGET`). There is no way to author an assertion that isn't one of these known (target, operator) pairs — the UI can't produce one, and the Zod schema rejects an unknown `target`/`operator` string on import/load.
- **JSONPath is a hand-written, documented subset — not a library, not `eval`.** `evaluateJsonPath` parses `$.a.b[0].c` with two regexes matching property-access and array-index segments only; there is no code-generation, no `new Function(path)`, no expression compilation. An unsupported construct (wildcards, filters, recursive descent) is rejected outright rather than partially interpreted.
- **The one accepted residual risk**: the `matches` operator (body assertions only) constructs a native `RegExp` from user-entered text. This is not code execution, but a pathologically crafted pattern (e.g. catastrophic backtracking) could make evaluation slow — the same class of risk any application accepting a user-supplied regex has. Not mitigated in Milestone 7; flagged for Milestone 12 (Security Hardening) rather than silently accepted as a non-issue.
- **Assertions never mutate the response they evaluate.** Verified by a regression test that snapshots an `ApiResponseResult` before and after `evaluateAssertions` runs against it.
- **Assertion evaluation errors are contained.** A malformed JSON path, an assertion against a non-JSON body, or a non-numeric `expected` value on a numeric target produces a typed `AssertionResult.error`, never an uncaught exception that could interrupt the surrounding Send/Run flow.

## Collection Runner (Milestone 7)

- **No new execution surface.** The Runner calls the exact same `executeRequestConfig` pipeline a manual Send does — it does not introduce a second, less-reviewed code path for sending requests, applying auth, or evaluating assertions.
- **Isolated from open-tab state.** Runner execution reads `workspace`/`environments` but never reads or writes `tabs`, `responses`, `sendErrors`, or any other tab-scoped state — a malicious or malformed saved request executed by the Runner cannot corrupt an open tab's in-progress edits. Verified by a regression test.
- **Cancellation is real, not cosmetic.** `AbortController` is threaded through to the underlying `fetch` (via the shared `BrowserFetchExecutor`), and the signal is checked both before starting the next request and after the current one resolves — a cancelled run reports `Cancelled`, never a false `Passed`/`Completed`, and an in-flight request's result is discarded rather than raced into the result list.
- **Sequential only.** No parallel execution exists in the Runner, so there's no shared-mutable-state-across-concurrent-requests class of bug to review here; that risk is deferred to whichever future milestone (if any) considers concurrent Runner execution.

## Review Cadence

This document is revisited whenever script execution is next considered (before any `script-engine` implementation begins — see the Script Execution Sandbox section's current-state note) and again at Milestone 12 (dedicated Security Hardening milestone), and updated whenever a concrete sandboxing or SSRF-prevention mechanism is chosen, so the documented model always matches the implemented one.
