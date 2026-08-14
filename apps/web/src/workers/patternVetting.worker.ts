import { evaluatePatternSafety } from "@api-lab/contract-engine";

/**
 * The isolated pattern-vetting worker (Milestone 12, spec §37).
 *
 * ## Why this file is four lines of logic
 *
 * It is deliberately trivial, because its value is not in what it does but in
 * *where it runs*. JavaScript cannot interrupt a regular expression — there
 * is no timeout on `RegExp.test`, no cancellation, no yield point. Once a
 * catastrophically-backtracking pattern starts, the thread executing it is
 * unavailable until it finishes, which for the `^(a+)+$` case Milestone 11
 * measured was sixty seconds.
 *
 * The only thing in the platform that can stop it is `Worker.terminate()`,
 * and that only works if the regex is running on a thread we are willing to
 * throw away. That is this thread. If a pattern posted here never produces a
 * reply, the host terminates this worker and records a `timeout` verdict; the
 * UI thread never even attempts the match.
 *
 * Nothing else belongs in here. The worker must stay disposable — no state
 * the host would miss, no side effects, no work batched up that would be lost
 * when it is killed mid-pattern.
 */

export interface VetPatternRequest {
  id: number;
  pattern: string;
}

export interface VetPatternResponse {
  id: number;
  pattern: string;
  verdict: "safe" | "unsafe";
}

self.onmessage = (event: MessageEvent<VetPatternRequest>) => {
  const { id, pattern } = event.data;

  // `evaluatePatternSafety` is the only function in contract-engine that
  // executes an untrusted regex, and this is the only place it is called.
  const verdict = evaluatePatternSafety(pattern);

  const response: VetPatternResponse = {
    id,
    pattern,
    // The pure evaluator can only return "safe" or "unsafe"; a "timeout"
    // verdict is something only the host can observe, by not hearing back.
    verdict: verdict === "unsafe" ? "unsafe" : "safe",
  };

  (self as unknown as { postMessage: (message: VetPatternResponse) => void }).postMessage(response);
};
