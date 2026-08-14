import {
  deserializeSecurity,
  serializeSecurity,
  type SecurityWorkspace,
} from "@api-lab/security-engine";
import { debounce } from "./debounce";

/**
 * Persistence for generated negative tests.
 *
 * A dedicated storage key, matching the Milestone 4/9/10/11 precedent
 * (environments, mock routes, performance config, contracts each own theirs):
 * security tests are a sibling concept to a collection, not part of one, and
 * bundling them would couple two unrelated migration paths.
 *
 * ## What is deliberately not stored (spec §40)
 *
 * Only test *definitions*. No results, no findings, no responses, no request
 * bodies, no resolved variables, no credentials.
 *
 * That is a conclusion of the Milestone 12 persistence audit rather than an
 * oversight. A security report is the artifact in this product most likely to
 * be copied somewhere careless, and the definitions are the only part of it
 * that is credential-free by construction — a `NegativeTest` holds a request
 * *id*, and a `Mutation` can only name a fixed constant from the engine's
 * `credentials.ts`, never a resolved value. Results are session-scoped in
 * memory and are gone on reload, which is the correct default for data whose
 * value decays in minutes and whose sensitivity does not.
 */

const SECURITY_KEY = "api-lab-security";
const DEBOUNCE_MS = 400;

export type LoadSecurityResult =
  | { status: "empty" }
  | { status: "ok"; data: SecurityWorkspace }
  | { status: "error"; detail: string };

export function loadSecurityFromStorage(): LoadSecurityResult {
  if (typeof window === "undefined") return { status: "empty" };
  const raw = window.localStorage.getItem(SECURITY_KEY);
  if (raw === null) return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", detail: "Saved security test data is not valid JSON." };
  }

  const result = deserializeSecurity(parsed);
  if (!result.ok) return { status: "error", detail: result.detail };
  return { status: "ok", data: result.security };
}

function writeSecurityNow(data: SecurityWorkspace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SECURITY_KEY, JSON.stringify(serializeSecurity(data)));
  } catch {
    // Quota exceeded or storage unavailable. The in-memory suite still works
    // for this session; it just will not survive a reload. Not worth
    // interrupting the user's work over.
  }
}

export const saveSecurityToStorage = debounce(writeSecurityNow, DEBOUNCE_MS);

export function resetSecurityStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SECURITY_KEY);
}
