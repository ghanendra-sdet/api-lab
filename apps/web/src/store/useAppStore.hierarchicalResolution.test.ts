/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * D.1 Phase 1 Step 5 integration tests: hierarchical variable resolution
 * (7-layer precedence) and authentication inheritance, exercised through
 * the real pipeline — store/workspace state → `executeRequestConfig` (via
 * `startRunner`/`sendRequest`) → a mocked `fetch` call — not just unit
 * tests of `mergeResolutionContext` or `resolveInheritedAuth` in isolation.
 *
 * In Step 8, the tab-based Send path (`sendRequest`) is fully plumbed to
 * support request local variables (`RequestTabState.variables`), which
 * round-trips through `tabToRequestConfig` and participates in variable
 * precedence resolution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import type { Collection, Folder, SavedRequest, Workspace } from "@api-lab/workspace-engine";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import { useAppStore } from "./useAppStore";
import { createEmptyTab } from "../lib/seedData";

function resetStore() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    workspace: createEmptyWorkspace(),
    workspaceLoadError: null,
    environments: createEmptyEnvironmentWorkspace(),
    environmentsLoadError: null,
    globals: [],
    globalsLoadError: null,
    theme: "light",
    sidebarCollapsed: false,
    requestStatus: {},
    responses: {},
    testResults: {},
    sendErrors: {},
    tabRuntimeVariables: {},
    runnerDataset: null,
    runnerDatasetName: null,
    runnerDelayMs: 0,
    runnerIterations: 1,
  });
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function savedRequest(overrides: Partial<SavedRequest["request"]> = {}, name = "Req"): SavedRequest {
  const now = new Date().toISOString();
  return {
    id: nextId("req"),
    type: "request",
    name,
    createdAt: now,
    updatedAt: now,
    request: {
      method: "GET",
      url: "https://example.com/",
      params: [],
      headers: [],
      auth: { type: "none" },
      bodyMode: "none",
      bodyRawFormat: "JSON",
      bodyRawContent: "",
      tests: [],
      extractions: [],
      ...overrides,
    },
  };
}

function folder(items: SavedRequest[], overrides: Partial<Folder> = {}): Folder {
  const now = new Date().toISOString();
  return {
    id: nextId("folder"),
    type: "folder",
    name: "Folder",
    items,
    createdAt: now,
    updatedAt: now,
    variables: [],
    auth: { type: "inherit" },
    ...overrides,
  };
}

function collection(items: Array<SavedRequest | Folder>, overrides: Partial<Collection> = {}): Collection {
  const now = new Date().toISOString();
  return {
    id: nextId("coll"),
    name: "Collection",
    items,
    createdAt: now,
    updatedAt: now,
    variables: [],
    auth: { type: "none" },
    ...overrides,
  };
}

function workspaceOf(...collections: Collection[]): Workspace {
  return { collections };
}

async function runSingle(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, ws: Workspace, collectionId: string, requestId: string) {
  useAppStore.setState({ workspace: ws });
  vi.stubGlobal("fetch", fetchMock);
  await useAppStore.getState().startRunner(collectionId, [requestId], null, true);
}

