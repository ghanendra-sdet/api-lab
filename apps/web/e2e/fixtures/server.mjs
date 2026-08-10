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
import { createServer } from "node:http";

const PORT = 4001;

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Test fixture server listening on http://localhost:${PORT}`);
});
