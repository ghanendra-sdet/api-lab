import type { AuthMutationKind, AuthPlacement, GeneratorCategories } from "../types.ts";
import type { TestDraft } from "./draft.ts";
import { expectAuthFailure, type GenerationExpectations } from "./expectations.ts";

/**
 * Authentication negative tests (spec §12, §34).
 *
 * ## Reusing Milestone 5, not reimplementing it
 *
 * Spec §34 says to use the existing auth engine and not create a second
 * authentication implementation. This module honours that by never
 * *constructing* a credential: `AuthPlacement` describes where M5's
 * `applyAuth` already put the real one, and the mutations only ever remove
 * it or overwrite it with a fixed constant from credentials.ts.
 *
 * That is also why the real credential never appears in a generated test
 * definition (spec §33). The definition says "replace whatever is in the
 * Authorization header with the invalid-token constant"; it does not, and
 * cannot, contain the token being replaced. Resolution happens at execution
 * time, in memory, per run.
 *
 * ## Why authorization testing stops where it does
 *
 * Spec §13 permits a controlled authorization test using a *second,
 * explicitly supplied* resource identifier, and forbids enumerating resource
 * ids. This milestone therefore generates **no** authorization tests
 * automatically: there is no safe way to invent another user's resource id,
 * and any id API Lab guessed would either be meaningless or be exactly the
 * enumeration §13 rules out. The supported workflow is the tester saving a
 * second request pointing at a resource they own but are not authenticated
 * for, and generating auth tests against that — which this module handles
 * with no special casing, because from its point of view it is just another
 * target request.
 */

/** Ordered so the most diagnostic test comes first if the budget truncates. */
const INVALID_AUTH_KINDS: AuthMutationKind[] = ["invalid-token", "expired-token", "malformed-token"];

export interface AuthGenerationInput {
  auth: AuthPlacement;
  categories: GeneratorCategories;
  expectations: GenerationExpectations;
  /** Label for test names, e.g. "GET /users/{id}" or the request's name. */
  label: string;
  operationId: string | undefined;
}

export function generateAuthTests(input: AuthGenerationInput): { drafts: TestDraft[]; warnings: string[] } {
  const { auth, categories, expectations, label } = input;
  const drafts: TestDraft[] = [];
  const warnings: string[] = [];

  if (auth.kind === "none") {
    if (categories.missingAuthentication || categories.invalidAuthentication) {
      warnings.push(
        `${label} has no authentication configured, so no authentication tests were generated. Configure auth on the request first.`,
      );
    }
    return { drafts, warnings };
  }

  const isApiKey = auth.kind === "query" || (auth.kind === "header" && auth.scheme === "raw");

  // --- Missing credential (spec §12) ------------------------------------
  if (categories.missingAuthentication) {
    const kind: AuthMutationKind = isApiKey && auth.kind === "query" ? "missing-api-key" : "none";
    drafts.push({
      name: `${label} — no authentication`,
      category: "security",
      mutation: {
        location: "request.auth",
        operation: "set-invalid-auth",
        target: "",
        value: { kind: "auth", auth: kind },
        description: isApiKey ? "remove the API key entirely" : "remove the credential entirely",
      },
      expected: expectAuthFailure(expectations),
      ruleId: "security.auth.missing",
      operationId: input.operationId,
      warning: undefined,
    });
  }

  // --- Invalid credential (spec §12) -------------------------------------
  if (categories.invalidAuthentication) {
    if (isApiKey) {
      drafts.push({
        name: `${label} — wrong API key`,
        category: "security",
        mutation: {
          location: "request.auth",
          operation: "set-invalid-auth",
          target: "",
          value: { kind: "auth", auth: "wrong-api-key" },
          description: "replace the API key with a fixed non-authentic value",
        },
        expected: expectAuthFailure(expectations),
        ruleId: "security.auth.wrong-api-key",
        operationId: input.operationId,
        warning: undefined,
      });
      return { drafts, warnings };
    }

    for (const kind of INVALID_AUTH_KINDS) {
      // An expired-JWT test against Basic auth would be nonsense — there is
      // no expiry to violate — so it is only generated for bearer schemes.
      if (kind === "expired-token" && auth.kind === "header" && auth.scheme !== "bearer") continue;

      drafts.push({
        name: `${label} — ${kind.replace(/-/g, " ")}`,
        category: "security",
        mutation: {
          location: "request.auth",
          operation: "set-invalid-auth",
          target: "",
          value: { kind: "auth", auth: kind },
          description:
            kind === "invalid-token"
              ? "replace the credential with a fixed non-authentic value"
              : kind === "expired-token"
                ? "replace the credential with a structurally valid but long-expired JWT"
                : "replace the credential with a value that is not a well-formed token",
        },
        expected: expectAuthFailure(expectations),
        ruleId: `security.auth.${kind}`,
        operationId: input.operationId,
        warning: undefined,
      });
    }
  }

  return { drafts, warnings };
}
