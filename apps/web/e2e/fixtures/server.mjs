// Deterministic, dependency-free HTTP fixture for E2E tests only.
//
// This is NOT the Mock API Engine (that's Milestone 9's product feature,
// with a UI, scenario editor, and persistence). This exists purely so
// Playwright tests don't depend on an unreliable public third-party API.
//
// Endpoints:
//   GET|POST|PUT|PATCH|DELETE /echo   -> 200 JSON: { method, query, headers, body }
//   GET  /status/:code                -> that status code, small JSON body
//   GET  /empty                       -> 204 No Content
//   GET  /text                        -> 200 text/plain
//   GET  /html                        -> 200 text/html
//   GET  /json                        -> 200 JSON: fixed nested object, for JSON-path assertion tests
//   GET  /delay/:ms                   -> 200 after a deterministic delay, for response-time/cancellation tests
//   POST /login                       -> 200 JSON: { token: "tok-<username or 'anon'>" }, also sets an
//                                         X-Auth-Token header with the same value — lets Milestone 8 tests
//                                         extract the same value from either a JSON path or a header.
//   GET  /whoami                      -> 200 JSON: { authorization: <Authorization header or null> },
//                                         echoes back whatever the request sent — used to verify a value
//                                         extracted from /login was actually chained into a later request.
import { createServer } from "node:http";

const PORT = 4001;

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Without this, custom response headers like X-Auth-Token are sent over
  // the wire but invisible to browser fetch() — needed for the header
  // extraction source (Milestone 8) to have anything real to read in E2E.
  res.setHeader("Access-Control-Expose-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function sendJson(res, status, payload) {
  withCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    withCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/echo") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      let body = rawBody;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        // leave as raw string
      }
      sendJson(res, 200, {
        method: req.method,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body,
      });
    });
    return;
  }

  const statusMatch = url.pathname.match(/^\/status\/(\d{3})$/);
  if (statusMatch) {
    const code = Number(statusMatch[1]);
    sendJson(res, code, { status: code });
    return;
  }

  if (url.pathname === "/empty") {
    withCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/text") {
    withCors(res);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello API Lab");
    return;
  }

  if (url.pathname === "/html") {
    withCors(res);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<p>Hello from the fixture server</p>");
    return;
  }

  if (url.pathname === "/json") {
    sendJson(res, 200, {
      id: 123,
      user: { name: "Ada", active: true },
      items: [{ id: 1, label: "first" }, { id: 2, label: "second" }],
    });
    return;
  }

  if (url.pathname === "/login" && req.method === "POST") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      // A query-string username (used by dataset-driven E2E tests, where
      // templating a raw JSON body isn't worth the extra editor interaction)
      // takes precedence over one in the JSON body.
      let username = url.searchParams.get("username") ?? "anon";
      try {
        const parsed = rawBody ? JSON.parse(rawBody) : {};
        if (!url.searchParams.get("username") && parsed && typeof parsed.username === "string" && parsed.username) {
          username = parsed.username;
        }
      } catch {
        // leave as-is
      }
      const token = `tok-${username}`;
      withCors(res);
      res.setHeader("X-Auth-Token", token);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token }));
    });
    return;
  }

  if (url.pathname === "/whoami") {
    sendJson(res, 200, { authorization: req.headers.authorization ?? null });
    return;
  }

  const delayMatch = url.pathname.match(/^\/delay\/(\d+)$/);
  if (delayMatch) {
    const ms = Number(delayMatch[1]);
    setTimeout(() => sendJson(res, 200, { delayedMs: ms }), ms);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Test fixture server listening on http://localhost:${PORT}`);
});
