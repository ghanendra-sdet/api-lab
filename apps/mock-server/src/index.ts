import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildMockServer } from "./server.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.MOCK_SERVER_PORT ?? 4010);
const DATA_FILE = process.env.MOCK_SERVER_DATA_FILE ?? join(__dirname, "..", "data", "mock-routes.json");
const CORS_ORIGIN = process.env.MOCK_SERVER_CORS_ORIGIN ?? true;

const app = buildMockServer({ dataFile: DATA_FILE, corsOrigin: CORS_ORIGIN });

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`[mock-server] listening on http://localhost:${PORT} (data: ${DATA_FILE})`);
  })
  .catch((err: unknown) => {
    console.error("[mock-server] failed to start:", err);
    process.exit(1);
  });
