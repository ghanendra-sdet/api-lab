import { describe, expect, it } from "vitest";
import { parseContract, type ContractModel } from "@api-lab/contract-engine";
import { createCollection, createRequest, createFolder } from "@api-lab/workspace-engine";
import type { KeyValueRow } from "@api-lab/shared";
import { buildContractRequestInput, collectionToDriftEndpoints } from "./contractAdapt";
import { emptyRequestConfigFor } from "./testSupport";

const SPEC = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "t" },
  servers: [{ url: "http://localhost:4010/api" }],
  paths: { "/users/{id}": { get: { responses: {} } } },
});

function contract(): ContractModel {
  const result = parseContract(SPEC);
  if (!result.ok) throw new Error(result.detail);
  return result.contract;
}

function row(key: string, value: string, enabled = true): KeyValueRow {
  return { id: `row-${key}`, key, value, description: "", enabled };
}

describe("buildContractRequestInput", () => {
  it("strips the server base path so the request path matches the contract", () => {
    const input = buildContractRequestInput(
      contract(),
      "GET",
      "http://localhost:4010/api/users/7",
      {},
      [],
      undefined,
    );
    expect(input.path).toBe("/users/7");
    expect(input.method).toBe("GET");
  });

  it("reads query parameters out of the URL", () => {
    const input = buildContractRequestInput(
      contract(),
      "GET",
      "http://localhost:4010/api/users/7?status=active&limit=10",
      {},
      [],
      undefined,
    );
    expect(input.query).toEqual([
      { name: "status", value: "active" },
      { name: "limit", value: "10" },
    ]);
    // The query string must not leak into the path used for matching.
    expect(input.path).toBe("/users/7");
  });

  it("includes enabled param rows and skips disabled or unnamed ones", () => {
    const input = buildContractRequestInput(
      contract(),
      "GET",
      "http://localhost:4010/api/users/7",
      {},
      [row("a", "1"), row("b", "2", false), row("", "3")],
      undefined,
    );
    expect(input.query).toEqual([{ name: "a", value: "1" }]);
  });

  it("does not duplicate a parameter present in both the URL and the rows", () => {
    const input = buildContractRequestInput(
      contract(),
      "GET",
      "http://localhost:4010/api/users/7?a=1",
      {},
      [row("a", "1")],
      undefined,
    );
    expect(input.query).toEqual([{ name: "a", value: "1" }]);
  });

  it("carries headers through and picks up the content type", () => {
    const input = buildContractRequestInput(
      contract(),
      "POST",
      "http://localhost:4010/api/users/7",
      { "Content-Type": "application/json", "X-Tenant": "acme" },
      [],
      "{}",
    );
    expect(input.contentType).toBe("application/json");
    expect(input.headers).toContainEqual({ name: "X-Tenant", value: "acme" });
    expect(input.body).toBe("{}");
  });

  it("parses the Cookie header into individual cookies", () => {
    const input = buildContractRequestInput(
      contract(),
      "GET",
      "http://localhost:4010/api/users/7",
      { Cookie: "session=abc; theme=dark" },
      [],
      undefined,
    );
    expect(input.cookies).toEqual([
      { name: "session", value: "abc" },
      { name: "theme", value: "dark" },
    ]);
  });

  it("reports no cookies when the header is absent", () => {
    const input = buildContractRequestInput(contract(), "GET", "http://localhost:4010/api/users/7", {}, [], undefined);
    expect(input.cookies).toEqual([]);
  });
});

describe("collectionToDriftEndpoints", () => {
  it("flattens top-level requests and folder contents", () => {
    let workspace = createCollection({ collections: [] }, "C").workspace;
    const collectionId = workspace.collections[0]!.id;

    workspace = createRequest(
      workspace,
      { collectionId },
      "Top",
      emptyRequestConfigFor({ method: "GET", url: "http://localhost:4010/api/users/1" }),
    ).workspace;

    const folderResult = createFolder(workspace, collectionId, "Folder");
    workspace = createRequest(
      folderResult.workspace,
      { collectionId, folderId: folderResult.folderId },
      "Nested",
      emptyRequestConfigFor({ method: "POST", url: "http://localhost:4010/api/users" }),
    ).workspace;

    const endpoints = collectionToDriftEndpoints(workspace.collections[0]!);
    expect(endpoints.map((endpoint) => endpoint.name).sort()).toEqual(["Nested", "Top"]);
    expect(endpoints.find((endpoint) => endpoint.name === "Nested")?.method).toBe("POST");
  });

  it("reports enabled query parameter names only", () => {
    let workspace = createCollection({ collections: [] }, "C").workspace;
    const collectionId = workspace.collections[0]!.id;
    workspace = createRequest(
      workspace,
      { collectionId },
      "R",
      emptyRequestConfigFor({
        url: "http://localhost:4010/api/users",
        params: [row("status", "active"), row("off", "x", false)],
      }),
    ).workspace;

    expect(collectionToDriftEndpoints(workspace.collections[0]!)[0]!.queryParameterNames).toEqual(["status"]);
  });

  it("reports whether the request sends a body", () => {
    let workspace = createCollection({ collections: [] }, "C").workspace;
    const collectionId = workspace.collections[0]!.id;
    workspace = createRequest(
      workspace,
      { collectionId },
      "No body",
      emptyRequestConfigFor({ url: "http://x/a" }),
    ).workspace;
    workspace = createRequest(
      workspace,
      { collectionId },
      "With body",
      emptyRequestConfigFor({ url: "http://x/b", bodyMode: "raw", bodyRawContent: '{"a":1}' }),
    ).workspace;

    const endpoints = collectionToDriftEndpoints(workspace.collections[0]!);
    expect(endpoints.find((endpoint) => endpoint.name === "No body")?.hasBody).toBe(false);
    expect(endpoints.find((endpoint) => endpoint.name === "With body")?.hasBody).toBe(true);
  });

  it("returns an empty list for an empty collection", () => {
    const workspace = createCollection({ collections: [] }, "Empty").workspace;
    expect(collectionToDriftEndpoints(workspace.collections[0]!)).toEqual([]);
  });
});
