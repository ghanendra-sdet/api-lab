import type { FastifyInstance } from "fastify";

/**
 * Deterministic security fixtures for Milestone 12 (spec §31).
 *
 * ## These are fixtures, not a vulnerable application
 *
 * Spec §31 is explicit: "Do not build real vulnerable applications — the mock
 * server should intentionally return controlled fixture responses." That
 * distinction is the whole design of this file, and it is worth being precise
 * about what it means.
 *
 * `/verbose-error` does not *have* a bug that produces a stack trace. It
 * returns a hardcoded string that looks like one. There is no Python here, no
 * database, no filesystem access, and no code path that could be induced to
 * disclose anything real. Every response below is a constant chosen to
 * exercise one detector in `@api-lab/security-engine`, in the same spirit as
 * a golden file.
 *
 * The reason this matters: a genuinely vulnerable endpoint shipped in a
 * developer tool is a genuinely vulnerable endpoint. It runs on developer
 * machines, sometimes on shared ones, and "it's only for testing" has never
 * stopped that from being true. Fixtures give the engine exactly the same
 * test coverage with none of that.
 *
 * ## Why the `/__security` prefix
 *
 * The spec names these paths bare (`/auth-required`, `/verbose-error`, …).
 * They are namespaced under `/__security` here for the same reason the admin
 * API lives under `/__mock`: the mock server's catch-all route is what serves
 * user-defined mocks, and a user who legitimately wants to mock their own
 * `/validation` endpoint must not find it shadowed by a built-in fixture.
 * Namespacing keeps the two populations of routes from ever colliding.
 *
 * ## Credentials
 *
 * `FIXTURE_VALID_TOKEN` is a hardcoded constant in an open-source test
 * server that authenticates nothing. It is not a secret and is not treated as
 * one — it exists so a test can demonstrate the difference between a request
 * that authenticates and one that does not.
 */

export const FIXTURE_VALID_TOKEN = "mock-valid-token";
export const FIXTURE_VALID_API_KEY = "mock-valid-api-key";

/** The canned stack trace. Chosen to contain both a stack-trace signature and
 * an internal-path signature, so one fixture exercises two detectors. */
const CANNED_STACK_TRACE = [
  "Traceback (most recent call last):",
  '  File "/var/www/app/handlers.py", line 42, in create_user',
  "    return db.execute(query)",
  'psycopg2.errors.SyntaxError: syntax error at or near "FROM"',
].join("\n");

interface ValidationBody {
  name?: unknown;
  age?: unknown;
  role?: unknown;
}

/**
 * Validates the `/validation` fixture's body against the same rules its
 * OpenAPI description declares.
 *
 * This is what makes contract-aware negative testing demonstrable end to end
 * (spec §20, §44): the specification says `name` is a required string of 2-50
 * characters, `age` an integer in [18, 120], `role` one of two values — and
 * this function enforces exactly that. A generated "send age = 17" test
 * therefore gets a real 400 from a real server, not a stubbed one.
 */
function validateFixtureBody(body: ValidationBody): string | null {
  if (typeof body !== "object" || body === null) return "body must be an object";

  if (body.name === undefined) return "name is required";
  if (typeof body.name !== "string") return "name must be a string";
  if (body.name.length < 2) return "name must be at least 2 characters";
  if (body.name.length > 50) return "name must be at most 50 characters";

  if (body.age === undefined) return "age is required";
  if (typeof body.age !== "number" || !Number.isInteger(body.age)) return "age must be an integer";
  if (body.age < 18) return "age must be at least 18";
  if (body.age > 120) return "age must be at most 120";

  if (body.role !== undefined) {
    if (typeof body.role !== "string") return "role must be a string";
    if (body.role !== "admin" && body.role !== "user") return "role must be one of: admin, user";
  }

  return null;
}

