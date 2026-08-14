import {
  deserializeDocumentation,
  serializeDocumentation,
  type DocumentationWorkspace,
} from "@api-lab/documentation-engine";
import { debounce } from "./debounce";

/**
 * Persistence for documentation configurations (spec §42).
 *
 * A dedicated storage key, matching the Milestone 4/9/10/11/12 precedent
 * (environments, mock routes, performance config, contracts, security tests
 * each own theirs): a documentation configuration is a sibling concept to a
 * collection, not part of one, and bundling them would couple two unrelated
 * migration paths.
 *
 * ## What is deliberately not stored
 *
 * Only configuration: which specification, which collection, which format,
 * which sections, which grouping. No generated HTML, no generated Markdown,
 * no documentation model, no examples, no response bodies.
 *
 * Spec §42 requires this, and the practical reason is that cached output goes
 * stale against its own specification the moment somebody edits the spec — and
 * a stale documentation page that still *looks* authoritative is worse than no
 * page at all. Regenerating from the model, and the model from the source, is
 * cheap enough (measured in tens of milliseconds for the specifications this
 * tool handles) that caching would buy nothing and cost correctness.
 *
 * A useful consequence: unlike the security workspace, which had to be argued
 * into credential-freedom, this one is credential-free by construction. There
 * is no field here that could hold a header, a body, or a token.
 */

const DOCUMENTATION_KEY = "api-lab-documentation";
const DEBOUNCE_MS = 400;

export type LoadDocumentationResult =
  | { status: "empty" }
  | { status: "ok"; data: DocumentationWorkspace }
  | { status: "error"; detail: string };

export function loadDocumentationFromStorage(): LoadDocumentationResult {
  if (typeof window === "undefined") return { status: "empty" };
  const raw = window.localStorage.getItem(DOCUMENTATION_KEY);
  if (raw === null) return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", detail: "Saved documentation settings are not valid JSON." };
  }

  const result = deserializeDocumentation(parsed);
  if (!result.ok) return { status: "error", detail: result.detail };
  return { status: "ok", data: result.documentation };
}

function writeDocumentationNow(data: DocumentationWorkspace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DOCUMENTATION_KEY, JSON.stringify(serializeDocumentation(data)));
  } catch {
    // Quota exceeded or storage unavailable. The in-memory configuration still
    // works for this session; it just will not survive a reload. Not worth
    // interrupting the user's work over — the same call every other persisted
    // store in this app makes.
  }
}

export const saveDocumentationToStorage = debounce(writeDocumentationNow, DEBOUNCE_MS);

export function resetDocumentationStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DOCUMENTATION_KEY);
}
