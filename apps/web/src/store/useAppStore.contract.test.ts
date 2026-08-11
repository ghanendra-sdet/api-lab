import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyEnvironmentWorkspace } from "@api-lab/environment-engine";
import { createEmptyWorkspace } from "@api-lab/workspace-engine";
import { createEmptyContractWorkspace } from "@api-lab/contract-engine";
import { useAppStore } from "./useAppStore";
import { useContractStore } from "./useContractStore";
import { createEmptyTab } from "../lib/seedData";
import { summarizeRunnerContract } from "../lib/runner";

const SPEC = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Users API" },
  servers: [{ url: "http://localhost:4010" }],
  paths: {
    "/users/{id}": {
      get: {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "name"],
                  properties: { id: { type: "integer" }, name: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  },
});

function resetStores() {
  const freshTab = createEmptyTab();
  useAppStore.setState({
    tabs: [freshTab],
    activeTabId: freshTab.id,
    workspace: createEmptyWorkspace(),
    workspaceLoadError: null,
    environments: createEmptyEnvironmentWorkspace(),
    environmentsLoadError: null,
    requestStatus: {},
    responses: {},
    testResults: {},
    sendErrors: {},
    contractResults: {},
    contractValidationEnabled: false,
    contractRequestValidationEnabled: false,
    runnerValidateContract: false,
    tabRuntimeVariables: {},
    runnerDataset: null,
    runnerDatasetName: null,
  });
  useContractStore.setState({
    contracts: createEmptyContractWorkspace(),
    contractsLoadError: null,
    validatedOperations: {},
    activeSpecificationId: null,
  });
}

function attachSpec(): string {
  const result = useContractStore.getState().importSpecification("Users", SPEC);
  if (!result.ok) throw new Error(result.detail);
  useContractStore.getState().setActiveSpecification(result.id);
  return result.id;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("contract validation on Send (spec §28)", () => {
  beforeEach(resetStores);
  afterEach(() => vi.unstubAllGlobals());

  async function send(url: string): Promise<void> {
    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, url);
    await sendRequest(activeTabId);
  }

  it("does not validate — or slow down — an ordinary request when the option is off", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "wrong type" })));
    attachSpec();

    await send("http://localhost:4010/users/1");

    const tabId = useAppStore.getState().activeTabId;
    expect(useAppStore.getState().responses[tabId]).toBeDefined();
    expect(useAppStore.getState().contractResults[tabId]).toBeUndefined();
  });

  it("reports a contract PASS for a conforming response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: 1, name: "Test User" })));
    attachSpec();
    useAppStore.getState().setContractValidationEnabled(true);

    await send("http://localhost:4010/users/1");

    const result = useAppStore.getState().contractResults[useAppStore.getState().activeTabId];
    expect(result?.valid).toBe(true);
    expect(result?.operation?.path).toBe("/users/{id}");
  });

  it("reports a contract FAIL with the precise path for a wrong property type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "123", name: "Test User" })));
    attachSpec();
    useAppStore.getState().setContractValidationEnabled(true);

    await send("http://localhost:4010/users/1");

    const result = useAppStore.getState().contractResults[useAppStore.getState().activeTabId];
    expect(result?.valid).toBe(false);
    expect(result?.responseViolations[0]).toMatchObject({ path: "$.id", expected: "integer", actual: "string" });
  });

  it("reports an undocumented status code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, 500)));
    attachSpec();
    useAppStore.getState().setContractValidationEnabled(true);

    await send("http://localhost:4010/users/1");

    const result = useAppStore.getState().contractResults[useAppStore.getState().activeTabId];
    expect(result?.responseViolations[0]).toMatchObject({ location: "response.status", actual: "500" });
  });

  it("records the validated operation so coverage can count it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: 1, name: "a" })));
    const specId = attachSpec();
    useAppStore.getState().setContractValidationEnabled(true);

    await send("http://localhost:4010/users/1");

    expect(useContractStore.getState().validatedOperations[specId]).toEqual(["GET /users/{id}"]);
  });

  it("skips validation gracefully when no specification is attached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: 1, name: "a" })));
    useAppStore.getState().setContractValidationEnabled(true);

    await send("http://localhost:4010/users/1");

    const tabId = useAppStore.getState().activeTabId;
    // The request still goes out — contract validation is additive, never a gate.
    expect(useAppStore.getState().responses[tabId]).toBeDefined();
    expect(useAppStore.getState().contractResults[tabId]).toBeUndefined();
  });
});

