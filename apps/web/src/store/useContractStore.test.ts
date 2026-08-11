import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyContractWorkspace } from "@api-lab/contract-engine";
import {
  findSpecificationForCollection,
  getContractModel,
  useContractStore,
} from "./useContractStore";

const SPEC_JSON = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Users API" },
  paths: { "/users/{id}": { get: { responses: { "200": { description: "OK" } } } } },
});

const SPEC_YAML = `
openapi: "3.1.0"
info:
  title: YAML API
paths:
  /ping:
    get:
      responses:
        "200":
          description: OK
`;

function reset() {
  useContractStore.setState({
    contracts: createEmptyContractWorkspace(),
    contractsLoadError: null,
    validatedOperations: {},
    activeSpecificationId: null,
  });
}

describe("useContractStore — importing specifications (spec §25)", () => {
  beforeEach(reset);

  it("imports a JSON specification and records its version", () => {
    const result = useContractStore.getState().importSpecification("Users", SPEC_JSON);
    expect(result.ok).toBe(true);

    const [specification] = useContractStore.getState().contracts.specifications;
    expect(specification).toMatchObject({
      name: "Users",
      sourceFormat: "json",
      openapiVersionString: "3.0.3",
      collectionIds: [],
    });
  });

  it("imports a YAML specification (spec §43)", () => {
    useContractStore.getState().importSpecification("", SPEC_YAML);
    const [specification] = useContractStore.getState().contracts.specifications;

    expect(specification?.sourceFormat).toBe("yaml");
    expect(specification?.openapiVersionString).toBe("3.1.0");
    // An empty name falls back to the document's own title.
    expect(specification?.name).toBe("YAML API");
  });

  it("rejects an unparseable document at import time rather than later", () => {
    const result = useContractStore.getState().importSpecification("Bad", "{not json");
    expect(result.ok).toBe(false);
    expect(useContractStore.getState().contracts.specifications).toHaveLength(0);
  });

  it("rejects an unsupported OpenAPI version with a clear reason", () => {
    const result = useContractStore
      .getState()
      .importSpecification("Future", JSON.stringify({ openapi: "4.0.0", info: { title: "x" }, paths: {} }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.detail).toContain("3.0.x and 3.1.x");
  });

  it("removes a specification along with its recorded coverage", () => {
    const result = useContractStore.getState().importSpecification("Users", SPEC_JSON);
    if (!result.ok) throw new Error("import failed");

    useContractStore.getState().recordValidatedOperation(result.id, "GET /users/{id}");
    useContractStore.getState().removeSpecification(result.id);

    expect(useContractStore.getState().contracts.specifications).toHaveLength(0);
    expect(useContractStore.getState().validatedOperations[result.id]).toBeUndefined();
  });
});

describe("useContractStore — collection binding (spec §26)", () => {
  beforeEach(reset);

  function importSpec(name: string): string {
    const result = useContractStore.getState().importSpecification(name, SPEC_JSON);
    if (!result.ok) throw new Error("import failed");
    return result.id;
  }

  it("binds a collection without touching the specification document", () => {
    const specId = importSpec("Users");
    const before = useContractStore.getState().contracts.specifications[0]!.source;

    useContractStore.getState().bindCollection(specId, "col-1");

    const after = useContractStore.getState().contracts.specifications[0]!;
    expect(after.collectionIds).toEqual(["col-1"]);
    // The binding lives on API Lab's side; the imported document is unchanged.
    expect(after.source).toBe(before);
  });

  it("is idempotent", () => {
    const specId = importSpec("Users");
    useContractStore.getState().bindCollection(specId, "col-1");
    useContractStore.getState().bindCollection(specId, "col-1");
    expect(useContractStore.getState().contracts.specifications[0]!.collectionIds).toEqual(["col-1"]);
  });

  it("moves a collection's binding rather than leaving it bound to two specifications", () => {
    const first = importSpec("First");
    const second = importSpec("Second");

    useContractStore.getState().bindCollection(first, "col-1");
    useContractStore.getState().bindCollection(second, "col-1");

    const specifications = useContractStore.getState().contracts.specifications;
    expect(specifications.find((spec) => spec.id === first)!.collectionIds).toEqual([]);
    expect(specifications.find((spec) => spec.id === second)!.collectionIds).toEqual(["col-1"]);
  });

  it("unbinds a collection", () => {
    const specId = importSpec("Users");
    useContractStore.getState().bindCollection(specId, "col-1");
    useContractStore.getState().unbindCollection(specId, "col-1");
    expect(useContractStore.getState().contracts.specifications[0]!.collectionIds).toEqual([]);
  });

  it("finds the specification bound to a collection", () => {
    const specId = importSpec("Users");
    useContractStore.getState().bindCollection(specId, "col-1");
    const contracts = useContractStore.getState().contracts;

    expect(findSpecificationForCollection(contracts, "col-1")?.id).toBe(specId);
    expect(findSpecificationForCollection(contracts, "col-2")).toBeUndefined();
    expect(findSpecificationForCollection(contracts, undefined)).toBeUndefined();
  });
});

describe("useContractStore — validated operations (spec §37)", () => {
  beforeEach(reset);

  it("records each operation once", () => {
    const result = useContractStore.getState().importSpecification("Users", SPEC_JSON);
    if (!result.ok) throw new Error("import failed");

    useContractStore.getState().recordValidatedOperation(result.id, "GET /users/{id}");
    useContractStore.getState().recordValidatedOperation(result.id, "GET /users/{id}");
    useContractStore.getState().recordValidatedOperation(result.id, "POST /users");

    expect(useContractStore.getState().validatedOperations[result.id]).toEqual([
      "GET /users/{id}",
      "POST /users",
    ]);
  });

  it("starts empty on load, because it describes this session only", () => {
    expect(useContractStore.getState().validatedOperations).toEqual({});
  });
});

describe("getContractModel", () => {
  beforeEach(reset);

  it("derives a contract model from an attached specification", () => {
    useContractStore.getState().importSpecification("Users", SPEC_JSON);
    const model = getContractModel(useContractStore.getState().contracts.specifications[0]);

    expect(model?.title).toBe("Users API");
    expect(model?.operations.map((operation) => operation.id)).toEqual(["GET /users/{id}"]);
  });

  it("returns the same cached model for an unchanged source", () => {
    useContractStore.getState().importSpecification("Users", SPEC_JSON);
    const specification = useContractStore.getState().contracts.specifications[0];
    expect(getContractModel(specification)).toBe(getContractModel(specification));
  });

  it("returns null for no specification", () => {
    expect(getContractModel(undefined)).toBeNull();
  });
});
