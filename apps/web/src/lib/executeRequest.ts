import {
  BrowserFetchExecutor,
  buildRequest,
  validateJsonBody,
  validateUrl,
  type ApiResponseResult,
  type BuiltRequest,
  type ValidationError,
} from "@api-lab/request-engine";
import { buildVariableContext, resolveRequestConfig, type Environment } from "@api-lab/environment-engine";
import { applyAuth, validateAuthConfig, type AuthConfig } from "@api-lab/auth-engine";
import { evaluateAssertions, buildTestResult, type TestResult } from "@api-lab/test-engine";
import { extractAll, mergeResolutionContext, type ExtractionResult } from "@api-lab/runner-engine";
import {
  validateContract,
  type ContractModel,
  type ContractValidationResult,
} from "@api-lab/contract-engine";
import type { RequestConfig } from "@api-lab/workspace-engine";
import type { KeyValueRow } from "@api-lab/shared";
import { resolveAuthConfig } from "./authResolve";
import { resolveAssertions } from "./resolveAssertions";
import { buildContractRequestInput } from "./contractAdapt";

/** Shared, stateless HTTP transport — used by both the request-tab "Send"
 * path and the Collection Runner, so there is exactly one execution
 * pipeline (resolve variables → resolve/validate/apply auth → validate →
 * build → execute → evaluate assertions → extract), not two that could
 * drift. */
const executor = new BrowserFetchExecutor();

export interface ExecuteRequestResult {
  ok: boolean;
  validationError?: ValidationError;
  response?: ApiResponseResult;
  testResult?: TestResult;
  /** Successfully extracted runtime variables (name → value) — the caller
   * (tab Send or the Runner) decides how long these live. Never persisted. */
  extractedVariables?: Record<string, string>;
  extractionResults?: ExtractionResult[];
  /**
   * Contract validation outcome, present only when a contract was supplied.
   * Kept entirely separate from `testResult` so a contract violation is never
   * collapsed into an ordinary assertion failure (spec §29).
   */
  contractResult?: ContractValidationResult;
}

/**
 * Contract validation settings for one execution (spec §28, §7).
 *
 * Two independent switches, matching the two things the milestone asks for:
 *
 * - `validateResponse` is the ordinary "[✓] Validate against contract" case:
 *   send as usual, then check what came back.
 * - `validateRequestBeforeSend` is the pre-flight check. Spec §12 is explicit
 *   that when request validation is enabled an invalid request "must fail
 *   before sending", so enabling it *blocks* the request rather than
 *   reporting after the fact. It is off by default, because silently
 *   refusing to send would be a surprising default for a tool whose job is
 *   sending requests.
 */
export interface ContractExecutionOptions {
  contract: ContractModel;
  validateResponse: boolean;
  validateRequestBeforeSend: boolean;
}

export interface ExecutionScopes {
  environment?: Environment;
  /** Variables extracted by earlier requests in this run/iteration. */
  runtime?: Record<string, string>;
  /** The current dataset row, if the caller is running a data-driven iteration. */
  iteration?: Record<string, string>;
}

/**
 * The shared front half of the execution pipeline: resolve variables →
 * resolve/validate/apply auth → validate → build.
 *
 * Extracted in Milestone 12 so security testing composes the *same* pipeline
 * rather than reimplementing it. A second copy of this sequence would be a
 * correctness problem waiting to happen: if the two drifted, a security test
 * would be mutating and sending a request materially different from the one
 * Send and the Runner produce, and every result it reported would be about a
 * request the user never configured.
 *
 * Returns either the built request plus the intermediate values later stages
 * need, or the same typed `ValidationError` the caller already handles.
 */
export interface PreparedRequest {
  context: Record<string, string>;
  built: BuiltRequest;
  /** Query params after auth was applied — the contract and security
   * adapters both need these separately from the URL. */
  params: KeyValueRow[];
  /** The auth config after variable resolution. Never persisted. */
  resolvedAuth: AuthConfig;
}