describe("pre-send request validation (spec §7, §12)", () => {
  beforeEach(resetStores);
  afterEach(() => vi.unstubAllGlobals());

  it("blocks the request before sending when a path parameter has the wrong type", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 1, name: "a" }));
    vi.stubGlobal("fetch", fetchMock);
    attachSpec();
    useAppStore.getState().setContractRequestValidationEnabled(true);

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "http://localhost:4010/users/abc");
    await sendRequest(activeTabId);

    // The whole point of pre-flight validation: nothing went on the wire.
    expect(fetchMock).not.toHaveBeenCalled();
    const result = useAppStore.getState().contractResults[activeTabId];
    expect(result?.valid).toBe(false);
    expect(result?.requestViolations[0]).toMatchObject({ location: "request.path", path: "id" });
  });

  it("sends normally when the request satisfies the contract", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 1, name: "a" }));
    vi.stubGlobal("fetch", fetchMock);
    attachSpec();
    useAppStore.getState().setContractRequestValidationEnabled(true);

    const { activeTabId, setTabUrl, sendRequest } = useAppStore.getState();
    setTabUrl(activeTabId, "http://localhost:4010/users/5");
    await sendRequest(activeTabId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().responses[activeTabId]).toBeDefined();
  });
});

describe("Collection Runner contract integration (spec §29, §30)", () => {
  beforeEach(resetStores);
  afterEach(() => vi.unstubAllGlobals());

  function setupBoundCollection(): { collectionId: string; requestIds: string[] } {
    const specId = attachSpec();
    const { createCollection, saveNewRequest, setTabUrl, activeTabId } = useAppStore.getState();
    const collectionId = createCollection("Contract Collection");
    useContractStore.getState().bindCollection(specId, collectionId);

    setTabUrl(activeTabId, "http://localhost:4010/users/1");
    saveNewRequest(activeTabId, { collectionId }, "Get User");

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    return { collectionId, requestIds: collection.items.map((item) => item.id) };
  }

  it("attaches a contract result to each run item and summarizes them separately", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: 1, name: "a" })));
    const { collectionId, requestIds } = setupBoundCollection();
    useAppStore.getState().setRunnerValidateContract(true);

    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const runnerState = useAppStore.getState().runnerState;
    expect(runnerState.validateContract).toBe(true);
    expect(summarizeRunnerContract(runnerState)).toEqual({ passed: 1, failed: 0, warnings: 0, validated: 1 });
  });

  it("marks a contract violation with its own status, not a generic assertion failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "wrong", name: "a" })));
    const { collectionId, requestIds } = setupBoundCollection();
    useAppStore.getState().setRunnerValidateContract(true);

    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const item = useAppStore.getState().runnerState.iterations[0]!.items[0]!;
    // Spec §29: a contract failure must be distinguishable from an assertion failure.
    expect(item.status).toBe("contract-failed");
    expect(item.contractResult?.valid).toBe(false);
    expect(summarizeRunnerContract(useAppStore.getState().runnerState).failed).toBe(1);
  });

  it("does not validate when the runner option is off", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "wrong", name: "a" })));
    const { collectionId, requestIds } = setupBoundCollection();

    await useAppStore.getState().startRunner(collectionId, requestIds, null, true);

    const runnerState = useAppStore.getState().runnerState;
    expect(runnerState.validateContract).toBe(false);
    expect(runnerState.iterations[0]!.items[0]!.contractResult).toBeUndefined();
    expect(summarizeRunnerContract(runnerState).validated).toBe(0);
  });

  it("resolves dataset variables before validating the request (spec §31)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 1, name: "a" }));
    vi.stubGlobal("fetch", fetchMock);

    const specId = attachSpec();
    const { createCollection, saveNewRequest, setTabUrl, activeTabId, setRunnerDataset } = useAppStore.getState();
    const collectionId = createCollection("Data Driven");
    useContractStore.getState().bindCollection(specId, collectionId);

    setTabUrl(activeTabId, "http://localhost:4010/users/{{userId}}");
    saveNewRequest(activeTabId, { collectionId }, "Get User");
    setRunnerDataset({ columns: ["userId"], rows: [{ userId: "42" }] }, "users.csv");
    useAppStore.getState().setRunnerValidateContract(true);

    const collection = useAppStore.getState().workspace.collections.find((c) => c.id === collectionId)!;
    await useAppStore.getState().startRunner(collectionId, collection.items.map((item) => item.id), null, true);

    const item = useAppStore.getState().runnerState.iterations[0]!.items[0]!;
    // `{{userId}}` resolved to 42 before matching, so the operation was found
    // and the integer path parameter validated — never the literal placeholder.
    expect(item.contractResult?.operation?.path).toBe("/users/{id}");
    expect(item.contractResult?.valid).toBe(true);
  });
});
