import type { ExpectedBehavior, StatusClass } from "../types.ts";

/**
 * The tester's configurable expectations, applied to every generated test
 * (spec §12).
 *
 * ## Why these are settings and not constants
 *
 * Spec §12 is explicit: "Expected behavior must be user-configurable (e.g.
 * expected 401 or 403 — don't assume every API uses the same semantics)."
 * That is not a nicety. Three defensible answers exist for an unauthenticated
 * request to a protected resource:
 *
 * - **401** — the textbook answer: you are not authenticated.
 * - **403** — common where the framework authenticates first and authorizes
 *   second, and equally common as a deliberate simplification.
 * - **404** — deliberately returned by APIs that refuse to confirm whether a
 *   resource exists to an unauthenticated caller. This is *stronger*
 *   security, and a tool that failed it would be punishing good practice.
 *
 * Hardcoding 401 would mean generating false failures on two of those three,
 * which is how a security tool teaches its users to ignore it.
 *
 * The defaults below are the common case, not the truth, and every one of
 * them is overridable from the generator UI.
 */
export interface GenerationExpectations {
  /** Statuses accepted when a deliberately invalid request is sent. */
  invalidInputStatusCodes: number[];
  invalidInputStatusClasses: StatusClass[];
  /** Statuses accepted when the credential is removed or invalid. */
  authFailureStatusCodes: number[];
  authFailureStatusClasses: StatusClass[];
  /** Statuses accepted for an on-boundary (legal) value — see values.ts. */
  validInputStatusClasses: StatusClass[];
  /** Response headers every generated test requires (spec §15). Empty by default. */
  requiredSecurityHeaders: string[];
  forbidSensitiveData: boolean;
  checkCors: boolean;
  checkTransport: boolean;
}

export function createDefaultGenerationExpectations(): GenerationExpectations {
  return {
    // 400 and 422 both, because "which one means invalid body?" is a genuine
    // and unresolved disagreement between frameworks.
    invalidInputStatusCodes: [400, 422],
    invalidInputStatusClasses: ["4xx"],
    // 401 and 403 both, for the reason in the file header. 404 is *not* a
    // default — an API that returns it is doing something deliberate, and the
    // tester should say so explicitly rather than have the tool assume it.
    authFailureStatusCodes: [401, 403],
    authFailureStatusClasses: [],
    validInputStatusClasses: ["2xx"],
    requiredSecurityHeaders: [],
    forbidSensitiveData: false,
    checkCors: false,
    checkTransport: false,
  };
}

function shared(expectations: GenerationExpectations): Pick<
  ExpectedBehavior,
  "forbidInformationDisclosure" | "forbidSensitiveData" | "requiredSecurityHeaders" | "checkCors" | "checkTransport"
> {
  return {
    // Always on. A stack trace is never the intended response to a malformed
    // request, and unlike a status code there is no API convention under
    // which returning one is correct.
    forbidInformationDisclosure: true,
    forbidSensitiveData: expectations.forbidSensitiveData,
    requiredSecurityHeaders: [...expectations.requiredSecurityHeaders],
    checkCors: expectations.checkCors,
    checkTransport: expectations.checkTransport,
  };
}

/** Expectation for a request that was deliberately made invalid. */
export function expectInvalidInput(expectations: GenerationExpectations): ExpectedBehavior {
  return {
    statusCodes: [...expectations.invalidInputStatusCodes],
    statusClasses: [...expectations.invalidInputStatusClasses],
    forbidServerError: true,
    ...shared(expectations),
  };
}

/** Expectation for a request whose credential was removed or replaced. */
export function expectAuthFailure(expectations: GenerationExpectations): ExpectedBehavior {
  return {
    statusCodes: [...expectations.authFailureStatusCodes],
    statusClasses: [...expectations.authFailureStatusClasses],
    forbidServerError: true,
    ...shared(expectations),
  };
}

/**
 * Expectation for an on-boundary value that the contract declares legal.
 *
 * `forbidServerError` stays true here too — a 500 on a value the API's own
 * schema permits is a bug regardless of which side of the boundary it sits.
 */
export function expectValidInput(expectations: GenerationExpectations): ExpectedBehavior {
  return {
    statusCodes: [],
    statusClasses: [...expectations.validInputStatusClasses],
    forbidServerError: true,
    ...shared(expectations),
  };
}
