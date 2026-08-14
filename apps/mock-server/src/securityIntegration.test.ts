import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefaultGenerationExpectations,
  generateNegativeTests,
  runSecurityTests,
  summarizeSecurityRun,
  type GeneratorCategories,
  type SecurityExecutor,
  type SecurityRequestInput,
  type SecurityResponseInput,
} from "@api-lab/security-engine";
import { buildMockServer } from "./server.ts";
import { FIXTURE_VALID_TOKEN } from "./securityFixtures.ts";
import { makeSecurityOperation } from "./securityTestSupport.ts";

/**
 * Milestone 12 integration tests (spec §44).
 *
 * The real `@api-lab/security-engine` driving real HTTP against the real
 * Milestone 9 mock server — an actual Fastify instance on an actual TCP port,
 * exercised through the global `fetch`. Never `.inject()`, never a stubbed
 * transport, matching the convention `server.test.ts` established.
 *
 * That matters more here than elsewhere. The engine's whole job is to observe
 * what a server actually did with a mutated request; a mocked transport would
 * be testing the engine against the test author's beliefs about HTTP rather
 * than against HTTP.
 */

let baseUrl: string;
let dataDir: string;
let close: () => Promise<void>;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "security-integration-"));
  const app = buildMockServer({ dataFile: join(dataDir, "routes.json") });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  close = () => app.close();
});

afterAll(async () => {
  await close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** A real HTTP transport for the engine, built on the platform `fetch`. */
const executor: SecurityExecutor = {
  async send(request: SecurityRequestInput): Promise<SecurityResponseInput> {
    const started = Date.now();
    const headers: Record<string, string> = {};
    for (const header of request.headers) headers[header.name] = header.value;

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        responseHeaders[name] = value;
      });

      return {
        status: response.status,
        headers: responseHeaders,
        rawBody: await response.text(),
        durationMs: Date.now() - started,
        error: null,
      };
    } catch (error) {
      return {
        status: null,
        headers: {},
        rawBody: "",
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : "request failed",
      };
    }
  },
};

function request(overrides: Partial<SecurityRequestInput> = {}): SecurityRequestInput {
  return {
    method: "POST",
    url: `${baseUrl}/__security/validation`,
    headers: [{ name: "Content-Type", value: "application/json" }],
    query: [],
    body: JSON.stringify({ name: "Ada", age: 36, role: "admin" }),
    contentType: "application/json",
    pathTemplate: undefined,
    auth: { kind: "none" },
    ...overrides,
  };
}

const NO_CATEGORIES: GeneratorCategories = {
  missingRequiredFields: false,
  invalidTypes: false,
  nullValues: false,
  emptyValues: false,
  boundaryValues: false,
  invalidEnums: false,
  malformedJson: false,
  invalidContentType: false,
  missingAuthentication: false,
  invalidAuthentication: false,
};

async function run(tests: ReturnType<typeof generateNegativeTests>["tests"], target = request()) {
  return runSecurityTests({
    tests,
    resolveRequest: () => target,
    executor,
    confirmedHosts: [],
    sleep: () => Promise.resolve(),
  });
}

// ---------------------------------------------------------------------------
// Contract-aware negative testing (spec §20, §44)
// ---------------------------------------------------------------------------

