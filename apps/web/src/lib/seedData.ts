import type { Collection, RequestTabState } from "../types";
import { createId } from "./id";

export const seedCollections: Collection[] = [
  {
    id: "col_example",
    name: "Example Collection",
    requests: [
      { id: "req_users_get", name: "Users", method: "GET" },
      { id: "req_users_post", name: "User", method: "POST" },
      { id: "req_users_put", name: "User", method: "PUT" },
    ],
  },
  {
    id: "col_auth",
    name: "Authentication",
    requests: [{ id: "req_login", name: "Login", method: "POST" }],
  },
];

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
