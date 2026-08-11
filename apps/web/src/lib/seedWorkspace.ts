import { createCollection, createRequest, type RequestConfig, type Workspace } from "@api-lab/workspace-engine";

function config(overrides: Partial<RequestConfig>): RequestConfig {
  return {
    method: "GET",
    url: "",
    params: [],
    headers: [],
    authType: "none",
    bodyMode: "none",
    bodyRawFormat: "JSON",
    bodyRawContent: "",
    ...overrides,
  };
}

/** A small example workspace so the app isn't empty on first run. Purely illustrative — not a fixture for tests. */
export function createSeedWorkspace(): Workspace {
  let workspace: Workspace = { collections: [] };

  const example = createCollection(workspace, "Example Collection");
  workspace = example.workspace;
  workspace = createRequest(
    workspace,
    { collectionId: example.collectionId },
    "Users",
    config({ method: "GET", url: "https://example.com/users" }),
  ).workspace;
  workspace = createRequest(
    workspace,
    { collectionId: example.collectionId },
    "User",
    config({
      method: "POST",
      url: "https://example.com/users",
      bodyMode: "raw",
      bodyRawContent: '{\n  "name": ""\n}',
    }),
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
