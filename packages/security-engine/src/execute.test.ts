import { describe, expect, it, vi } from "vitest";
import { checkRunPreconditions, runSecurityTests, type SecurityExecutor } from "./execute.ts";
import { makeRequest, makeResponse, makeTest } from "./testFixtures.ts";
import { MAX_EXECUTION_DURATION_MS, MAX_GENERATED_TESTS } from "./limits.ts";
import type { SecurityRequestInput } from "./types.ts";

function stubExecutor(overrides: Partial<SecurityExecutor> = {}): SecurityExecutor & { sent: SecurityRequestInput[] } {
  const sent: SecurityRequestInput[] = [];
  return {
    sent,
    async send(request) {
      sent.push(request);
      return makeResponse({ status: 400 });
    },
    ...overrides,
  } as SecurityExecutor & { sent: SecurityRequestInput[] };
}

const noSleep = () => Promise.resolve();

describe("checkRunPreconditions", () => {
  it("refuses an empty suite", () => {
    expect(checkRunPreconditions({ tests: [], urls: [], confirmedHosts: [] }).ok).toBe(false);
  });

  it("refuses more than MAX_GENERATED_TESTS", () => {
    const tests = Array.from({ length: MAX_GENERATED_TESTS + 1 }, () => makeTest());
    const result = checkRunPreconditions({ tests, urls: ["http://localhost/x"], confirmedHosts: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(String(MAX_GENERATED_TESTS));
  });

  it("allows a loopback target without confirmation", () => {
    expect(checkRunPreconditions({ tests: [makeTest()], urls: ["http://localhost:4010/x"], confirmedHosts: [] }).ok).toBe(true);
  });

  it("refuses an unconfirmed remote target", () => {
    const result = checkRunPreconditions({ tests: [makeTest()], urls: ["https://api.example.com/x"], confirmedHosts: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("api.example.com");
  });

  it("requires every distinct host to be confirmed, not just the first", () => {
    const result = checkRunPreconditions({
      tests: [makeTest()],
      urls: ["https://a.example.com/x", "https://b.example.com/x"],
      confirmedHosts: ["a.example.com"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("b.example.com");
  });
});

describe("runSecurityTests", () => {
  it("sends one request per enabled test", async () => {
    const executor = stubExecutor();
    const outcome = await runSecurityTests({
      tests: [makeTest({ id: "a" }), makeTest({ id: "b" })],
      resolveRequest: () => makeRequest(),
      executor,
      confirmedHosts: [],
      sleep: noSleep,
    });

    expect(outcome.status).toBe("completed");
    expect(executor.sent).toHaveLength(2);
    expect(outcome.results).toHaveLength(2);
  });

  it("skips disabled tests entirely", async () => {
    const executor = stubExecutor();
    await runSecurityTests({
      tests: [makeTest({ id: "a", enabled: false }), makeTest({ id: "b" })],
      resolveRequest: () => makeRequest(),
      executor,
      confirmedHosts: [],
      sleep: noSleep,
    });
    expect(executor.sent).toHaveLength(1);
  });

  it("sends nothing at all when the target gate refuses", async () => {
    // Refusing the whole suite rather than failing partway is the point: a
    // run that had already fired forty requests would have missed it.
    const executor = stubExecutor();
    const outcome = await runSecurityTests({
      tests: [makeTest()],
      resolveRequest: () => makeRequest({ url: "https://api.example.com/users" }),
      executor,
      confirmedHosts: [],
      sleep: noSleep,
    });

    expect(outcome.status).toBe("aborted");
    expect(executor.sent).toHaveLength(0);
    expect(outcome.refusedReason).toContain("api.example.com");
  });

  it("proceeds against a remote host once confirmed", async () => {
    const executor = stubExecutor();
    const outcome = await runSecurityTests({
      tests: [makeTest()],
      resolveRequest: () => makeRequest({ url: "https://api.example.com/users" }),
      executor,
      confirmedHosts: ["api.example.com"],
      sleep: noSleep,
    });
    expect(outcome.status).toBe("completed");
    expect(executor.sent).toHaveLength(1);
  });

  it("skips — never sends — a test whose mutation cannot be applied", async () => {
    const executor = stubExecutor();
    const outcome = await runSecurityTests({
      tests: [makeTest({ mutation: { location: "request.body", operation: "remove", target: "/absent", value: { kind: "none" }, description: "x" } })],
      resolveRequest: () => makeRequest(),
      executor,
      confirmedHosts: [],
      sleep: noSleep,
    });

    expect(executor.sent).toHaveLength(0);
    expect(outcome.results[0]!.status).toBe("skipped");
  });

  it("skips a test whose target request no longer exists", async () => {
    const outcome = await runSecurityTests({
      tests: [makeTest()],
      resolveRequest: () => null,
      executor: stubExecutor(),
      confirmedHosts: [],
      sleep: noSleep,
    });
    expect(outcome.results[0]!.status).toBe("skipped");
    expect(outcome.results[0]!.detail).toContain("no longer exists");
  });

  it("resolves the request per test so chained runtime variables are visible", async () => {
    // Spec §35: a login earlier in the run must be visible to later tests.
    const resolveRequest = vi.fn(() => makeRequest());
    await runSecurityTests({
      tests: [makeTest({ id: "a" }), makeTest({ id: "b" })],
      resolveRequest,
      executor: stubExecutor(),
      confirmedHosts: [],
      sleep: noSleep,
    });
    // Twice for the host pre-scan, twice again during execution.
    expect(resolveRequest.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("converts an executor throw into an error result rather than crashing the run", async () => {
    const outcome = await runSecurityTests({
      tests: [makeTest()],
      resolveRequest: () => makeRequest(),
      executor: { send: () => Promise.reject(new Error("network down")) },
      confirmedHosts: [],
      sleep: noSleep,
    });
    expect(outcome.results[0]!.status).toBe("error");
    expect(outcome.results[0]!.detail).toBe("network down");
  });

  it("marks remaining tests as skipped when cancelled", async () => {
    const controller = new AbortController();
    const executor = stubExecutor({
      async send() {
        controller.abort();
        return makeResponse({ status: 400 });
      },
    } as Partial<SecurityExecutor>);

    const outcome = await runSecurityTests({
      tests: [makeTest({ id: "a" }), makeTest({ id: "b" }), makeTest({ id: "c" })],
      resolveRequest: () => makeRequest(),
      executor,
      confirmedHosts: [],
      signal: controller.signal,
      sleep: noSleep,
    });

    expect(outcome.status).toBe("cancelled");
    // Every unexecuted test is reported, never silently omitted.
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results.filter((result) => result.status === "skipped")).toHaveLength(2);
  });

  it("stops at the execution time limit and reports the rest as skipped", async () => {
    let clock = 0;
    const outcome = await runSecurityTests({
      tests: [makeTest({ id: "a" }), makeTest({ id: "b" })],
      resolveRequest: () => makeRequest(),
      executor: stubExecutor(),
      confirmedHosts: [],
      sleep: noSleep,
      now: () => {
        // First call establishes the start; then jump past the limit.
        const value = clock;
        clock = MAX_EXECUTION_DURATION_MS + 1;
        return value;
      },
    });

    expect(outcome.status).toBe("aborted");
    expect(outcome.results.every((result) => result.status === "skipped")).toBe(true);
    expect(outcome.results[0]!.detail).toContain("execution limit");
  });

  it("reports progress for every test including skipped ones", async () => {
    const seen: string[] = [];
    await runSecurityTests({
      tests: [makeTest({ id: "a" }), makeTest({ id: "b" })],
      resolveRequest: () => makeRequest(),
      executor: stubExecutor(),
      confirmedHosts: [],
      sleep: noSleep,
      onProgress: (result) => seen.push(result.status),
    });
    expect(seen).toHaveLength(2);
  });

  it("pauses between requests rather than firing them concurrently", async () => {
    // Spec §36: a security run must not become a second load generator.
    const sleep = vi.fn(() => Promise.resolve());
    await runSecurityTests({
      tests: [makeTest({ id: "a" }), makeTest({ id: "b" }), makeTest({ id: "c" })],
      resolveRequest: () => makeRequest(),
      executor: stubExecutor(),
      confirmedHosts: [],
      sleep,
    });
    // One pause between each adjacent pair, none after the last.
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
