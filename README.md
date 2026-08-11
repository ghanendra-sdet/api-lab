# API Lab

A free, open-source, browser-based API client, testing, mocking, collection runner, and performance testing platform.

API Lab is being built as a zero-install alternative for everyday API development and QA work — build requests, organize them into collections, manage environments, write tests, run them against mock or real endpoints, and generate reports, all from the browser.

> **Status**: Milestone 6 (Import / Export & External Collection Formats) complete. API Lab sends real HTTP requests — GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, query params, headers, and raw JSON/Text/XML/HTML bodies — and shows the real response (status, timing, size, headers, Pretty/Raw body views). Requests can be organized into collections and folders, saved, edited, duplicated, moved, and reordered, and the whole workspace persists locally across reloads. Requests can reference `{{variables}}` resolved from a selectable Environment (URL, query, headers, body), with unresolved/circular references caught before send and secret values masked in the UI. Requests can also carry No Auth / API Key / Basic / Bearer / JWT Bearer authorization, with credentials resolved from environment variables at send time and never baked into saved data; OAuth 2.0 is an honest, non-functional placeholder pending its own milestone. API Lab can now import Postman Collections (v2.1), Postman Environments, and OpenAPI 3.0/3.1 documents into its own workspace with a mandatory preview step, and export collections as Postman Collections or the whole workspace in a native, versioned, round-trippable format. Scripts and the request runner are not built yet. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the milestone plan.

## Running Locally

```bash
npm install
npm run dev        # apps/web on http://localhost:5173
npm run typecheck
npm run lint
npm run test        # Vitest unit tests
npm run test:e2e    # Playwright smoke suite
npm run build
```

## Why API Lab

Most capable API tooling today is desktop software you have to install. API Lab's goal is a genuinely browser-first equivalent: nothing to download, nothing to keep updated locally, and an architecture that treats the browser as the primary runtime rather than an afterthought.

This project is an independent implementation with its own name, design language, and codebase. It is not a clone of any existing commercial product, and it does not use their source code, branding, or assets.

## Planned Capabilities

- Build and send HTTP requests (all major methods, params, headers, auth, and body types)
- Organize requests into collections and folders
- Manage environments, variables, and scopes
- Configure authentication (API Key, Basic, Bearer, JWT, OAuth 2.0)
- Write assertions and pre-request / post-response scripts
- Import Postman collections and OpenAPI specs; export to a native format
- Run collections with a Runner, including data-driven runs from CSV/JSON
- Spin up mock APIs with configurable status codes, latency, and error scenarios
- Run performance/load tests and generate functional and performance reports
- Generate API documentation from collections

Full detail: [`docs/PRODUCT-SCOPE.md`](docs/PRODUCT-SCOPE.md) and [`docs/FEATURE-MATRIX.md`](docs/FEATURE-MATRIX.md).

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/PRODUCT-SCOPE.md`](docs/PRODUCT-SCOPE.md) | The full product vision, area by area |
| [`docs/FEATURE-MATRIX.md`](docs/FEATURE-MATRIX.md) | Every planned feature, with priority, phase, and status |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture and technology decisions |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestone-by-milestone build plan |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security model, especially around user-script execution |
| [`CLAUDE.md`](CLAUDE.md) | Engineering principles and workflow for AI-assisted development on this repo |

## Development Status

This repository is in **Milestone 0 — Repository & Architecture**. No application code exists yet. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next.

## License

[MIT](LICENSE)