describe("D.1 Step 5 — hierarchical variable resolution (integration, via startRunner)", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the full 7-layer chain end-to-end, each higher scope overriding the lower one for the same key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));

    // Every layer defines `val`; only `path` (defined solely by the
    // request's own variables) has no shadowing competitor, to prove the
    // "request" layer feeds through as well as the others.
    const req = savedRequest({
      url: "https://example.com/{{path}}?v={{val}}",
      headers: [{ id: "h1", key: "X-Val", value: "{{val}}", enabled: true }],
      variables: [{ id: "rv1", key: "val", value: "request", enabled: true, secret: false }, { id: "rv2", key: "path", value: "from-request-scope", enabled: true, secret: false }],
    });
    const fld = folder([req], { variables: [{ id: "fv1", key: "val", value: "folder", enabled: true, secret: false }] });
    const coll = collection([fld], { variables: [{ id: "cv1", key: "val", value: "collection", enabled: true, secret: false }] });
    const ws = workspaceOf(coll);

    useAppStore.getState().addGlobalVariable();
    const globalId = useAppStore.getState().globals[0]!.id;
    useAppStore.getState().updateGlobalVariable(globalId, { key: "val", value: "global", enabled: true });

    const envId = useAppStore.getState().createEnvironment("Env");
    const varId = useAppStore.getState().addVariable(envId);
    useAppStore.getState().updateVariable(envId, varId, { key: "val", value: "environment", enabled: true });
    useAppStore.getState().setActiveEnvironment(envId);

    await runSingle(fetchMock, ws, coll.id, req.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/from-request-scope");
    // Request scope ("request") beats Folder/Collection/Environment/Global,
    // and nothing higher (runtime/iteration) is defined in this run, so
    // "request" wins outright.
    expect(String(url)).toContain("v=request");
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Val"]).toBe("request");
  });

  it("Collection scope overrides Environment/Global when Folder/Request don't define the key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ url: "https://example.com/?v={{val}}" });
    const fld = folder([req]);
    const coll = collection([fld], { variables: [{ id: "cv1", key: "val", value: "collection", enabled: true, secret: false }] });
    const ws = workspaceOf(coll);

    const envId = useAppStore.getState().createEnvironment("Env");
    const varId = useAppStore.getState().addVariable(envId);
    useAppStore.getState().updateVariable(envId, varId, { key: "val", value: "environment", enabled: true });
    useAppStore.getState().setActiveEnvironment(envId);

    await runSingle(fetchMock, ws, coll.id, req.id);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("v=collection");
  });

  it("Folder scope overrides Collection scope", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ url: "https://example.com/?v={{val}}" });
    const fld = folder([req], { variables: [{ id: "fv1", key: "val", value: "folder", enabled: true, secret: false }] });
    const coll = collection([fld], { variables: [{ id: "cv1", key: "val", value: "collection", enabled: true, secret: false }] });
    const ws = workspaceOf(coll);

    await runSingle(fetchMock, ws, coll.id, req.id);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("v=folder");
  });

  it("a request directly in a Collection (no Folder) still resolves Collection scope", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ url: "https://example.com/?v={{val}}" });
    const coll = collection([req], { variables: [{ id: "cv1", key: "val", value: "collection", enabled: true, secret: false }] });
    const ws = workspaceOf(coll);

    await runSingle(fetchMock, ws, coll.id, req.id);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("v=collection");
  });

  it("Runtime (extracted-this-run) outranks Request, and Iteration outranks Runtime", async () => {
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ val: "runtime" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const login = savedRequest(
      { url: "https://example.com/login", extractions: [{ id: "e1", source: "json", path: "$.val", variable: "val", enabled: true }] },
      "Login",
    );
    const target = savedRequest(
      { url: "https://example.com/?v={{val}}", variables: [{ id: "rv1", key: "val", value: "request", enabled: true, secret: false }] },
      "Target",
    );
    const coll = collection([login, target]);
    const ws = workspaceOf(coll);
    useAppStore.setState({ workspace: ws });
    vi.stubGlobal("fetch", fetchMock);

    // Dataset iteration ("iteration" scope) must outrank the runtime value
    // extracted by Login.
    useAppStore.getState().setRunnerDataset({ columns: ["val"], rows: [{ val: "iteration" }] }, "ds");

    await useAppStore.getState().startRunner(coll.id, [login.id, target.id], null, true);

    // Two requests in one iteration: Login then Target.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [targetUrl] = fetchMock.mock.calls[1]!;
    expect(String(targetUrl)).toContain("v=iteration");
  });
});

