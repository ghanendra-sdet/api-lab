import type { RequestTabState } from "../types";
import { createId } from "./id";

export function createEmptyTab(overrides: Partial<RequestTabState> = {}): RequestTabState {
  return {
    id: createId("tab"),
    name: "New Request",
    method: "GET",
    url: "",
    activePanel: "params",
    params: [],
    headers: [],
    // D.1 Step 5: a brand-new request defaults to inheriting auth from its
    // (eventual) containing Folder/Collection, not "No Auth" — see
    // `authInheritance.ts`. This is the *creation-time* default only; it
    // is a distinct mechanism from `workspace-engine/schema.ts`'s
    // deserialization default, which stays `{type:"none"}` so that
    // existing persisted requests with no `auth` field at all keep
    // resolving as "No Auth", exactly as before.
    auth: { type: "inherit" },
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    preRequestScript: "",
    postResponseScript: "",
    tests: [],
    extractions: [],
    dependsOn: [],
    ...overrides,
  };
}

export function createInitialTab(): RequestTabState {
  return createEmptyTab({
    name: "Random Users",
    method: "GET",
    url: "https://api.freeapi.app/api/v1/public/randomusers",
    params: [
      { id: createId("row"), key: "page", value: "1", description: "Page number", enabled: true },
      { id: createId("row"), key: "limit", value: "10", description: "Page size", enabled: true },
    ],
    headers: [
      { id: createId("row"), key: "Accept", value: "application/json", enabled: true },
    ],
  });
}
