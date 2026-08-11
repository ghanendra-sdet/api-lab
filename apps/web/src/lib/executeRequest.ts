import {
  BrowserFetchExecutor,
  buildRequest,
  validateJsonBody,
  validateUrl,
  type ApiResponseResult,
  type ValidationError,
} from "@api-lab/request-engine";
import { buildVariableContext, resolveRequestConfig, type Environment } from "@api-lab/environment-engine";
import { applyAuth, validateAuthConfig } from "@api-lab/auth-engine";
import { evaluateAssertions, buildTestResult, type TestResult } from "@api-lab/test-engine";
import type { RequestConfig } from "@api-lab/workspace-engine";
import { resolveAuthConfig } from "./authResolve";

/** Shared, stateless HTTP transport — used by both the request-tab "Send"
 * path and the Collection Runner, so there is exactly one execution
 * pipeline (resolve variables → resolve/validate/apply auth → validate →
 * build → execute → evaluate assertions), not two that could drift. */
const executor = new BrowserFetchExecutor();

export interface ExecuteRequestResult {
  ok: boolean;
  validationError?: ValidationError;
  response?: ApiResponseResult;
  testResult?: TestResult;
}

/**
 * Resolves, validates, sends, and asserts against one request config, fully
 * independent of any open tab's state — this is the isolation the
 * Collection Runner needs (see docs/ARCHITECTURE.md's Milestone 7 section):
 * calling this never reads or writes `tabs`, `responses`, or any other
 * tab-scoped store state. The caller decides what to do with the result.
 */
export async function executeRequestConfig(
  requestId: string,
  requestName: string,
  config: RequestConfig,
  activeEnvironment: Environment | undefined,
  signal?: AbortSignal,
): Promise<ExecuteRequestResult> {
  const context = buildVariableContext(activeEnvironment);

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
        message: `Unresolved variable${resolution.unresolvedVariables.length > 1 ? "s" : ""}: ${resolution.unresolvedVariables.join(", ")}. Select an environment that defines ${resolution.unresolvedVariables.length > 1 ? "them" : "it"}, or remove the reference.`,
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

  const response = await executor.execute(built, { signal });

  const assertionResults = evaluateAssertions(config.tests, response);
  const testResult = buildTestResult(requestId, requestName, response.duration, assertionResults, response.error ?? undefined);

  return { ok: true, response, testResult };
}
