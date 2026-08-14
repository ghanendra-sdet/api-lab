import { createCollection, createRequest, type RequestConfig, type Workspace } from "@api-lab/workspace-engine";
import { createId } from "./id";

function config(overrides: Partial<RequestConfig>): RequestConfig {
  return {
    method: "GET",
    url: "",
    params: [],
    headers: [],
    auth: { type: "none" },
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    tests: [],
    extractions: [],
    ...overrides,
  };
}

/**
 * A small example workspace so the app isn't empty on first run. Purely
 * illustrative — not a fixture for tests. Points at api.freeapi.app's public
 * random-users endpoint (a real, CORS-enabled demo API) so a first-run user
 * can hit "Send" and see a genuine response, rather than a CORS failure
 * against a placeholder like example.com.
 */
export function createSeedWorkspace(): Workspace {
  let workspace: Workspace = { collections: [] };

  const example = createCollection(workspace, "Example Collection");
  workspace = example.workspace;
  workspace = createRequest(
    workspace,
    { collectionId: example.collectionId },
    "List Random Users",
    config({
      method: "GET",
      url: "https://api.freeapi.app/api/v1/public/randomusers",
      params: [
        { id: createId("row"), key: "page", value: "1", description: "Page number", enabled: true },
        { id: createId("row"), key: "limit", value: "10", description: "Page size", enabled: true },
      ],
    }),
  ).workspace;
  workspace = createRequest(
    workspace,
    { collectionId: example.collectionId },
    "Get Random User By Id",
    config({ method: "GET", url: "https://api.freeapi.app/api/v1/public/randomusers/1" }),
  ).workspace;

  const auth = createCollection(workspace, "Authentication");
  workspace = auth.workspace;
  workspace = createRequest(
    workspace,
    { collectionId: auth.collectionId },
    "Login",
    config({ method: "POST", url: "https://example.com/login" }),
  ).workspace;

  return workspace;
}
