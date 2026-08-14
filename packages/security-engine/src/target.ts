/**
 * Target classification and confirmation (spec §30).
 *
 * ## Why this exists
 *
 * Every other feature in API Lab sends a request the user typed. Milestone 12
 * is the first that sends requests the *tool* composed, up to a hundred of
 * them, some of which deliberately omit credentials or send malformed
 * bodies. Doing that to your own mock server is a Tuesday. Doing it to a
 * production host — or to someone else's host, because a variable resolved
 * differently than expected — is at best an incident and at worst
 * unauthorized activity.
 *
 * The mitigation is deliberately low-tech and deliberately not bypassable by
 * the engine: classify the resolved target, and require the *caller* to have
 * obtained explicit confirmation naming the host before a non-local run
 * starts. `assertTargetConfirmed` makes that a precondition of execution
 * rather than a UI courtesy, so an automated caller cannot skip the check by
 * not rendering a dialog.
 *
 * ## What this is not
 *
 * It is not an authorization system and does not pretend to be one. API Lab
 * cannot know whether a user is permitted to test a host; only the user
 * knows that. What it can do is refuse to make that decision *silently* on
 * the user's behalf, and name the host plainly so a misresolved variable is
 * caught by a human before a hundred requests leave the machine.
 */

export type TargetScope = "local" | "remote" | "invalid";

export interface TargetClassification {
  scope: TargetScope;
  /** Hostname alone, e.g. "api.example.com". Empty when scope is "invalid". */
  host: string;
  /** Host plus port and scheme, for display in the confirmation dialog. */
  origin: string;
  protocol: "http:" | "https:" | "other";
  /** True when the run must not start without explicit user confirmation. */
  requiresConfirmation: boolean;
}

/**
 * Loopback and link-local names. Only these are frictionless (spec §30) —
 * everything else, including a private RFC 1918 address, prompts.
 *
 * Private-range addresses are deliberately treated as remote. `10.0.0.5` is
 * very often a shared staging server or a colleague's machine, and "it's on
 * the internal network" has never been a reason it was fine to fire a
 * hundred malformed requests at it unannounced.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(normalized)) return true;
  // The whole 127.0.0.0/8 block, not just 127.0.0.1.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) return true;
  // `.localhost` is reserved for loopback by RFC 6761.
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  return false;
}

export function classifyTarget(rawUrl: string): TargetClassification {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { scope: "invalid", host: "", origin: "", protocol: "other", requiresConfirmation: true };
  }

  const protocol = url.protocol === "http:" || url.protocol === "https:" ? url.protocol : "other";

  // A non-HTTP scheme is not something this engine knows how to reason about,
  // and defaulting an unknown scheme to "local" would be exactly the wrong
  // direction to fail in.
  if (protocol === "other") {
    return { scope: "invalid", host: url.hostname, origin: url.origin, protocol, requiresConfirmation: true };
  }

  const scope: TargetScope = isLoopback(url.hostname) ? "local" : "remote";

  return {
    scope,
    host: url.hostname,
    origin: url.origin,
    protocol,
    requiresConfirmation: scope !== "local",
  };
}

export type TargetGateResult = { ok: true } | { ok: false; reason: string; classification: TargetClassification };

/**
 * The execution precondition. `confirmedHost` is whatever host the user was
 * actually shown and actually approved.
 *
 * Comparing the approved host against the resolved host — rather than
 * trusting a boolean "the user confirmed" flag — is the point of the whole
 * function. It means an approval for `staging.example.com` cannot be reused
 * for a run that, after variable resolution, is aimed at
 * `api.example.com`.
 */
export function assertTargetConfirmed(rawUrl: string, confirmedHost: string | null): TargetGateResult {
  const classification = classifyTarget(rawUrl);

  if (classification.scope === "invalid") {
    return {
      ok: false,
      reason: "The target URL is not a valid HTTP or HTTPS address. Security tests are not sent to targets that cannot be classified.",
      classification,
    };
  }

  if (!classification.requiresConfirmation) return { ok: true };

  if (confirmedHost === null) {
    return {
      ok: false,
      reason: `Security testing against ${classification.host} requires explicit confirmation. Only loopback targets run without a prompt.`,
      classification,
    };
  }

  if (confirmedHost.toLowerCase() !== classification.host.toLowerCase()) {
    return {
      ok: false,
      reason: `The confirmed host (${confirmedHost}) does not match the resolved target host (${classification.host}). Re-confirm before running.`,
      classification,
    };
  }

  return { ok: true };
}

/**
 * Every distinct target host in a set of resolved requests.
 *
 * A run spanning two hosts must confirm both. Confirming the first request's
 * host and silently inheriting that approval for the rest is precisely the
 * hole a per-run boolean flag would leave open.
 */
export function collectTargetHosts(urls: string[]): string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    const classification = classifyTarget(url);
    if (classification.host !== "") hosts.add(classification.host);
  }
  return [...hosts].sort();
}
