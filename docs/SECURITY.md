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

## Credential Handling

- No production credentials are ever committed to the repository (enforced by `.gitignore` and code review — see `CLAUDE.md`).
- Locally stored secrets (API keys, tokens the user enters) are stored in the browser's local persistence layer, scoped per-collection/environment, never logged, and never included in an exported collection unless the user explicitly opts in to exporting secrets (off by default).
- OAuth token exchange, once implemented (Milestone 5), keeps tokens in memory/local storage only — never transmitted anywhere except the configured token endpoint and the API requests that need them.

## Import Validation

- Postman and OpenAPI imports are parsed through `collection-format`'s Zod schemas before any data reaches application state. A structurally invalid or unexpected import is rejected with a clear error, not partially absorbed.

## Review Cadence

This document is revisited at the start of Milestone 7 (before script execution is implemented) and again at Milestone 12 (dedicated Security Hardening milestone), and updated whenever a concrete sandboxing or SSRF-prevention mechanism is chosen, so the documented model always matches the implemented one.