describe("contract-aware negative testing against the real fixture", () => {
  it("generates required-field tests that the real server rejects with 400", async () => {
    const generated = generateNegativeTests({
      targets: [
        {
          requestId: "r1",
          requestName: "Create user",
          request: request(),
          operation: makeSecurityOperation(),
          components: undefined,
        },
      ],
      categories: { ...NO_CATEGORIES, missingRequiredFields: true },
    });

    expect(generated.tests.length).toBeGreaterThan(0);

    const outcome = await run(generated.tests);

    expect(outcome.status).toBe("completed");
    // The server really returns 400 for a missing required field, and the
    // engine's expectation really matches it.
    expect(outcome.results.every((result) => result.status === "passed")).toBe(true);
    expect(outcome.results.every((result) => result.actualStatus === 400)).toBe(true);
  });

  it("generates type mutations the real server rejects", async () => {
    const generated = generateNegativeTests({
      targets: [{ requestId: "r1", requestName: "Create user", request: request(), operation: makeSecurityOperation(), components: undefined }],
      categories: { ...NO_CATEGORIES, invalidTypes: true },
    });

    const outcome = await run(generated.tests);
    const bodyTests = outcome.results.filter((result) => result.requestMutation.location === "request.body");

    expect(bodyTests.length).toBeGreaterThan(0);
    expect(bodyTests.every((result) => result.actualStatus === 400)).toBe(true);
  });

  it("generates an enum mutation the real server rejects", async () => {
    const generated = generateNegativeTests({
      targets: [{ requestId: "r1", requestName: "Create user", request: request(), operation: makeSecurityOperation(), components: undefined }],
      categories: { ...NO_CATEGORIES, invalidEnums: true },
    });

    const outcome = await run(generated.tests);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]!.status).toBe("passed");
    expect(outcome.results[0]!.actualStatus).toBe(400);
  });

  it("crosses declared boundaries in both directions and gets the right answer each way", async () => {
    // The strongest single assertion in this file: `minimum - 1` must be
    // rejected and `minimum` must be accepted, and the engine expects the
    // opposite outcomes for the two without the caller telling it which.
    const generated = generateNegativeTests({
      targets: [{ requestId: "r1", requestName: "Create user", request: request(), operation: makeSecurityOperation(), components: undefined }],
      categories: { ...NO_CATEGORIES, boundaryValues: true },
    });

    const outcome = await run(generated.tests);

    const belowMinimum = outcome.results.find((result) => result.requestMutation.description.includes("minimum - 1"))!;
    const atMinimum = outcome.results.find((result) => result.requestMutation.description.includes("minimum (18)"))!;

    expect(belowMinimum.actualStatus).toBe(400);
    expect(belowMinimum.status).toBe("passed");

    expect(atMinimum.actualStatus).toBe(201);
    expect(atMinimum.status).toBe("passed");
  });

  it("sends a malformed body the real server rejects without a 500", async () => {
    // Spec §19: malformed input must produce a controlled error.
    const generated = generateNegativeTests({
      targets: [{ requestId: "r1", requestName: "Create user", request: request(), operation: makeSecurityOperation(), components: undefined }],
      categories: { ...NO_CATEGORIES, malformedJson: true },
    });

    const outcome = await run(generated.tests);
    expect(outcome.results[0]!.actualStatus).toBe(400);
    expect(outcome.results[0]!.status).toBe("passed");
  });
});

// ---------------------------------------------------------------------------
// Authentication (spec §12, §44)
// ---------------------------------------------------------------------------

