import {
  BrowserFetchExecutor,
  buildRequest,
  validateJsonBody,
  validateUrl,
  type ApiResponseResult,
  type BuiltRequest,
  type ValidationError,
} from "@api-lab/request-engine";
import { buildVariableContext, buildVariableContextFromVariables, resolveRequestConfig, type Environment } from "@api-lab/environment-engine";
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
import { resolveInheritedAuth } from "./authInheritance";
import { resolveAssertions } from "./resolveAssertions";
import { buildContractRequestInput } from "./contractAdapt";
import { runScript, type ScriptResult } from "@api-lab/script-engine";

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
  preRequestScriptResult?: ScriptResult;
  postResponseScriptResult?: ScriptResult;
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
  /**
   * Global variables (the Zustand store's `globals`, D.1 Step 4) — lowest
   * precedence of the seven layers `mergeResolutionContext` merges. See
   * @api-lab/runner-engine's `ResolutionScopes`/`mergeResolutionContext` for
   * the full seven-layer precedence order this participates in.
   */
  global?: Record<string, string>;
  /** The containing Collection's own variables (D.1 Step 5), if resolvable. */
  collection?: Record<string, string>;
  /** The containing Folder's own variables (D.1 Step 5), if the request lives in one. */
  folder?: Record<string, string>;
  /** Variables extracted by earlier requests in this run/iteration. */
  runtime?: Record<string, string>;
  /** The current dataset row, if the caller is running a data-driven iteration. */
  iteration?: Record<string, string>;
  delayMs?: number;
  /**
   * The containing Folder's/Collection's *auth* config (D.1 Step 5),
   * already concrete (not itself further resolved) — consulted only when
   * the request's own `config.auth` is `{type:"inherit"}`. See
   * `authInheritance.ts`'s `resolveInheritedAuth` for the algorithm. The
   * request's own `variables` (the "request" scope in the seven-layer
   * chain) come from `config.variables` directly, since `config` already
   * varies per step of a dependency chain — no separate scope field is
   * needed for it here.
   */
  folderAuth?: AuthConfig;
  collectionAuth?: AuthConfig;
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
    global: scopes.global ?? {},
    environment: buildVariableContext(scopes.environment),
    collection: scopes.collection ?? {},
    folder: scopes.folder ?? {},
    request: buildVariableContextFromVariables(config.variables),
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

  // D.1 Step 5: resolve `{type:"inherit"}` against the containing
  // Folder/Collection *before* variable interpolation, so a Bearer token
  // inherited from the Collection still gets its `{{token}}` resolved
  // exactly like a request's own auth would.
  const inheritedAuth = resolveInheritedAuth(config.auth, scopes.folderAuth, scopes.collectionAuth);

  const authResolution = resolveAuthConfig(inheritedAuth, context);
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
    // `resolveInheritedAuth` never returns `{type:"inherit"}` (see its
    // docstring/cycle-guard); the `=== "inherit"` fallback is defensive only
    // — the AuthConfig union still includes "inherit" at the type level.
    authType: inheritedAuth.type === "inherit" ? "none" : inheritedAuth.type,
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
  const currentRuntime = { ...(scopes.runtime ?? {}) };
  let preRequestScriptResult: ScriptResult | undefined;

  // 1. Run Pre-request Script
  if (config.preRequestScript && config.preRequestScript.trim() !== "") {
    const environmentVars = scopes.environment ? buildVariableContext(scopes.environment) : {};
    const mergedVars = { ...environmentVars, ...currentRuntime, ...(scopes.iteration ?? {}) };

    preRequestScriptResult = await runScript(config.preRequestScript, {
      variables: mergedVars,
      request: {
        url: config.url,
        method: config.method,
        headers: config.headers.reduce((acc, row) => {
          if (row.enabled) acc[row.key] = row.value;
          return acc;
        }, {} as Record<string, string>),
        body: config.bodyRawContent
      }
    });

    if (preRequestScriptResult.status === "success" && preRequestScriptResult.variables) {
      for (const [key, value] of Object.entries(preRequestScriptResult.variables)) {
        if (mergedVars[key] !== value) {
          currentRuntime[key] = value;
        }
      }
    } else if (preRequestScriptResult.status === "error" || preRequestScriptResult.status === "timeout") {
      // Pre-request script failure stops execution
      return { ok: true, preRequestScriptResult };
    }
  }

  const preparation = prepareRequest(requestId, requestName, config, {
    ...scopes,
    runtime: currentRuntime
  });
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
      return { ok: true, contractResult: preflight, preRequestScriptResult };
    }
  }

  const response = await executor.execute(built, { signal });

  // 2. Run Post-response Script
  let postResponseScriptResult: ScriptResult | undefined;
  if (config.postResponseScript && config.postResponseScript.trim() !== "") {
    const environmentVars = scopes.environment ? buildVariableContext(scopes.environment) : {};
    const mergedVars = { ...environmentVars, ...currentRuntime, ...(scopes.iteration ?? {}) };

    postResponseScriptResult = await runScript(config.postResponseScript, {
      variables: mergedVars,
      request: {
        url: built.url,
        method: built.method,
        headers: built.headers,
        body: built.body ? String(built.body) : undefined
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        rawBody: response.rawBody,
        duration: response.duration,
        size: response.size ?? 0
      }
    });

    if (postResponseScriptResult.status === "success" && postResponseScriptResult.variables) {
      for (const [key, value] of Object.entries(postResponseScriptResult.variables)) {
        if (mergedVars[key] !== value) {
          currentRuntime[key] = value;
        }
      }
    }
  }

  const finalContext = {
    ...context,
    ...currentRuntime
  };

  const resolvedAssertions = resolveAssertions(config.tests, finalContext);
  const assertionResults = evaluateAssertions(resolvedAssertions, response);
  const testResult = buildTestResult(requestId, requestName, response.duration, assertionResults, response.error ?? undefined);

  const { variables: extractedVariables, results: extractionResults } = extractAll(config.extractions, response);

  // Merge script-extracted runtime variables into extractedVariables
  const finalExtractedVariables = {
    ...currentRuntime,
    ...extractedVariables
  };

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

  return {
    ok: true,
    response,
    testResult,
    extractedVariables: finalExtractedVariables,
    extractionResults,
    contractResult,
    preRequestScriptResult,
    postResponseScriptResult
  };
}
