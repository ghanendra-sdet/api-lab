import { evaluateSecurityTest, skippedResult } from "./evaluate.ts";
import { MAX_EXECUTION_DURATION_MS, MAX_GENERATED_TESTS, REQUEST_INTERVAL_MS } from "./limits.ts";
import { applyMutation } from "./mutate.ts";
import { assertTargetConfirmed, collectTargetHosts } from "./target.ts";
import type {
  NegativeTest,
  SecurityRequestInput,
  SecurityResponseInput,
  SecurityRunStatus,
  SecurityTestResult,
} from "./types.ts";

/**
 * Bounded, sequential execution of a generated security suite (spec §29,
 * §30, §33, §35, §36).
 *
 * ## Sequential, on purpose
 *
 * Every request goes out one at a time with a small gap between them. That is
 * not a simplification — it is the architectural boundary spec §36 draws.
 * Milestone 10 owns load generation and does it properly, with a worker, a
 * ramp, and a concurrency model. If this loop fired its hundred tests
 * concurrently it would become a second, worse load generator that users
 * could point at production while believing they were running a functional
 * check. Keeping it strictly sequential means the traffic profile of a
 * security run is indistinguishable from a person clicking Send quickly.
 *
 * ## Runtime-only credential resolution
 *
 * `resolveRequest` is a callback, not a pre-resolved array. Spec §33 forbids
 * resolving or persisting credentials into generated test definitions, so the
 * request — with its environment values and its real credential — is
 * materialised here, per test, in memory, and never returned to the caller in
 * a persisted structure. The callback also lets M8 runtime variables flow in
 * (spec §35): the caller can chain a login, extract a token, and have every
 * subsequent resolution see it, with runtime state isolated per execution.
 *
 * ## Three independent stop conditions
 *
 * A run halts on cancellation, on exceeding `MAX_EXECUTION_DURATION_MS`, or
 * on exhausting the test list. Every test not executed is reported `skipped`
 * with a reason — never omitted, and never `passed`. A truncated run that
 * silently dropped its tail would report a clean bill of health for checks
 * that never ran.
 */

export interface SecurityExecutor {
  send(request: SecurityRequestInput, signal?: AbortSignal): Promise<SecurityResponseInput>;
}

export interface RunSecurityTestsInput {
  tests: NegativeTest[];
  /**
   * Materialises the *unmutated*, fully resolved request for a test. Returns
   * null when the request no longer exists (deleted between generation and
   * execution).
   */
  resolveRequest: (requestId: string) => SecurityRequestInput | null;
  executor: SecurityExecutor;
  /** Hosts the user explicitly approved in the confirmation dialog (spec §30). */
  confirmedHosts: string[];
  signal?: AbortSignal;
  onProgress?: (result: SecurityTestResult, completed: number, total: number) => void;
  /** Injectable clock and sleep, so tests do not spend real seconds waiting. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SecurityRunOutcome {
  status: SecurityRunStatus;
  results: SecurityTestResult[];
  /** Populated when the run was refused before sending anything. */
  refusedReason: string | undefined;
  durationMs: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pre-flight gate (spec §29, §30).
 *
 * Runs before a single request is sent and refuses the whole suite rather
 * than failing partway. A run that had already fired forty requests at an
 * unconfirmed host before noticing would have missed the point entirely.
 */
export function checkRunPreconditions(input: {
  tests: NegativeTest[];
  urls: string[];
  confirmedHosts: string[];
}): { ok: true } | { ok: false; reason: string } {
  if (input.tests.length === 0) {
    return { ok: false, reason: "No tests are selected." };
  }
  if (input.tests.length > MAX_GENERATED_TESTS) {
    return {
      ok: false,
      reason: `A security run is limited to ${MAX_GENERATED_TESTS} tests; ${input.tests.length} were supplied.`,
    };
  }

  const confirmed = new Set(input.confirmedHosts.map((host) => host.toLowerCase()));

  for (const url of input.urls) {
    // Every distinct host must be individually approved — see target.ts for
    // why a single per-run boolean would be the wrong shape.
    const host = collectTargetHosts([url])[0] ?? null;
    const gate = assertTargetConfirmed(url, host !== null && confirmed.has(host.toLowerCase()) ? host : null);
    if (!gate.ok) return { ok: false, reason: gate.reason };
  }

  return { ok: true };
}

export async function runSecurityTests(input: RunSecurityTestsInput): Promise<SecurityRunOutcome> {
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? defaultSleep;
  const startedAt = now();

  const enabled = input.tests.filter((test) => test.enabled);

  // Resolve every target up front purely to collect the hosts for the gate.
  // The resolved requests are deliberately *not* cached across the run: a
  // chained run (spec §35) expects later resolutions to see runtime variables
  // extracted by earlier ones.
  const urls: string[] = [];
  for (const test of enabled) {
    const resolved = input.resolveRequest(test.targetRequestId);
    if (resolved !== null) urls.push(resolved.url);
  }

  const preconditions = checkRunPreconditions({ tests: enabled, urls, confirmedHosts: input.confirmedHosts });
  if (!preconditions.ok) {
    return { status: "aborted", results: [], refusedReason: preconditions.reason, durationMs: now() - startedAt };
  }

  const results: SecurityTestResult[] = [];
  let stopped: "cancelled" | "timeout" | null = null;

  for (let index = 0; index < enabled.length; index++) {
    const test = enabled[index]!;

    if (input.signal?.aborted) {
      stopped = "cancelled";
    } else if (now() - startedAt > MAX_EXECUTION_DURATION_MS) {
      stopped = "timeout";
    }

    if (stopped !== null) {
      results.push(
        skippedResult(
          test,
          stopped === "cancelled"
            ? "The run was cancelled before this test executed."
            : `The run exceeded the ${MAX_EXECUTION_DURATION_MS / 60000}-minute execution limit before this test executed.`,
        ),
      );
      input.onProgress?.(results[results.length - 1]!, results.length, enabled.length);
      continue;
    }

    const resolved = input.resolveRequest(test.targetRequestId);
    if (resolved === null) {
      results.push(skippedResult(test, `The target request "${test.targetRequestName}" no longer exists.`));
      input.onProgress?.(results[results.length - 1]!, results.length, enabled.length);
      continue;
    }

    const mutated = applyMutation(resolved, test.mutation);
    if (!mutated.ok) {
      // A mutation that could not be applied is skipped, never sent. Sending
      // the unmutated request would produce a result evaluated against
      // expectations written for a mutation that never happened.
      results.push(skippedResult(test, mutated.detail));
      input.onProgress?.(results[results.length - 1]!, results.length, enabled.length);
      continue;
    }

    const origin = mutated.request.headers.find((header) => header.name.toLowerCase() === "origin")?.value;

    let response: SecurityResponseInput;
    try {
      response = await input.executor.send(mutated.request, input.signal);
    } catch (error) {
      response = {
        status: null,
        headers: {},
        rawBody: "",
        durationMs: 0,
        error: error instanceof Error ? error.message : "The request failed.",
      };
    }

    const result = evaluateSecurityTest({
      test,
      request: mutated.request,
      response,
      requestOrigin: origin,
    });
    for (const warning of mutated.warnings) result.warnings.push(warning);

    results.push(result);
    input.onProgress?.(result, results.length, enabled.length);

    if (index < enabled.length - 1) await sleep(REQUEST_INTERVAL_MS);
  }

  const status: SecurityRunStatus = stopped === "cancelled" ? "cancelled" : stopped === "timeout" ? "aborted" : "completed";

  return { status, results, refusedReason: undefined, durationMs: now() - startedAt };
}