export function registerSecurityFixtures(app: FastifyInstance): void {
  // -------------------------------------------------------------------
  // /auth-required — authentication negative tests (spec §12)
  // -------------------------------------------------------------------
  app.route({
    method: ["GET", "POST"],
    url: "/__security/auth-required",
    handler: async (request, reply) => {
      const header = request.headers.authorization;
      const apiKey = (request.query as { api_key?: string } | undefined)?.api_key;

      if (header === undefined && apiKey === undefined) {
        return reply.status(401).send({ error: "authentication required" });
      }
      if (apiKey !== undefined) {
        return apiKey === FIXTURE_VALID_API_KEY
          ? reply.status(200).send({ ok: true, authenticated: true })
          : reply.status(401).send({ error: "invalid api key" });
      }
      // Never echo the supplied credential back — that would make this
      // fixture trip the engine's own sensitive-header detector and turn a
      // passing test into a confusing warning.
      return header === `Bearer ${FIXTURE_VALID_TOKEN}`
        ? reply.status(200).send({ ok: true, authenticated: true })
        : reply.status(401).send({ error: "invalid credential" });
    },
  });

  // -------------------------------------------------------------------
  // /verbose-error — information disclosure (spec §18) and robustness (§19)
  // -------------------------------------------------------------------
  app.route({
    method: ["GET", "POST"],
    url: "/__security/verbose-error",
    handler: async (_request, reply) => {
      reply.header("Content-Type", "text/plain");
      return reply.status(500).send(CANNED_STACK_TRACE);
    },
  });

  // -------------------------------------------------------------------
  // /sensitive-response — sensitive-data exposure (spec §14)
  // -------------------------------------------------------------------
  app.route({
    method: ["GET"],
    url: "/__security/sensitive-response",
    handler: async (_request, reply) =>
      reply.status(200).send({
        id: 1,
        username: "ada",
        // Fixture values, deliberately self-describing. Nothing here
        // authenticates anything anywhere.
        password: "fixture-value-not-a-real-password",
        accessToken: "fixture-value-not-a-real-token",
        profile: { apiKey: "fixture-value-not-a-real-key" },
      }),
  });

  // -------------------------------------------------------------------
  // /security-headers — configurable header checks (spec §15)
  // -------------------------------------------------------------------
  app.route({
    method: ["GET"],
    url: "/__security/security-headers",
    handler: async (request, reply) => {
      // `?omit=1` returns the same body with no security headers, so one
      // fixture covers both the present and the missing case.
      const omit = (request.query as { omit?: string } | undefined)?.omit === "1";

      if (!omit) {
        reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        reply.header("Strict-Transport-Security", "max-age=31536000");
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Referrer-Policy", "no-referrer");
        reply.header("Cache-Control", "no-store");
        reply.header("X-Frame-Options", "DENY");
      }

      return reply.status(200).send({ ok: true, headers: omit ? "omitted" : "present" });
    },
  });

  // -------------------------------------------------------------------
  // /cors — CORS configuration checks (spec §17)
  // -------------------------------------------------------------------
  app.route({
    method: ["GET"],
    url: "/__security/cors",
    handler: async (request, reply) => {
      // `?safe=1` returns the ordinary public-API configuration. The default
      // returns the one genuinely dangerous combination: wildcard origin with
      // credentials enabled. These headers override the server's global CORS
      // hook, which is why the fixture sets them explicitly here.
      const safe = (request.query as { safe?: string } | undefined)?.safe === "1";

      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Credentials", safe ? "false" : "true");

      return reply.status(200).send({ ok: true, cors: safe ? "safe" : "wildcard-with-credentials" });
    },
  });

  // -------------------------------------------------------------------
  // /validation — contract-aware negative testing target (spec §20, §44)
  // -------------------------------------------------------------------
  app.route({
    method: ["POST"],
    url: "/__security/validation",
    handler: async (request, reply) => {
      // Fastify has already rejected a body that is not parseable JSON with a
      // 400, which is exactly the controlled rejection the malformed-JSON
      // mutation expects (spec §19).
      const error = validateFixtureBody((request.body ?? {}) as ValidationBody);

      if (error !== null) {
        // A controlled, generic client-facing error — deliberately the
        // *opposite* of /verbose-error. Nothing internal is disclosed.
        return reply.status(400).send({ error: "validation failed", detail: error });
      }

      return reply.status(201).send({ id: 1, created: true });
    },
  });
}
