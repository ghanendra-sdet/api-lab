# API Lab — Feature Matrix

Every planned feature, with priority, the milestone phase it belongs to (see [`ROADMAP.md`](ROADMAP.md)), and current status. This is the operational tracking document — update `Status` as work lands. `docs/PRODUCT-SCOPE.md` is the narrative version of the same scope; this is the checklist version.

**Priority key**: P0 = required for a usable v1, P1 = important, follows soon after v1, P2 = valuable but deferrable.
**Status key**: Planned, In Progress, Done, Deferred.

## Application Shell

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Sidebar navigation (collections tree) | P0 | 1 | Planned |
| Request tabs (multi-request workspace) | P0 | 1 | Planned |
| Response panel | P0 | 1 | Planned |
| Light/dark theme | P1 | 1 | Planned |
| Responsive layout (usable down to tablet width) | P1 | 1 | Planned |

## Request Building

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| GET | P0 | 2 | Planned |
| POST | P0 | 2 | Planned |
| PUT | P0 | 2 | Planned |
| PATCH | P0 | 2 | Planned |
| DELETE | P0 | 2 | Planned |
| HEAD | P1 | 2 | Planned |
| OPTIONS | P1 | 2 | Planned |
| Query parameters (with enable/disable) | P0 | 2 | Planned |
| Path parameters (auto-detected) | P0 | 2 | Planned |
| Headers editor (with enable/disable) | P0 | 2 | Planned |
| Cookies (per-domain jar) | P1 | 2 | Planned |
| Body: raw JSON | P0 | 2 | Planned |
| Body: raw XML | P1 | 2 | Planned |
| Body: form-data (multipart) | P0 | 2 | Planned |
| Body: x-www-form-urlencoded | P0 | 2 | Planned |
| Body: binary/file upload | P1 | 2 | Planned |
| Send request / view response | P0 | 2 | Planned |
| Request history | P1 | 2 | Planned |

## Collections

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Collections (create/list) | P0 | 3 | Planned |
| Folders (nested) | P0 | 3 | Planned |
| Requests within folders/collections | P0 | 3 | Planned |
| Reordering | P1 | 3 | Planned |
| Duplicate | P1 | 3 | Planned |
| Rename | P0 | 3 | Planned |
| Delete | P0 | 3 | Planned |
| Local persistence | P0 | 3 | Planned |

## Environments

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Global variables | P0 | 4 | Planned |
| Environment variables | P0 | 4 | Planned |
| Collection variables | P1 | 4 | Planned |
| Local/request variables | P1 | 4 | Planned |
| Variable interpolation (`{{var}}`) | P0 | 4 | Planned |
| Environment switching (in-context) | P0 | 4 | Planned |

## Authentication

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| No Auth | P0 | 5 | Planned |
| API Key | P0 | 5 | Planned |
| Basic Auth | P0 | 5 | Planned |
| Bearer Token | P0 | 5 | Planned |
| JWT (decode/inspect) | P1 | 5 | Planned |
| OAuth 2.0 (authorization code) | P1 | 5 | Planned |
| OAuth 2.0 (client credentials) | P1 | 5 | Planned |
| Auth inheritance (collection → request) | P1 | 5 | Planned |

## Import / Export

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Import Postman Collection (v2.1) | P0 | 6 | Planned |
| Import OpenAPI (JSON) | P1 | 6 | Planned |
| Import OpenAPI (YAML) | P1 | 6 | Planned |
| Export API Lab native format | P0 | 6 | Planned |
| Export Postman-compatible format | P1 | 6 | Planned |

## Testing Engine

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Status code assertions | P0 | 7 | Planned |
| Header assertions | P0 | 7 | Planned |
| JSON body assertions | P0 | 7 | Planned |
| JSON Schema validation | P1 | 7 | Planned |
| JSONPath extraction/assertion | P1 | 7 | Planned |
| Response-time assertions | P1 | 7 | Planned |
| Pre-request scripts (sandboxed) | P0 | 7 | Planned |
| Post-response scripts (sandboxed) | P0 | 7 | Planned |
| Test result reporting (per-request) | P0 | 7 | Planned |

## Collection Runner

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Sequential collection execution | P0 | 8 | Planned |
| Iterations | P0 | 8 | Planned |
| Inter-request delay | P1 | 8 | Planned |
| Environment selection for run | P0 | 8 | Planned |
| Data-driven execution (CSV) | P1 | 8 | Planned |
| Data-driven execution (JSON) | P1 | 8 | Planned |
| Run reports (exportable) | P0 | 8 | Planned |

## Mock API Engine

| Feature | Priority | Phase | Status |
|---|---:|---:|---|
| Define mock endpoints | P0 | 9 | Planned |
| Custom response body/headers | P0 | 9 | Planned |
| Status-code scenarios (full set) | P0 | 9 | Planned |
| Named scenario presets | P1 | 9 | Planned |
| Configurable latency | P1 | 9 | Planned |
| Error/timeout simulation | P1 | 9 | Planned |
| Malformed-response simulation | P2 | 9 | Planned |

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
