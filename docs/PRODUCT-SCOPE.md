# API Lab — Product Scope

This document defines the full product vision for API Lab. It is the source of truth for *what* the product eventually covers. Priority, sequencing, and current status live in [`FEATURE-MATRIX.md`](FEATURE-MATRIX.md) and [`ROADMAP.md`](ROADMAP.md) — this document does not imply anything here is built yet.

## Request Building

- HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- URL construction with live parameter sync
- Query parameters (key/value, bulk edit, enable/disable per row)
- Path parameters (`:id`-style, auto-detected from the URL)
- Headers (key/value, bulk edit, enable/disable per row, suggested/known headers)
- Cookies (per-request and per-domain jar)
- Request body types: raw JSON, raw XML, form-data (multipart), x-www-form-urlencoded, binary/file upload
- Request history

## Collections

- Collections as the top-level organizational unit
- Folders (nested) within a collection
- Requests within folders or directly in a collection
- Reordering (drag-and-drop or explicit move)
- Duplication, rename, delete at every level
- Local persistence (save)
- Import and export (see Import/Export section)

## Environments

- Global variables (available everywhere)
- Environment variables (scoped to a selected environment)
- Collection variables (scoped to a specific collection)
- Local/request-level variables (highest precedence, most specific scope)
- Variable interpolation using `{{variableName}}` syntax, resolved at request-send time using documented scope precedence
- Environment switching from the UI without leaving the current request

## Authentication

- No Auth
- API Key (header or query param placement)
- Basic Auth
- Bearer Token
- JWT (with optional decode/inspect view)
- OAuth 2.0 (authorization code and client credentials flows, at minimum)

Auth configuration is inheritable: a collection can define auth that its requests use by default, with per-request override.

## Testing

- Assertions against a response: status code, headers, body (JSON path, schema)
- JSON Schema validation of response bodies
- JSONPath-based value extraction and assertion
- Response-time assertions (e.g., "responds in under Nms")
- Pre-request scripts (run before the request is sent — e.g., to set a variable or compute a signature)
- Post-response scripts (run after the response arrives — e.g., to extract a token into an environment variable, or run custom assertions)
- Scripts execute in a sandboxed context — see [`SECURITY.md`](SECURITY.md)

## Runner

- Execute an entire collection (or folder) in sequence
- Configurable iteration count
- Configurable delay between requests
- Environment selection for the run
- Data-driven execution: iterate a collection once per row of a CSV or JSON data file, interpolating each row's values into the requests
- Run reports: per-request pass/fail, timing, and assertion results, exportable

## Import / Export

- Import: Postman Collection format (v2.1 JSON)
- Import: OpenAPI (JSON and YAML), generating a collection of requests from the spec
- Export: API Lab's own native collection format (JSON)
- Export: Postman-compatible format, for interoperability with tools that read it

## Mock Server

- Define mock endpoints (method + path) independent of any real backend
- Custom response bodies and headers per mock endpoint
- Status-code scenarios per endpoint: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504
- Named scenario presets: Success, Unauthorized, Forbidden, Not Found, Validation Error, Conflict, Server Error, Timeout, Empty Response, Malformed Response
- Configurable artificial latency per endpoint or scenario
- Error simulation (forced failures, timeouts, malformed payloads) for testing client resilience

## Performance Testing

- Configurable virtual users (concurrency)
- Configurable test duration
- Configurable ramp-up period
- Metrics captured: requests per second, average response time, P50, P90, P95, P99, error rate, status-code distribution
- Performance reports, viewable in-app and exportable

## Documentation

- Auto-generated endpoint documentation from a collection's requests
- Request and response examples attached to each documented endpoint
- Schema documentation (from JSON Schema assertions or OpenAPI import)
- Collection-level documentation (description, overview) alongside per-endpoint docs

## Future Protocols (Explicitly Out of Initial Scope)

The following are documented as roadmap intent only. None are implemented in the initial build, and no partial/stub support for them should be added before they're actually scheduled:

- GraphQL
- WebSocket
- Server-Sent Events (SSE)
- SOAP
- gRPC

## Non-Goals

- API Lab is not a desktop application and will not ship one. Browser-first is a permanent architectural constraint, not a temporary limitation.
- API Lab does not aim for feature parity with any specific commercial product as a goal in itself — the goal is a genuinely useful, independently designed tool that covers the workflow above.

## Deferred Scope Items

The following items are in the long-term product scope above but are currently deferred from the initial development scope. Each is tracked in `docs/FEATURE-MATRIX.md` with a stated rationale. None represents a functional gap for the core JSON/REST API testing workflow.

| Feature | Deferred To | Workaround |
|---|---|---|
| Path parameters (auto-detected from URL) | Future Scope | Use `{{variable}}` syntax in the URL — the variable resolver already handles path segments |
| Body: form-data (multipart) | Future Scope | Use raw body mode with `Content-Type: multipart/form-data` header set manually |
| Body: x-www-form-urlencoded | Future Scope | Use raw body mode with `Content-Type: application/x-www-form-urlencoded` header set manually |
| Body: binary/file upload | Future Scope | Not available in initial scope |
| Cookies (per-domain jar) | Future Scope | Browser JS cannot read `Set-Cookie` response headers; requires server-side proxy |