export function prepareRequest(
  requestId: string,
  requestName: string,
  config: RequestConfig,
  scopes: ExecutionScopes,
): { ok: true; prepared: PreparedRequest } | { ok: false; validationError: ValidationError } {
  const context = mergeResolutionContext({
    environment: buildVariableContext(scopes.environment),
    runtime: scopes.runtime ?? {},
    iteration: scopes.iteration ?? {},
  });

  const resolution = resolveRequestConfig(
    { url: config.url, params: config.params, headers: config.headers, bodyRawContent: config.bodyRawContent },
    context,
  );

  if (resolution.hasCircularReference) {
    return {
      ok: false,
      validationError: {
        field: "variables",
        message: "Circular variable reference detected. Fix the environment's variable values before sending.",
      },
    };
  }
  if (resolution.unresolvedVariables.length > 0) {
    return {
      ok: false,
      validationError: {
        field: "variables",
        message: `Unresolved variable${resolution.unresolvedVariables.length > 1 ? "s" : ""}: ${resolution.unresolvedVariables.join(", ")}. Select an environment/dataset that defines ${resolution.unresolvedVariables.length > 1 ? "them" : "it"}, or remove the reference.`,
      },
    };
  }

  const resolved = resolution.resolved;

  const authResolution = resolveAuthConfig(config.auth, context);
  if (authResolution.hasCircularReference) {
    return {
      ok: false,
      validationError: { field: "variables", message: "Circular variable reference detected in the authorization configuration." },
    };
  }
  if (authResolution.unresolvedVariables.length > 0) {
    return {
      ok: false,
      validationError: {
        field: "variables",
        message: `Unresolved variable${authResolution.unresolvedVariables.length > 1 ? "s" : ""} in authorization: ${authResolution.unresolvedVariables.join(", ")}.`,
      },
    };
  }

  const authError = validateAuthConfig(authResolution.resolved);
  if (authError) return { ok: false, validationError: authError };

  const withAuth = applyAuth(authResolution.resolved, resolved.headers, resolved.params);

  const urlError = validateUrl(resolved.url);
  if (urlError) return { ok: false, validationError: urlError };

  const bodyError = validateJsonBody(config.bodyMode, config.bodyRawFormat, resolved.bodyRawContent);
  if (bodyError) return { ok: false, validationError: bodyError };

  const built = buildRequest({
    id: requestId,
    name: requestName,
    method: config.method,
    url: resolved.url,
    queryParams: withAuth.params,
    headers: withAuth.headers,
    authType: config.auth.type,
    bodyMode: config.bodyMode,
    bodyRawFormat: config.bodyRawFormat,
    bodyRawContent: resolved.bodyRawContent,
  });

  return { ok: true, prepared: { context, built, params: withAuth.params, resolvedAuth: authResolution.resolved } };
}

/**
 * Resolves, validates, sends, asserts, and extracts for one request config,
 * fully independent of any open tab's state — this is the isolation the
 * Collection Runner needs (see docs/ARCHITECTURE.md's Milestone 7/8
 * sections): calling this never reads or writes `tabs`, `responses`, or any
 * other tab-scoped store state. The caller decides what to do with the
 * result, including whether extracted variables feed into a later call.
 */
export async function executeRequestConfig(
  requestId: string,
  requestName: string,
  config: RequestConfig,
  scopes: ExecutionScopes,
  signal?: AbortSignal,
  contractOptions?: ContractExecutionOptions,
): Promise<ExecuteRequestResult> {
  const preparation = prepareRequest(requestId, requestName, config, scopes);
  if (!preparation.ok) return { ok: false, validationError: preparation.validationError };

  const { context, built, params: withAuthParams } = preparation.prepared;

  // ---------------------------------------------------------------------
  // Contract validation (Milestone 11)
  //
  // Positioned here deliberately. Everything above has already resolved
  // variables, applied authorization, and built the final request, so the
  // contract is checked against what will actually go on the wire — never
  // against an unresolved `{{userId}}` placeholder, which spec §31 forbids.
  // ---------------------------------------------------------------------
  const contractRequestInput = contractOptions
    ? buildContractRequestInput(
        contractOptions.contract,
        config.method,
        built.url,
        built.headers,
        withAuthParams,
        built.body,
      )
    : null;

  if (contractOptions?.validateRequestBeforeSend && contractRequestInput) {
    const preflight = validateContract(contractOptions.contract, contractRequestInput, undefined, {
      skipResponse: true,
    });
    if (preflight.requestViolations.length > 0) {
      // Spec §12: an invalid request fails *before* being sent. Reported as
      // an ordinary execution outcome carrying the contract result, so the
      // caller renders violations rather than a bare error string.
      return { ok: true, contractResult: preflight };
    }
  }

  const response = await executor.execute(built, { signal });

  const resolvedAssertions = resolveAssertions(config.tests, context);
  const assertionResults = evaluateAssertions(resolvedAssertions, response);
  const testResult = buildTestResult(requestId, requestName, response.duration, assertionResults, response.error ?? undefined);

  const { variables: extractedVariables, results: extractionResults } = extractAll(config.extractions, response);

  let contractResult: ContractValidationResult | undefined;
  if (contractOptions && contractRequestInput) {
    contractResult = validateContract(
      contractOptions.contract,
      contractRequestInput,
      contractOptions.validateResponse
        ? { status: response.status, headers: response.headers, rawBody: response.rawBody }
        : undefined,
      { skipRequest: !contractOptions.validateRequestBeforeSend },
    );
  }

  return { ok: true, response, testResult, extractedVariables, extractionResults, contractResult };
}
