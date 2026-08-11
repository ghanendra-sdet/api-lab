# API Lab — Feature Matrix

Every planned feature, with priority, the milestone phase it belongs to (see [`ROADMAP.md`](ROADMAP.md)), and current status. This is the operational tracking document — update `Status` as work lands. `docs/PRODUCT-SCOPE.md` is the narrative version of the same scope; this is the checklist version.

**Priority key**: P0 = required for a usable v1, P1 = important, follows soon after v1, P2 = valuable but deferrable.
**Status key**: Planned, In Progress, Done, Deferred.

## Application Shell

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Sidebar navigation (collections tree) | P0 | 1 | Done |
| Request tabs (multi-request workspace) | P0 | 1 | Done |
| Response panel | P0 | 1 | Done (real response rendering shipped in Milestone 2) |
| Light/dark theme | P1 | 1 | Done |
| Responsive layout (usable down to tablet width) | P1 | 1 | Done |

## Request Building

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| GET | P0 | 2 | Done |
| POST | P0 | 2 | Done |
| PUT | P0 | 2 | Done |
| PATCH | P0 | 2 | Done |
| DELETE | P0 | 2 | Done |
| HEAD | P1 | 2 | Done (no body sent, per HTTP spec) |
| OPTIONS | P1 | 2 | Done |
| Query parameters (with enable/disable) | P0 | 2 | Done |
| Path parameters (auto-detected) | P0 | 2 | Planned |
| Headers editor (with enable/disable) | P0 | 2 | Done |
| Cookies (per-domain jar) | P1 | 2 | Planned |
| Body: raw JSON | P0 | 2 | Done (Monaco editor, JSON validation before send) |
| Body: raw XML / Text / HTML | P1 | 2 | Done (sent as raw text with the matching Content-Type; no XML/HTML validation) |
| Body: form-data (multipart) | P0 | 2 | Planned |
| Body: x-www-form-urlencoded | P0 | 2 | Planned |
| Body: binary/file upload | P1 | 2 | Planned |
| Send request / view response | P0 | 2 | Done (via `BrowserFetchExecutor` / native fetch) |
| Request cancellation | P1 | 2 | Done (`AbortController`) |
| Request reset ("Clear") | P1 | 2 | Done |
| Request history | P1 | 2 | Planned |

