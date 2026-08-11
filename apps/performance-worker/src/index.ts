import { buildPerformanceServer } from "./server.ts";

/**
 * The performance worker process. Runs exactly like `apps/mock-server`
 * (see docs/ARCHITECTURE.md's Milestone 9 section): plain
 * `node src/index.ts`, using Node's built-in TypeScript type-stripping —
 * no bundler, no build step, no tsx. Every relative import therefore
 * carries an explicit `.ts` extension.
 *
 * It exists because the browser is the wrong place to generate load: a
 * page's fetch stack is throttled by per-host connection limits, competes
 * with rendering for the main thread, and is subject to CORS — all of
 * which would produce misleading numbers. See docs/ARCHITECTURE.md's
 * Milestone 10 section for the full comparison of the alternatives.
 */
const PORT = Number(process.env.PERF_WORKER_PORT ?? 4020);
const CORS_ORIGIN = process.env.PERF_WORKER_CORS_ORIGIN ?? true;

const app = buildPerformanceServer({
  workerUrl: new URL("./loadWorker.ts", import.meta.url),
  corsOrigin: CORS_ORIGIN,
});

app
  .listen({ port: PORT, host: "127.0.0.1" })
  .then(() => {
    console.log(`[performance-worker] listening on http://localhost:${PORT}`);
  })
  .catch((err: unknown) => {
    console.error("[performance-worker] failed to start:", err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
