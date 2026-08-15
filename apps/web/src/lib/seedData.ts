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
    auth: { type: "none" },
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
