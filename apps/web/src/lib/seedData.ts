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
    authType: "none",
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    preRequestScript: "",
    postResponseScript: "",
    testsScript: "",
    ...overrides,
  };
}

export function createInitialTab(): RequestTabState {
  return createEmptyTab({
    name: "Users",
    method: "GET",
    url: "https://example.com/users",
    params: [
      { id: createId("row"), key: "page", value: "1", description: "Page number", enabled: true },
      { id: createId("row"), key: "limit", value: "10", description: "Page size", enabled: true },
    ],
    headers: [
      { id: createId("row"), key: "Accept", value: "application/json", enabled: true },
    ],
  });
}