## Response Handling

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Status code + text display | P0 | 2 | Done |
| Response timing | P0 | 2 | Done |
| Response size | P1 | 2 | Done (content-length header when present, else decoded byte length — see docs/ARCHITECTURE.md known limitations) |
| Pretty JSON viewer | P0 | 2 | Done (Monaco, read-only) |
| Raw response viewer | P0 | 2 | Done |
| Response headers viewer | P0 | 2 | Done |
| Empty response (204) handling | P0 | 2 | Done |
| Non-JSON response handling (text/HTML) | P0 | 2 | Done (HTML always shown as inert text, never rendered) |
| Network/CORS/timeout error handling | P0 | 2 | Done (friendly message; browser doesn't distinguish CORS vs. network failure — see known limitations) |

## Collections

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Collections (create/list) | P0 | 3 | Done |
| Folders (nested) | P0 | 3 | Done (one level deep, by design — see docs/ARCHITECTURE.md) |
| Requests within folders/collections | P0 | 3 | Done |
| Reordering | P1 | 3 | Done (move up/down, not drag-and-drop) |
| Duplicate | P1 | 3 | Done |
| Rename | P0 | 3 | Done |
| Delete | P0 | 3 | Done |
| Local persistence | P0 | 3 | Done (localStorage, versioned schema, corrupt-data recovery) |

## Environments

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Global variables | P0 | 4 | Deferred (documented precedence, not implemented — see docs/ARCHITECTURE.md) |
| Environment variables | P0 | 4 | Done |
| Collection variables | P1 | 4 | Deferred (documented precedence, not implemented — see docs/ARCHITECTURE.md) |
| Local/request variables | P1 | 4 | Deferred (documented precedence, not implemented — see docs/ARCHITECTURE.md) |
| Variable interpolation (`{{var}}`) | P0 | 4 | Done (URL, query params, headers, raw body; circular-reference and resolution-depth protected) |
| Environment switching (in-context) | P0 | 4 | Done |
| Environment CRUD (create/rename/duplicate/delete) | P0 | 4 | Done |
| Variable CRUD + enable/disable + secret flag | P0 | 4 | Done |
| Secret masking (UI) | P0 | 4 | Done (per-row show/hide; never revealed in the resolved-URL preview) |
| Unknown-variable handling | P0 | 4 | Done (blocks send with a named error, never silently sends a broken URL) |
| Environment persistence + corrupt-data recovery | P0 | 4 | Done (dedicated versioned localStorage boundary, separate from the workspace envelope) |

## Authentication

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| No Auth | P0 | 5 | Done |
| API Key (header) | P0 | 5 | Done |
| API Key (query parameter) | P0 | 5 | Done |
| Basic Auth | P0 | 5 | Done |
| Bearer Token | P0 | 5 | Done |
| JWT Bearer | P1 | 5 | Done (bearer-token execution with JWT-specific UX; no decode/inspect or signing) |
| Variable integration (`{{token}}` etc. in auth fields) | P0 | 5 | Done |
| Auth/manual-header precedence | P0 | 5 | Done (auth-generated header/param wins on a name collision — see docs/ARCHITECTURE.md) |
| Auth persistence + pre-Milestone-5 backward compatibility | P0 | 5 | Done |
| OAuth 2.0 (authorization code) | P1 | 5 | Deferred (architecture documented, not implemented — see docs/ARCHITECTURE.md and docs/SECURITY.md) |
| OAuth 2.0 (client credentials) | P1 | 5 | Deferred (architecture documented, not implemented) |
| OAuth 2.0 (PKCE, device code, refresh token) | P1 | 5 | Deferred (architecture documented, not implemented) |
| Auth inheritance (collection → request) | P1 | 5 | Deferred (documented future model, not implemented — see docs/ARCHITECTURE.md) |

## Import / Export

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Import Postman Collection (v2.1) | P0 | 6 | Done (folders flattened one level with a warning; unsupported auth/body/scripts preserved-or-warned, never faked) |
| Import Postman Environment | P0 | 6 | Done |
| Import OpenAPI (JSON) | P1 | 6 | Done (3.0.x and 3.1.x; grouped by first tag; JSON request bodies via example/examples) |
| Import OpenAPI (YAML) | P1 | 6 | Deferred (JSON only this milestone — see docs/ARCHITECTURE.md) |
| Import API Lab native workspace export | P0 | 6 | Done |
| Import preview + explicit confirm (never auto-applies) | P0 | 6 | Done |
| Import validation (schema, size limit, malformed/deeply-nested input) | P0 | 6 | Done (5MB limit; recursive-parse exceptions caught, never crash the app) |
| Import collision handling (non-destructive rename) | P0 | 6 | Done |
| Export API Lab native format | P0 | 6 | Done (versioned, deterministic, round-trip tested) |
| Export Postman-compatible format | P1 | 6 | Done (Postman Collection v2.1 JSON; round-trip tested through API Lab's own importer) |
| Insomnia / Bruno / HAR / curl import | P2 | 6 | Deferred (parser-isolation boundary designed to allow this later — see docs/ARCHITECTURE.md) |

## Testing Engine

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Status code assertions (equals/notEquals/greaterThan/lessThan/…) | P0 | 7 | Done |
| Status range assertions (2xx/3xx/4xx/5xx) | P0 | 7 | Done |
| Header assertions (exists/notExists/equals/contains, case-insensitive name) | P0 | 7 | Done |
| Body assertions (contains/notContains/equals/exists/notExists/matches) | P0 | 7 | Done |
| JSON body assertions | P0 | 7 | Done |
| JSONPath extraction/assertion (documented subset: `$.a.b[0].c`) | P1 | 7 | Done |
| JSON Schema validation | P1 | 7 | Deferred (mature-validator integration is a near-term follow-up, not implemented this milestone — see docs/ARCHITECTURE.md) |
| Response-time assertions | P1 | 7 | Done (documents that browser timing ≠ server-side load-test timing) |
| Response-size assertions | P1 | 7 | Done |
| Assertion builder UI (no-code, guided) | P0 | 7 | Done |
| Assertions saved with requests + backward compatibility | P0 | 7 | Done |
| Test result reporting (per-request, pass/fail/error/skipped) | P0 | 7 | Done |
| Pre-request scripts (sandboxed) | P0 | 7 | Deferred — editing surface exists, execution intentionally not implemented (see docs/SECURITY.md) |
| Post-response scripts (sandboxed) | P0 | 7 | Deferred — same as above |

## Collection Runner

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Sequential collection execution | P0 | 7 | Done (foundation shipped in Milestone 7, ahead of the original Milestone 8 placement — see docs/ROADMAP.md) |
| Request selection (run all / run selected) | P0 | 7 | Done |
| Environment selection for run | P0 | 7 | Done |
| Stop-on-failure / continue-on-failure | P0 | 7 | Done |
| Run cancellation | P0 | 7 | Done |
| Run result reporting (summary + per-request detail) | P0 | 7 | Done |
| Iterations | P0 | 8 | Done (per-dataset-row, or one implicit iteration for a dataset-less run) |
| Inter-request delay | P1 | 8 | Deferred — not part of Milestone 8's explicit scope; no concrete need identified yet |
| Data-driven execution (CSV) | P1 | 8 | Done (`packages/runner-engine`'s `parseCsvDataset`; 1000-row cap) |
| Data-driven execution (JSON) | P1 | 8 | Done (`packages/runner-engine`'s `parseJsonDataset`; 1000-row cap) |
| Request chaining (extract → reuse values) | P1 | 8 | Done (structured JSON-path/header extraction → named runtime variable, resolved through the existing variable resolver — no scripting) |
| Parallel execution | P2 | Future | Explicit non-goal for the Runner; performance testing (Milestone 10) has its own execution architecture |
| Run reports (exportable) | P0 | 8 | Deferred — in-UI iteration/request reporting shipped; exportable report *files* not part of Milestone 8's explicit scope |

## Mock API Engine

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Define mock endpoints | P0 | 9 | Done (method + path with `:param` segments, GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) |
| Custom response body/headers | P0 | 9 | Done (JSON/text body, custom headers, constrained `{{...}}` templating) |
| Status-code scenarios (full set) | P0 | 9 | Done (15 presets: 200/201/202/204/400/401/403/404/409/422/429/500/502/503/504 — editable, not hardcoded) |
| Named scenario presets | P1 | 9 | Done (multiple named scenarios per route; switch the active one without a restart) |
| Configurable latency | P1 | 9 | Done (per-scenario delay, 0–30,000ms, enforced server-side) |
| Error/timeout simulation | P1 | 9 | Done (via status-code presets and delay; no artificial connection-drop/timeout simulation beyond delay) |
| Malformed-response simulation | P2 | 9 | Deferred — not part of Milestone 9's explicit scope |
| Real standalone server (`apps/mock-server`) | P0 | 9 | Done (Fastify, real TCP port, independent of the browser) |
| Query parameter inspection | P1 | 9 | Done (`{{query.name}}` in response templates) |
| Request body matching (route to scenario by payload) | P2 | 9 | Deferred — evaluated, not implemented; scenario selection is manual/active-scenario based, not payload-driven |
| Request logging (method/path/status/duration) | P1 | 9 | Done (in-memory, 200-entry ring buffer; never logs bodies or Authorization/Cookie headers) |
| Route/scenario persistence + corruption recovery | P0 | 9 | Done (versioned, Zod-validated JSON file on the server's own filesystem, not the browser) |
| Runner integration (mock as a real collection target) | P0 | 9 | Done |
| Environment integration (`{{mockBaseUrl}}`) | P0 | 9 | Done |
| OpenAPI → Mock Route generation | P2 | Future | Deferred — route model kept adapter-friendly, no adapter built yet |
| Mock server management authentication | P1 | Future | Explicit non-goal for Milestone 9 — local dev tooling trust model, revisit before any hosted deployment |

## Performance Engine

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Virtual users / concurrency | P1 | 10 | Planned |
| Configurable duration | P1 | 10 | Planned |
| Ramp-up | P1 | 10 | Planned |
| Metrics: RPS, avg, P50/P90/P95/P99 | P1 | 10 | Planned |
| Error rate / status distribution | P1 | 10 | Planned |
| Performance reports | P1 | 10 | Planned |

## Documentation Generation

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Endpoint documentation from collection | P1 | 11 | Planned |
| Request/response examples | P1 | 11 | Planned |
| Schema documentation | P2 | 11 | Planned |
| Collection-level documentation | P2 | 11 | Planned |

## Security Hardening

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Script sandbox (isolated execution) | P0 | 12 | Planned |
| SSRF protection (mock/proxy layer) | P0 | 12 | Planned |
| Credential storage protection | P0 | 12 | Planned |
| Script resource limits (time/memory) | P0 | 12 | Planned |
| XSS protection (response rendering) | P0 | 12 | Planned |
| Prototype pollution protection | P0 | 12 | Planned |

## Future Protocols (Roadmap Only — Not Scheduled)

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| GraphQL support | P2 | Future | Deferred |
| WebSocket support | P2 | Future | Deferred |
| Server-Sent Events (SSE) | P2 | Future | Deferred |
| SOAP support | P2 | Future | Deferred |
| gRPC support | P2 | Future | Deferred |
