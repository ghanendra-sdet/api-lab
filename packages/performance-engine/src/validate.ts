import {
  MAX_DURATION_SECONDS,
  MAX_RAMP_UP_SECONDS,
  MAX_REQUESTS_PER_ITERATION,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_TARGET_RPS,
  MAX_THINK_TIME_MS,
  MAX_TOTAL_REQUESTS,
  MAX_VIRTUAL_USERS,
  type PerformanceTestConfig,
  type PerfThreshold,
} from "./types.ts";

export interface PerfValidationError {
  field:
    | "target"
    | "virtualUsers"
    | "durationSeconds"
    | "rampUpSeconds"
    | "targetRps"
    | "requestTimeoutMs"
    | "thinkTimeMs"
    | "thresholds"
    | "requests";
  message: string;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Validates a performance configuration against the safety limits (spec
 * §24: "the UI must reject unreasonable configurations"). Returns EVERY
 * problem rather than the first, so a user fixing a form sees all of it at
 * once. Called by the web UI before starting AND by the worker's control
 * plane on receipt — the browser is not trusted to be the only gate,
 * because the worker's HTTP API is reachable independently of the UI.
 */
export function validatePerformanceConfig(config: PerformanceTestConfig): PerfValidationError[] {
  const errors: PerfValidationError[] = [];

  if (!config.targetId) {
    errors.push({ field: "target", message: "Select a request or collection to test." });
  }

  if (!isPositiveInteger(config.virtualUsers) || config.virtualUsers > MAX_VIRTUAL_USERS) {
    errors.push({
      field: "virtualUsers",
      message: `Virtual users must be a whole number between 1 and ${MAX_VIRTUAL_USERS}.`,
    });
  }

  if (!isPositiveInteger(config.durationSeconds) || config.durationSeconds > MAX_DURATION_SECONDS) {
    errors.push({
      field: "durationSeconds",
      message: `Duration must be a whole number of seconds between 1 and ${MAX_DURATION_SECONDS}.`,
    });
  }

  if (!Number.isInteger(config.rampUpSeconds) || config.rampUpSeconds < 0 || config.rampUpSeconds > MAX_RAMP_UP_SECONDS) {
    errors.push({
      field: "rampUpSeconds",
      message: `Ramp-up must be a whole number of seconds between 0 and ${MAX_RAMP_UP_SECONDS}.`,
    });
  } else if (config.rampUpSeconds >= config.durationSeconds) {
    // A ramp that never finishes within the test window means the
    // configured concurrency is never actually reached — that is a
    // misconfiguration, not a valid load profile.
    errors.push({
      field: "rampUpSeconds",
      message: "Ramp-up must be shorter than the total duration, or the target concurrency is never reached.",
    });
  }

  if (config.loadModel === "rate") {
    if (!isPositiveInteger(config.targetRps) || config.targetRps > MAX_TARGET_RPS) {
      errors.push({
        field: "targetRps",
        message: `Target request rate must be a whole number between 1 and ${MAX_TARGET_RPS} requests/sec.`,
      });
    }
  }

  if (!isPositiveInteger(config.requestTimeoutMs) || config.requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS) {
    errors.push({
      field: "requestTimeoutMs",
      message: `Request timeout must be between 1 and ${MAX_REQUEST_TIMEOUT_MS} ms.`,
    });
  }

  if (!Number.isInteger(config.thinkTimeMs) || config.thinkTimeMs < 0 || config.thinkTimeMs > MAX_THINK_TIME_MS) {
    errors.push({ field: "thinkTimeMs", message: `Think time must be between 0 and ${MAX_THINK_TIME_MS} ms.` });
  }

  for (const threshold of config.thresholds) {
    const error = validateThreshold(threshold);
    if (error) {
      errors.push({ field: "thresholds", message: error });
      break;
    }
  }

  return errors;
}

export function validateThreshold(threshold: PerfThreshold): string | null {
  if (!Number.isFinite(threshold.value) || threshold.value < 0) {
    return `Threshold value for ${threshold.metric} must be a non-negative number.`;
  }
  if (threshold.metric === "errorRate" && threshold.value > 100) {
    return "Error-rate thresholds are a percentage and cannot exceed 100.";
  }
  return null;
}

/**
 * The worst-case number of requests a configuration can issue, used to
 * reject runs that would exceed MAX_TOTAL_REQUESTS before any traffic is
 * generated. Intentionally an upper bound: it assumes a zero-latency system
 * under test (the theoretical maximum), so the check is conservative.
 *
 * In concurrency mode the bound is unbounded in principle (a 0ms endpoint
 * lets a VU loop indefinitely), so the run-time counter in the worker — not
 * this estimate — is the real enforcement point. This function exists to
 * catch the obviously-impossible rate-mode configurations up front.
 */
export function estimateMaxRequests(config: PerformanceTestConfig): number | null {
  if (config.loadModel !== "rate") return null;
  return config.targetRps * config.durationSeconds;
}

export function validateRequestCount(requestCount: number): PerfValidationError | null {
  if (requestCount <= 0) {
    return { field: "requests", message: "The selected target contains no requests to run." };
  }
  if (requestCount > MAX_REQUESTS_PER_ITERATION) {
    return {
      field: "requests",
      message: `A performance target may contain at most ${MAX_REQUESTS_PER_ITERATION} requests.`,
    };
  }
  return null;
}

export function validateTotalRequestBudget(config: PerformanceTestConfig, requestCount: number): PerfValidationError | null {
  const estimate = estimateMaxRequests(config);
  if (estimate !== null && estimate * requestCount > MAX_TOTAL_REQUESTS) {
    return {
      field: "targetRps",
      message: `This configuration could issue more than the ${MAX_TOTAL_REQUESTS.toLocaleString()} request safety limit. Lower the rate or the duration.`,
    };
  }
  return null;
}

/**
 * Target safety (spec §37, §38). API Lab only ever loads a URL the user
 * explicitly configured on a saved request. This check is the last gate:
 * the scheme must be http/https, and the URL must parse. There is no
 * discovery, no scanning, no host enumeration, and no range expansion
 * anywhere in this package — by construction, not by policy.
 */
export function validateTargetUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `"${url}" is not a valid absolute URL.`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Only http and https targets can be load tested (got "${parsed.protocol}").`;
  }
  return null;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Whether a target is the developer's own machine. Used solely to decide
 * whether to show the "you are about to generate real traffic" confirmation
 * (spec §39) — local mock-server testing should not nag on every run, while
 * anything else must be explicitly acknowledged.
 */
export function isLocalTarget(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** True when ANY target URL in the run leaves the local machine. */
export function requiresProductionWarning(urls: readonly string[]): boolean {
  return urls.some((url) => !isLocalTarget(url));
}
