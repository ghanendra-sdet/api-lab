import { extractRequestPath, resolveOperation } from "./operationMatch.ts";
import { validateRequestAgainstOperation, type ContractRequestInput } from "./validateRequest.ts";
import { validateResponseAgainstOperation, type ContractResponseInput } from "./validateResponse.ts";
import type {
  ContractModel,
  ContractValidationResult,
  ContractViolation,
  OperationMatchResult,
} from "./types.ts";

/**
 * The single orchestration point for contract validation (spec §22).
 *
 * Resolution happens once and is shared by the request and response phases,
 * so a request validated before sending and its response validated afterwards
 * are always judged against the same operation — they cannot drift apart.
 */

function nowMs(): number {
  // `performance` exists in browsers and in modern Node; `Date.now` is the
  // portable fallback. This package must not import anything Node-only.
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Turns a failed operation resolution into the violation that explains it. */
export function resolutionViolation(match: Exclude<OperationMatchResult, { status: "matched" }>): ContractViolation {
  if (match.status === "ambiguous") {
    return {
      location: "contract",
      path: "$",
      keyword: "operation",
      expected: "exactly one matching operation",
      actual: `${match.candidates.length} matching operations`,
      message: match.detail,
      severity: "error",
    };
  }

  if (match.status === "unknown-method") {
    return {
      location: "request.method",
      path: "$",
      keyword: "operation",
      expected: match.allowedMethods.join(", "),
      actual: "an undocumented method for this path",
      message: match.detail,
      severity: "error",
    };
  }

  return {
    location: "contract",
    path: "$",
    keyword: "operation",
    expected: "a documented operation",
    actual: "undocumented endpoint",
    message: match.detail,
    severity: "error",
  };
}

export interface ContractValidationOptions {
  /** Skip the request phase — used when only a received response is being checked. */
  skipRequest?: boolean;
  /** Skip the response phase — used for the pre-send check. */
  skipResponse?: boolean;
}

/**
 * Resolves the operation for a request without validating anything. Used by
 * the UI to show which operation a request maps to before it is ever sent.
 */
export function resolveOperationForRequest(
  contract: ContractModel,
  method: ContractRequestInput["method"],
  url: string,
): { match: OperationMatchResult; path: string } {
  const path = extractRequestPath(url, contract.servers);
  return { match: resolveOperation(contract, method, path), path };
}

/**
 * Validates a request and/or its response against a contract.
 *
 * `response` being undefined means "pre-send validation only". Passing both
 * validates the full exchange in one result, which is what the Send path and
 * the Collection Runner both do.
 */
export function validateContract(
  contract: ContractModel,
  request: ContractRequestInput,
  response: ContractResponseInput | undefined,
  options: ContractValidationOptions = {},
): ContractValidationResult {
  const start = nowMs();

  const match = resolveOperation(contract, request.method, request.path);

  if (match.status !== "matched") {
    // An unresolvable operation is reported once, as a request-side
    // violation, rather than being duplicated on both sides.
    return {
      valid: false,
      operation: null,
      requestViolations: [resolutionViolation(match)],
      responseViolations: [],
      warnings: [],
      durationMs: nowMs() - start,
    };
  }

  const operation = match.operation;
  const requestViolations: ContractViolation[] = [];
  const responseViolations: ContractViolation[] = [];
  const warnings: ContractViolation[] = [];

  if (!options.skipRequest) {
    const result = validateRequestAgainstOperation(contract, operation, request);
    requestViolations.push(...result.violations);
    warnings.push(...result.warnings);
  }

  if (!options.skipResponse && response !== undefined) {
    const result = validateResponseAgainstOperation(contract, operation, response);
    responseViolations.push(...result.violations);
    warnings.push(...result.warnings);
  }

  return {
    valid: requestViolations.length === 0 && responseViolations.length === 0,
    operation,
    requestViolations,
    responseViolations,
    // Warnings never affect `valid` — but they are always carried, never
    // dropped, so an unsupported check cannot hide behind a green PASS
    // (spec §23).
    warnings,
    durationMs: nowMs() - start,
  };
}

/** Convenience: the flat list of every error-severity violation. */
export function allViolations(result: ContractValidationResult): ContractViolation[] {
  return [...result.requestViolations, ...result.responseViolations];
}
