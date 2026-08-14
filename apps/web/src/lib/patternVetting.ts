import {
  PATTERN_VETTING_TIMEOUT_MS,
  clearContractCache,
  collectPatterns,
  parseSpecSource,
  registerPatternVerdicts,
  type PatternVerdict,
} from "@api-lab/contract-engine";
import type { VetPatternRequest, VetPatternResponse } from "../workers/patternVetting.worker";

/**
 * Host side of the ReDoS worker isolation (Milestone 12, spec §37).
 *
 * ## What this achieves that static screening cannot
 *
 * Milestone 11 screened patterns by shape and said, in its own comments, that
 * the check was conservative rather than a proof. Milestone 12 §37 requires
 * that to be strengthened, and specifically names worker isolation with a
 * hard timeout as the answer if regex evaluation "remains potentially
 * blocking". It does — see the worker file for why JavaScript offers no other
 * way to stop a running regex.
 *
 * So every pattern in an imported specification is executed **once**, against
 * adversarial probes, on a thread we are prepared to destroy. A pattern that
 * does not come back within `PATTERN_VETTING_TIMEOUT_MS` gets its worker
 * terminated and a `timeout` verdict registered, and `redos.ts` then refuses
 * it forever after. The UI thread never runs it at all.
 *
 * ## Pre-flight, not inline
 *
 * Vetting happens when a specification is imported or restored, not during
 * validation. Validation is synchronous and sits inside the request pipeline;
 * it cannot await a worker round-trip without making every Send asynchronous
 * on a subsystem most users never touch. Doing it once per document, up
 * front, costs a few milliseconds and leaves the hot path untouched.
 *
 * ## Graceful degradation
 *
 * Where `Worker` does not exist — jsdom unit tests, or any non-browser host —
 * this becomes a no-op and the two *static* layers still apply. That is a
 * deliberate weakening rather than a failure: the layers are independent, and
 * losing the dynamic one leaves exactly the Milestone 11 posture plus the new
 * complexity caps. It never leaves the application unprotected, and it never
 * throws.
 */

/** One vetting worker at a time. Patterns are cheap; workers are not, and a
 * pool would only add ways for a terminated worker to be reused by accident. */
let worker: Worker | null = null;

function createWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../workers/patternVetting.worker.ts", import.meta.url), { type: "module" });
  } catch {
    // A bundler or environment that cannot construct the worker must not take
    // the application down with it. Static screening remains in force.
    return null;
  }
}

function disposeWorker(): void {
  if (worker !== null) {
    worker.terminate();
    worker = null;
  }
}

/**
 * Vets one pattern with a hard timeout.
 *
 * The `terminate()` in the timeout path is the entire point of this module.
 * Resolving the promise is not enough — the worker would still be spinning,
 * consuming a core, and would still be there for the next pattern. It has to
 * be destroyed.
 */
function vetOne(pattern: string, id: number): Promise<PatternVerdict> {
  const active = worker;
  if (active === null) return Promise.resolve("safe");

  return new Promise<PatternVerdict>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Kill the thread. This is the only mechanism that stops a
      // catastrophically-backtracking regex.
      disposeWorker();
      worker = createWorker();
      resolve("timeout");
    }, PATTERN_VETTING_TIMEOUT_MS);

    const onMessage = (event: MessageEvent<VetPatternResponse>) => {
      if (settled || event.data.id !== id) return;
      settled = true;
      clearTimeout(timer);
      active.removeEventListener("message", onMessage);
      resolve(event.data.verdict);
    };

    active.addEventListener("message", onMessage);

    const message: VetPatternRequest = { id, pattern };
    active.postMessage(message);
  });
}

let nextId = 0;

export interface VettingSummary {
  vetted: number;
  timedOut: string[];
  unsafe: string[];
  /** True when no worker was available and only static screening applies. */
  degraded: boolean;
}

/**
 * Vets every pattern in a parsed specification document and registers the
 * verdicts with contract-engine.
 *
 * Safe to call repeatedly; the registry de-duplicates by pattern text.
 * Never throws — a vetting failure must not prevent a specification from
 * being imported, it must only mean the dynamic layer had nothing to say.
 */
export async function vetDocumentPatterns(raw: unknown): Promise<VettingSummary> {
  const patterns = collectPatterns(raw);
  const summary: VettingSummary = { vetted: 0, timedOut: [], unsafe: [], degraded: false };

  if (patterns.length === 0) return summary;

  worker = worker ?? createWorker();
  if (worker === null) {
    summary.degraded = true;
    return summary;
  }

  const verdicts: Array<{ pattern: string; verdict: PatternVerdict }> = [];

  for (const pattern of patterns) {
    nextId += 1;
    let verdict: PatternVerdict;
    try {
      verdict = await vetOne(pattern, nextId);
    } catch {
      // Treat an unexplained worker failure as a rejection rather than a
      // pass. Failing closed is the correct direction for a safety check.
      verdict = "timeout";
    }

    verdicts.push({ pattern, verdict });
    summary.vetted += 1;
    if (verdict === "timeout") summary.timedOut.push(pattern);
    if (verdict === "unsafe") summary.unsafe.push(pattern);
  }

  registerPatternVerdicts(verdicts);
  return summary;
}

/** Releases the worker. Called when the app tears down; also keeps tests from
 * leaking a live thread between suites. */
export function shutdownPatternVetting(): void {
  disposeWorker();
}

/**
 * Vets one specification's patterns and invalidates the contract parse cache
 * when anything was vetoed.
 *
 * The cache invalidation is load-bearing and easy to overlook. `parseContractCached`
 * keys on the source text, so a model built *before* a `timeout` verdict was
 * registered still contains the offending pattern — the normalization step
 * that strips unsafe patterns already ran. Without this clear, the newly
 * discovered verdict would have no effect until the text changed. Clearing is
 * cheap and only happens when a veto actually occurred.
 */
export async function vetSpecificationSource(source: string): Promise<VettingSummary> {
  const parsed = parseSpecSource(source);
  if (!parsed.ok) return { vetted: 0, timedOut: [], unsafe: [], degraded: false };

  const summary = await vetDocumentPatterns(parsed.raw);

  if (summary.timedOut.length > 0 || summary.unsafe.length > 0) {
    clearContractCache();
  }

  return summary;
}
