import { beforeEach, describe, expect, it } from "vitest";
import type { SecurityExecutor, SecurityRequestInput } from "@api-lab/security-engine";
import { useSecurityStore } from "./useSecurityStore";

function request(overrides: Partial<SecurityRequestInput> = {}): SecurityRequestInput {
  return {
    method: "POST",
    url: "http://localhost:4010/users",
    headers: [{ name: "Content-Type", value: "application/json" }],
    query: [],
    body: JSON.stringify({ name: "Ada", age: 36 }),
    contentType: "application/json",
    pathTemplate: undefined,
    auth: { kind: "header", name: "Authorization", scheme: "bearer" },
    ...overrides,
  };
}

const target = {
  requestId: "r1",
  requestName: "Create user",
  request: request(),
  operation: undefined,
  components: undefined,
};

const okExecutor: SecurityExecutor = {
  async send() {
    return { status: 400, headers: {}, rawBody: "{}", durationMs: 1, error: null };
  },
};

beforeEach(() => {
  useSecurityStore.getState().resetSecurity();
  window.localStorage.clear();
});

describe("useSecurityStore — generation", () => {
  it("generates tests without sending anything", () => {
    // Generation and execution are separate steps by design (spec §28).
    let sent = 0;
    const counting: SecurityExecutor = {
      async send() {
        sent += 1;
        return { status: 200, headers: {}, rawBody: "", durationMs: 1, error: null };
      },
    };
    void counting;

    useSecurityStore.getState().setCategories({ invalidTypes: true });
    useSecurityStore.getState().generate([target]);

    expect(useSecurityStore.getState().security.tests.length).toBeGreaterThan(0);
    expect(sent).toBe(0);
    expect(useSecurityStore.getState().hasGenerated).toBe(true);
  });

  it("replaces the previous suite rather than appending", () => {
    // Appending would silently accumulate duplicates toward the 100-test cap.
    useSecurityStore.getState().generate([target]);
    const first = useSecurityStore.getState().security.tests.length;

    useSecurityStore.getState().generate([target]);
    expect(useSecurityStore.getState().security.tests.length).toBe(first);
  });

  it("discards stale results when a new suite is generated", () => {
    useSecurityStore.setState({ results: [{ testId: "x" } as never] });
    useSecurityStore.getState().generate([target]);
    expect(useSecurityStore.getState().results).toHaveLength(0);
  });

  it("records generation warnings", () => {
    useSecurityStore.getState().setCategories({ boundaryValues: true, missingRequiredFields: true });
    useSecurityStore.getState().generate([target]);
    // No contract attached, so the schema-dependent categories explain
    // themselves rather than generating unfounded tests.
    expect(useSecurityStore.getState().generationWarnings.join(" ")).toContain("schema");
  });

  it("toggles individual tests", () => {
    useSecurityStore.getState().generate([target]);
    const id = useSecurityStore.getState().security.tests[0]!.id;

    useSecurityStore.getState().setTestEnabled(id, false);
    expect(useSecurityStore.getState().security.tests[0]!.enabled).toBe(false);
  });
});

describe("useSecurityStore — persistence", () => {
  it("persists only test definitions, never results", async () => {
    useSecurityStore.getState().generate([target]);
    useSecurityStore.setState({ results: [{ testId: "x", testName: "leaky" } as never] });

    // The debounced write.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const raw = window.localStorage.getItem("api-lab-security");
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("leaky");
    expect(JSON.parse(raw!).security.tests.length).toBeGreaterThan(0);
  });

  it("never persists a credential", async () => {
    useSecurityStore.getState().setCategories({ missingAuthentication: true, invalidAuthentication: true });
    useSecurityStore
      .getState()
      .generate([{ ...target, request: request({ headers: [{ name: "Authorization", value: "Bearer REAL-SECRET" }] }) }]);

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(window.localStorage.getItem("api-lab-security")).not.toContain("REAL-SECRET");
  });
});

describe("useSecurityStore — running", () => {
  it("runs enabled tests and records results", async () => {
    useSecurityStore.getState().setCategories({ invalidTypes: true });
    useSecurityStore.getState().generate([target]);

    await useSecurityStore.getState().run({ resolveRequest: () => request(), executor: okExecutor });

    const state = useSecurityStore.getState();
    expect(state.runStatus).toBe("completed");
    expect(state.results.length).toBe(state.security.tests.filter((test) => test.enabled).length);
  });

  it("refuses an unconfirmed remote target and sends nothing", async () => {
    let sent = 0;
    const counting: SecurityExecutor = {
      async send() {
        sent += 1;
        return { status: 200, headers: {}, rawBody: "", durationMs: 1, error: null };
      },
    };

    useSecurityStore.getState().setCategories({ invalidTypes: true });
    useSecurityStore.getState().generate([target]);

    await useSecurityStore
      .getState()
      .run({ resolveRequest: () => request({ url: "https://api.example.com/users" }), executor: counting });

    expect(sent).toBe(0);
    expect(useSecurityStore.getState().runStatus).toBe("aborted");
    expect(useSecurityStore.getState().refusedReason).toContain("api.example.com");
  });

  it("proceeds once the host is confirmed", async () => {
    useSecurityStore.getState().setCategories({ invalidTypes: true });
    useSecurityStore.getState().generate([target]);
    useSecurityStore.getState().confirmHost("api.example.com");

    await useSecurityStore
      .getState()
      .run({ resolveRequest: () => request({ url: "https://api.example.com/users" }), executor: okExecutor });

    expect(useSecurityStore.getState().runStatus).toBe("completed");
    expect(useSecurityStore.getState().results.length).toBeGreaterThan(0);
  });
});