describe("D.1 Step 5 — authentication inheritance (integration)", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1. Request's explicit auth wins over any Folder/Collection auth", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "bearer", token: "request-token" } });
    const fld = folder([req], { auth: { type: "bearer", token: "folder-token" } });
    const coll = collection([fld], { auth: { type: "bearer", token: "collection-token" } });
    await runSingle(fetchMock, workspaceOf(coll), coll.id, req.id);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer request-token");
  });

  it("2. Request inherit -> Folder's explicit auth is used", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "inherit" } });
    const fld = folder([req], { auth: { type: "bearer", token: "folder-token" } });
    const coll = collection([fld], { auth: { type: "bearer", token: "collection-token" } });
    await runSingle(fetchMock, workspaceOf(coll), coll.id, req.id);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer folder-token");
  });

  it("3. Request inherit -> Folder inherit -> Collection's explicit auth is used", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "inherit" } });
    const fld = folder([req], { auth: { type: "inherit" } });
    const coll = collection([fld], { auth: { type: "bearer", token: "collection-token" } });
    await runSingle(fetchMock, workspaceOf(coll), coll.id, req.id);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer collection-token");
  });

  it("4. Collection explicit \"none\" at the end of the chain means no Authorization header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "inherit" } });
    const fld = folder([req], { auth: { type: "inherit" } });
    const coll = collection([fld], { auth: { type: "none" } });
    await runSingle(fetchMock, workspaceOf(coll), coll.id, req.id);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("5. Explicit Request {type:\"none\"} disables inheritance — Folder/Collection auth is never consulted", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "none" } });
    const fld = folder([req], { auth: { type: "bearer", token: "folder-token" } });
    const coll = collection([fld], { auth: { type: "bearer", token: "collection-token" } });
    await runSingle(fetchMock, workspaceOf(coll), coll.id, req.id);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("6. A brand-new request (via createEmptyTab) defaults to {type:\"inherit\"}, not {type:\"none\"}", () => {
    const tab = createEmptyTab();
    expect(tab.auth).toEqual({ type: "inherit" });
  });

  it("7. An existing persisted request with no auth field at all still deserializes to {type:\"none\"} (schema default unchanged)", async () => {
    const { deserializeWorkspace } = await import("@api-lab/workspace-engine");
    const legacyJson = {
      version: 1,
      workspace: {
        collections: [
          {
            id: "c1",
            name: "Legacy",
            items: [
              {
                id: "r1",
                type: "request",
                name: "Old Request",
                createdAt: "2020-01-01T00:00:00.000Z",
                updatedAt: "2020-01-01T00:00:00.000Z",
                request: {
                  method: "GET",
                  url: "https://example.com",
                  params: [],
                  headers: [],
                  // No `auth` field at all, as pre-Milestone-5 data looked.
                  bodyMode: "none",
                  bodyRawFormat: "JSON",
                  bodyRawContent: "",
                },
              },
            ],
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
      },
    };

    const result = deserializeWorkspace(legacyJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const legacyRequest = result.workspace.collections[0]!.items[0] as any;
    expect(legacyRequest.request.auth).toEqual({ type: "none" });
  });

  it("8. Inherited Bearer auth reaches the real request as an actual Authorization header (mocked fetch)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "inherit" } });
    const fld = folder([req], { auth: { type: "inherit" } });
    const coll = collection([fld], { auth: { type: "bearer", token: "inherited-bearer-value" } });
    await runSingle(fetchMock, workspaceOf(coll), coll.id, req.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer inherited-bearer-value");
  });

  it("9. Inherited API-key auth reaches the real request as an actual header (mocked fetch)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "inherit" } });
    const fld = folder([req], { auth: { type: "apiKey", key: "X-Api-Key", value: "inherited-key-value", addTo: "header" } });
    const coll = collection([fld], { auth: { type: "none" } });
    await runSingle(fetchMock, workspaceOf(coll), coll.id, req.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("inherited-key-value");
  });

  it("10. Resolution never loops indefinitely — a fully inherit->inherit->concrete chain resolves in bounded time", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "inherit" } });
    const fld = folder([req], { auth: { type: "inherit" } });
    // Defensive case: Collection itself is (abnormally) "inherit" — the
    // resolver must fall through to "none" rather than recursing forever.
    const coll = collection([fld], { auth: { type: "inherit" } as any });

    const start = Date.now();
    await runSingle(fetchMock, workspaceOf(coll), coll.id, req.id);
    expect(Date.now() - start).toBeLessThan(2000);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("resolves an inherited auth token's own {{variable}} reference (variable interpolation still applies post-inheritance)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const req = savedRequest({ auth: { type: "inherit" } });
    const fld = folder([req], { auth: { type: "inherit" } });
    const coll = collection([fld], { auth: { type: "bearer", token: "{{apiToken}}" } });
    useAppStore.setState({ workspace: workspaceOf(coll) });
    vi.stubGlobal("fetch", fetchMock);

    const envId = useAppStore.getState().createEnvironment("Env");
    const varId = useAppStore.getState().addVariable(envId);
    useAppStore.getState().updateVariable(envId, varId, { key: "apiToken", value: "resolved-secret", enabled: true });
    useAppStore.getState().setActiveEnvironment(envId);

    await useAppStore.getState().startRunner(coll.id, [req.id], envId, true);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer resolved-secret");
  });

  it("now resolved: tab-based Send supports request-local `variables`", () => {
    const tab = createEmptyTab();
    expect(tab.variables).toEqual([]);
  });

  it("resolves request-local variables and transmits them in outgoing request via sendRequest", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { activeTabId, setTabUrl, setTabVariables, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "https://example.com/api?val={{myLocalVar}}");
    setTabVariables(activeTabId, [
      { id: "v-local", key: "myLocalVar", value: "send-request-local-value", enabled: true, secret: false }
    ]);

    await sendRequest(activeTabId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://example.com/api?val=send-request-local-value");
  });
});
