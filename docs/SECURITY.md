# API Lab — Security Model

API Lab's most significant security surface is that it will eventually execute **user-authored JavaScript** (pre-request and post-response scripts) and make **arbitrary outbound HTTP requests** to endpoints the user configures. Both are normal, necessary features of an API client — and both are exactly the kind of capability that has to be designed securely *before* it's built, not hardened afterward. This document is that design. It must be reviewed and current before Milestone 7 (API Testing Engine, which introduces script execution) begins.

## Threat Model Summary

| Surface | Risk if unaddressed |
|---|---|
| User-authored scripts | Arbitrary code execution in the app's context; access to other collections' data, stored credentials, or the DOM |
| User-configured request targets | Server-Side Request Forgery if any part of API Lab runs server-side and blindly proxies a user-supplied URL |
| Response rendering | Stored/reflected XSS if a response body is rendered as HTML/executed rather than displayed as inert text |
| Imported collections (Postman/OpenAPI) | Malicious or malformed import data used as an injection vector into the app's own state or storage |
| Object merging (imports, variable interpolation, script output) | Prototype pollution via crafted keys (`__proto__`, `constructor.prototype`) |
| Stored credentials (API keys, tokens, OAuth secrets) | Exposure via scripts, exports, logs, or insecure storage |

## Script Execution Sandbox

**Principle**: no user-authored script executes in the same JavaScript context as the main application. This is non-negotiable — `script-engine` is architected around isolation from day one, not retrofitted.

Requirements for the sandbox, to be finalized as a concrete implementation decision before Milestone 7:

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

## Import Validation

- Postman and OpenAPI imports are parsed through `collection-format`'s Zod schemas before any data reaches application state. A structurally invalid or unexpected import is rejected with a clear error, not partially absorbed.

## Review Cadence

This document is revisited at the start of Milestone 7 (before script execution is implemented) and again at Milestone 12 (dedicated Security Hardening milestone), and updated whenever a concrete sandboxing or SSRF-prevention mechanism is chosen, so the documented model always matches the implemented one.