describe("authentication fixtures", () => {
  // Built lazily: `baseUrl` is only assigned in beforeAll, which runs *after*
  // this describe body evaluates.
  const authedRequest = (): SecurityRequestInput =>
    request({
      method: "GET",
      url: `${baseUrl}/__security/auth-required`,
      body: undefined,
      headers: [{ name: "Authorization", value: `Bearer ${FIXTURE_VALID_TOKEN}` }],
      auth: { kind: "header", name: "Authorization", scheme: "bearer" },
    });

  it("returns 401 when the credential is removed", async () => {
    const generated = generateNegativeTests({
      targets: [{ requestId: "r1", requestName: "Get profile", request: authedRequest(), operation: undefined, components: undefined }],
      categories: { ...NO_CATEGORIES, missingAuthentication: true },
    });

    const outcome = await run(generated.tests, authedRequest());

    expect(outcome.results[0]!.actualStatus).toBe(401);
    expect(outcome.results[0]!.status).toBe("passed");
    expect(outcome.results[0]!.category).toBe("security");
  });

  it("returns 401 for invalid, expired and malformed tokens", async () => {
    const generated = generateNegativeTests({
      targets: [{ requestId: "r1", requestName: "Get profile", request: authedRequest(), operation: undefined, components: undefined }],
      categories: { ...NO_CATEGORIES, invalidAuthentication: true },
    });

    const outcome = await run(generated.tests, authedRequest());

    expect(outcome.results).toHaveLength(3);
    expect(outcome.results.every((result) => result.actualStatus === 401)).toBe(true);
    expect(outcome.results.every((result) => result.status === "passed")).toBe(true);
  });

  it("never transmits the real credential in a mutated request", async () => {
    // The mutated request must carry only fixed constants from credentials.ts.
    const generated = generateNegativeTests({
      targets: [{ requestId: "r1", requestName: "Get profile", request: authedRequest(), operation: undefined, components: undefined }],
      categories: { ...NO_CATEGORIES, invalidAuthentication: true },
    });

    expect(JSON.stringify(generated.tests)).not.toContain(FIXTURE_VALID_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// Response checks (spec §14, §15, §17, §18, §44)
// ---------------------------------------------------------------------------

describe("response security checks against real fixtures", () => {
  async function probe(path: string, expectedOverrides: Record<string, unknown> = {}) {
    const target = request({ method: "GET", url: `${baseUrl}${path}`, body: undefined });
    const tests = [
      {
        id: "t1",
        name: "probe",
        category: "security" as const,
        targetRequestId: "r1",
        targetRequestName: "probe",
        mutation: {
          location: "request.header" as const,
          operation: "set-content-type" as const,
          target: "X-Probe",
          value: { kind: "text" as const, text: "1" },
          description: "probe",
        },
        expected: {
          statusCodes: [],
          statusClasses: [],
          forbidServerError: false,
          forbidInformationDisclosure: false,
          forbidSensitiveData: false,
          requiredSecurityHeaders: [] as string[],
          checkCors: false,
          checkTransport: false,
          ...expectedOverrides,
        },
        enabled: true,
        metadata: { source: "manual" as const, ruleId: "probe", operationId: undefined, createdAt: "2026-01-01T00:00:00.000Z" },
      },
    ];
    return run(tests, target);
  }

  it("detects verbose error disclosure and reports it as a failure", async () => {
    const outcome = await probe("/__security/verbose-error", { forbidInformationDisclosure: true });
    const result = outcome.results[0]!;

    expect(result.status).toBe("failed");
    expect(result.findings.some((finding) => finding.rule.endsWith("stack-trace"))).toBe(true);
    expect(result.findings.some((finding) => finding.rule.endsWith("database-error"))).toBe(true);
    expect(result.findings.some((finding) => finding.rule.endsWith("internal-path"))).toBe(true);
  });

  it("flags the 500 from the verbose-error fixture as a robustness failure", async () => {
    const outcome = await probe("/__security/verbose-error", { forbidServerError: true });
    expect(outcome.results[0]!.findings.some((finding) => finding.rule === "security.robustness.server-error")).toBe(true);
  });

  it("detects sensitive fields without recording their values", async () => {
    const outcome = await probe("/__security/sensitive-response", { forbidSensitiveData: true });
    const result = outcome.results[0]!;

    expect(result.status).toBe("failed");
    expect(result.findings.map((finding) => finding.location).sort()).toEqual([
      "response.body/accessToken",
      "response.body/password",
      "response.body/profile/apiKey",
    ]);
    expect(JSON.stringify(result)).not.toContain("fixture-value-not-a-real-password");
  });

  it("passes configured security-header checks when the headers are present", async () => {
    const outcome = await probe("/__security/security-headers", {
      requiredSecurityHeaders: ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy"],
    });
    expect(outcome.results[0]!.status).toBe("passed");
  });

  it("fails configured security-header checks when the headers are omitted", async () => {
    const outcome = await probe("/__security/security-headers?omit=1", {
      requiredSecurityHeaders: ["Content-Security-Policy"],
    });
    expect(outcome.results[0]!.status).toBe("failed");
    expect(outcome.results[0]!.findings[0]!.rule).toBe("security.response.missing-security-header");
  });

  it("flags wildcard CORS combined with credentials", async () => {
    const outcome = await probe("/__security/cors", { checkCors: true });
    const result = outcome.results[0]!;

    expect(result.status).toBe("failed");
    expect(result.findings.some((finding) => finding.rule === "security.cors.wildcard-with-credentials")).toBe(true);
    expect(result.findings.find((finding) => finding.rule === "security.cors.wildcard-with-credentials")!.severity).toBe("high");
  });

  it("does not flag the safe CORS configuration", async () => {
    const outcome = await probe("/__security/cors?safe=1", { checkCors: true });
    expect(outcome.results[0]!.status).not.toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Run-level behaviour
// ---------------------------------------------------------------------------

describe("run summary", () => {
  it("summarises a mixed run", async () => {
    const generated = generateNegativeTests({
      targets: [{ requestId: "r1", requestName: "Create user", request: request(), operation: makeSecurityOperation(), components: undefined }],
      categories: { ...NO_CATEGORIES, missingRequiredFields: true, invalidTypes: true, boundaryValues: true },
      expectations: createDefaultGenerationExpectations(),
    });

    const outcome = await run(generated.tests);
    const summary = summarizeSecurityRun(outcome.results);

    expect(summary.total).toBe(outcome.results.length);
    expect(summary.passed + summary.failed + summary.warnings + summary.errors + summary.skipped).toBe(summary.total);
  });
});
