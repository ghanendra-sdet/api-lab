# API Lab — Deployment

This document covers the production deployment architecture, build commands, and local development setup for API Lab.

## Architecture Overview

API Lab is a monorepo of three runtime components:

| Component | Package | Type | Default Port |
|---|---|---|---|
| **Web App** | `apps/web` | Static SPA (Vite + React) | — (static files) |
| **Mock Server** | `apps/mock-server` | Node.js HTTP server (Fastify) | 4010 |
| **Performance Worker** | `apps/performance-worker` | Node.js HTTP server (Fastify) | 4020 |

### SPA Deployment Model

**The web app is the only component that must be deployed for a functional frontend.**

The Mock Server and Performance Worker are **optional local companions**. They run on the same machine as the browser and communicate over `localhost`. They cannot be meaningfully hosted on a remote server because:

- The Performance Worker generates load from the machine it runs on — hosting it remotely would mean load generation from a different location than intended.
- The Mock Server is a local development tool; exposing it publicly would require authentication (tracked in `docs/FEATURE-MATRIX.md` as a future item).

## Production Build

### 1. Install dependencies

```bash
npm install
```

### 2. Build the web app

```bash
# Build only the web app (recommended for static hosting)
npm run build --workspace=apps/web

# Or build everything
npm run build
```

The web app output is at `apps/web/dist/`. It is a self-contained static directory suitable for any static host.

### 3. Deploy `apps/web/dist/` to a static host

| Platform | Command / Notes |
|---|---|
| **Vercel** | Connect the repo; set the output directory to `apps/web/dist` and build command to `npm run build --workspace=apps/web` |
| **Netlify** | Same as Vercel; publish directory: `apps/web/dist` |
| **GitHub Pages** | Use the `actions/deploy-pages` action; upload `apps/web/dist` as the artifact |
| **AWS S3 + CloudFront** | Upload `apps/web/dist` to an S3 bucket configured for static website hosting |
| **Self-hosted nginx** | Serve `apps/web/dist` with the SPA fallback rule below |

#### nginx SPA fallback rule

API Lab is a single-page application. All URLs must serve `index.html`:

```nginx
location / {
  root /path/to/apps/web/dist;
  try_files $uri $uri/ /index.html;
}
```

## Local Development

### Start the web app (required)

```bash
npm run dev
```

Opens at `http://localhost:5173`.

### Start the Mock Server (optional)

```bash
npm run dev:mock-server
```

Starts at `http://localhost:4010`. Configure this URL as a `{{mockBaseUrl}}` environment variable in the web app to use mock routes as request targets.

### Start the Performance Worker (optional)

```bash
npm run dev:performance-worker
```

Starts at `http://localhost:4020`. The web app's Performance tab connects to this automatically when running.

## Environment Requirements

| Requirement | Minimum Version | Notes |
|---|---|---|
| Node.js | 20.x LTS | Required for the Mock Server and Performance Worker. Not required for the web app (pure browser). |
| npm | 10.x | Included with Node.js 20.x. |
| Browser | See below | Web app only — no Node.js needed for end users. |

## Browser Support

| Browser | Support | Notes |
|---|---|---|
| Chrome 90+ | ✅ Full | Primary development and testing target |
| Edge 90+ | ✅ Full | Chromium-based; same engine as Chrome |
| Firefox 90+ | ✅ Full | All features work; Web Workers, AbortController, localStorage |
| Safari 15+ | ✅ Supported | All APIs used are standard; minor Monaco rendering differences possible |

### Known Limitations (not browser bugs)

- **Monaco Editor**: Loaded from the jsdelivr CDN at runtime (`https://cdn.jsdelivr.net`). Requires network access on first load; cached by the browser thereafter. Tracked as a future improvement to self-host the assets.
- **CORS**: Browser-native `fetch` is used for requests. Servers that do not send CORS headers will produce a generic network error — this is a browser security constraint, not an API Lab bug. See `docs/ARCHITECTURE.md` for details.
- **`Set-Cookie` headers**: Browser JS cannot read `Set-Cookie` response headers. Cookie jar support requires a server-side proxy (tracked as a future improvement).
- **Mobile (< 640px)**: The application is optimized for desktop and tablet widths. Sub-640px phone viewports have known layout limitations (TopBar button overflow, multi-pane dialogs). Tracked as future responsive improvements.

## Content Security Policy

The production `index.html` includes a CSP meta tag. If you serve API Lab behind a reverse proxy, you may additionally set the CSP as an HTTP response header (HTTP header CSP takes precedence over meta CSP):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net blob:;
  style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
  font-src 'self' https://cdn.jsdelivr.net;
  worker-src 'self' blob:;
  frame-src 'self' blob:;
  connect-src 'self' http://localhost:* https://cdn.jsdelivr.net;
  img-src 'self' data:;
```

This must match `apps/web/index.html`'s CSP `<meta>` tag exactly — an HTTP header CSP takes precedence over the meta tag, so a mismatch here silently changes what's enforced in production.

**Why `'unsafe-inline'` for styles?** React's runtime and Monaco both inject inline styles. This is a known constraint tracked for improvement when Monaco is self-hosted.

**Why `'unsafe-inline'` for scripts?** The generated API documentation preview embeds a small inline `<script>` (its client-side search index) inside a sandboxed `srcDoc` iframe. A `srcDoc` iframe inherits the parent document's CSP, so without `'unsafe-inline'` here that inline script — and therefore documentation search — would silently fail to run. **Follow-up worth doing**: since the generated script content is deterministic (byte-identical for identical inputs, per Milestone 13), a `script-src 'sha256-<hash>'` entry could replace this blanket allowance and preserve inline-script protection for the rest of the app. Not done in this pass — tracked here rather than left undocumented.

**Why no `'unsafe-eval'`?** Confirmed: zero `eval()` or `new Function()` calls in production code.

## Quality Gates

Before releasing a build, run:

```bash
npm run typecheck   # TypeScript across all 15 workspaces
npm run lint        # ESLint
npm test            # 1,356 unit/integration tests
cd apps/web && npm run build  # Production build must succeed
npm run test:e2e    # 144 Playwright E2E tests (requires mock server and performance worker)
```

All gates must be green before deployment.
