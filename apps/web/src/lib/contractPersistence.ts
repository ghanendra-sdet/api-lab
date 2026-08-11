import {
  deserializeContracts,
  serializeContracts,
  type ContractWorkspace,
} from "@api-lab/contract-engine";
import { debounce } from "./debounce";

/**
 * Persistence for attached OpenAPI specifications.
 *
 * A dedicated storage key rather than a field inside the workspace envelope,
 * for the same reason environments got their own in Milestone 4: a
 * specification is a sibling concept to a collection, not part of one, and
 * the two will not evolve on the same schema timeline. Bundling them would
 * couple two unrelated migration paths.
 *
 * Storage note: specification documents are stored in plaintext in
 * localStorage, exactly like every other API Lab artifact. A specification is
 * an API description, not a credential — but a private, unpublished
 * specification is still information, and users should understand it lives in
 * the browser profile. See docs/SECURITY.md.
 */

const CONTRACTS_KEY = "api-lab-contracts";
const DEBOUNCE_MS = 400;

export type LoadContractsResult =
  | { status: "empty" }
  | { status: "ok"; data: ContractWorkspace }
  | { status: "error"; detail: string };

export function loadContractsFromStorage(): LoadContractsResult {
  if (typeof window === "undefined") return { status: "empty" };
  const raw = window.localStorage.getItem(CONTRACTS_KEY);
  if (raw === null) return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", detail: "Saved contract data is not valid JSON." };
  }

  const result = deserializeContracts(parsed);
  if (!result.ok) return { status: "error", detail: result.detail };
  return { status: "ok", data: result.contracts };
}

function writeContractsNow(data: ContractWorkspace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONTRACTS_KEY, JSON.stringify(serializeContracts(data)));
  } catch {
    // Quota exceeded or storage unavailable. A specification can be several
    // megabytes, so this is a realistic outcome rather than a theoretical
    // one — the in-memory contract still works for this session, it just
    // won't survive a reload. Not worth interrupting the user's work.
  }
}

export const saveContractsToStorage = debounce(writeContractsNow, DEBOUNCE_MS);

export function resetContractsStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CONTRACTS_KEY);
}
