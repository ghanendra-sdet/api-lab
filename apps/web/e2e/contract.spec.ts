import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Milestone 11 — API Contract Testing E2E (spec §47).
 *
 * Every scenario drives the real UI against the real Milestone 9 mock server,
 * exactly as spec §33 and §49 require: no external APIs, no network stubbing,
 * and a deterministic target whose response can be changed between assertions
 * to prove that a contract PASS becomes a contract FAIL for the right reason.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "contract");
const SPEC_30 = join(FIXTURES, "users-3.0.json");
const SPEC_31 = join(FIXTURES, "users-3.1.json");
const MALFORMED_SPEC = join(FIXTURES, "malformed.json");

const MOCK_ADMIN = "http://localhost:4010";

interface MockRouteSpec {
  method?: string;
  path: string;
  status?: number;
  body?: string;
  contentType?: string;
  extraHeaders?: Array<{ key: string; value: string }>;
}

/**
 * Creates (or replaces) a mock route through the mock server's admin API.
 *
 * Route *creation* is Milestone 9 functionality with its own E2E coverage;
 * driving it through the UI here would add minutes of clicking to every
 * contract assertion without testing anything this milestone introduced.
 * Everything the contract feature itself does still goes through the real UI.
 */
async function setMockRoute(request: APIRequestContext, spec: MockRouteSpec): Promise<void> {
  const method = spec.method ?? "GET";

  const existing = await request.get(`${MOCK_ADMIN}/__mock/routes`);
  const routes = (await existing.json()) as Array<{ id: string; method: string; path: string }>;
  for (const route of routes) {
    if (route.path === spec.path && route.method === method) {
      await request.delete(`${MOCK_ADMIN}/__mock/routes/${route.id}`);
    }
  }

  const headers = [
    { id: "h-ct", key: "Content-Type", value: spec.contentType ?? "application/json", enabled: true },
    ...(spec.extraHeaders ?? []).map((header, index) => ({
      id: `h-${index}`,
      key: header.key,
      value: header.value,
      enabled: true,
    })),
  ];

  const response = await request.post(`${MOCK_ADMIN}/__mock/routes`, {
    data: {
      method,
      path: spec.path,
      enabled: true,
      scenarios: [
        {
          id: "sc-1",
          name: "E2E",
          status: spec.status ?? 200,
          headers,
          bodyFormat: "json",
          body: spec.body ?? "{}",
          delayMs: 0,
          enabled: true,
        },
      ],
      activeScenarioId: "sc-1",
    },
  });
  expect(response.ok(), `failed to create mock route ${method} ${spec.path}`).toBe(true);
}

async function openContractManager(page: Page) {
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  return page.getByRole("dialog", { name: "Contract" });
}

/** Imports a specification through the real Contract manager UI. */
async function importSpecification(page: Page, fixturePath: string): Promise<void> {
  const dialog = await openContractManager(page);
  await dialog.getByLabel("Import OpenAPI specification").setInputFiles(fixturePath);
  await expect(dialog.getByText(/operations$/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close contract manager" }).click();
}

/** Specifications are named after the imported file, minus its extension. */
const SPEC_30_LABEL = "users-3.0 (OpenAPI 3.0.3)";
const SPEC_31_LABEL = "users-3.1 (OpenAPI 3.1.0)";

async function selectSpecificationForTab(page: Page, label: string) {
  await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Contract" }).click();
  await page.getByLabel("Specification").selectOption({ label });
}

async function setUrl(page: Page, url: string) {
  await page.getByLabel("Request URL").fill(url);
}

async function enableResponseValidation(page: Page) {
  await page.getByLabel("Validate against contract").check();
}

function contractVerdict(page: Page) {
  return page.getByTestId("contract-verdict");
}

test.describe("API Contract Testing & OpenAPI Validation", () => {
  // One shared mock-server process and one shared browser origin's
  // localStorage: run serially so one test's attached specifications and mock
  // routes can never race another's.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Attached specifications persist in localStorage; start each scenario
    // from a clean slate so coverage and drift figures are deterministic.
    await page.evaluate(() => {
      window.localStorage.removeItem("api-lab-contracts");
      window.localStorage.removeItem("api-lab-workspace");
    });
    await page.reload();
  });

  test("1. a conforming response validates against the contract as PASS", async ({ page, request }) => {
    await setMockRoute(request, {
      path: "/contract/users/:id",
      body: JSON.stringify({ id: 1, name: "Test User" }),
    });

    await importSpecification(page, SPEC_30);
    await selectSpecificationForTab(page, SPEC_30_LABEL);

    await setUrl(page, "http://localhost:4010/contract/users/1");
    // The Contract tab resolves the operation before anything is even sent.
    await expect(page.getByTestId("contract-operation")).toContainText("GET /users/{id}");

    await enableResponseValidation(page);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(/^200/)).toBeVisible();
    await expect(contractVerdict(page)).toContainText("Contract PASS");
  });

  test("2. a wrongly-typed response property fails the contract at $.id", async ({ page, request }) => {
    await setMockRoute(request, {
      path: "/contract/users/:id",
      // The deliberate break: id is documented as an integer.
      body: JSON.stringify({ id: "wrong-type", name: "Test User" }),
    });

    await importSpecification(page, SPEC_30);
    await selectSpecificationForTab(page, SPEC_30_LABEL);
    await setUrl(page, "http://localhost:4010/contract/users/1");
    await enableResponseValidation(page);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(contractVerdict(page)).toContainText("Contract FAIL");
    const violation = page.getByTestId("contract-violation").first();
    await expect(violation).toContainText("$.id");
    await expect(violation).toContainText("integer");
    await expect(violation).toContainText("string");
  });

  test("3. a missing required property is reported by name and path", async ({ page, request }) => {
    await setMockRoute(request, {
      path: "/contract/users/:id",
      body: JSON.stringify({ id: 1 }),
    });

    await importSpecification(page, SPEC_30);
    await selectSpecificationForTab(page, SPEC_30_LABEL);
    await setUrl(page, "http://localhost:4010/contract/users/1");
    await enableResponseValidation(page);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(contractVerdict(page)).toContainText("Contract FAIL");
    const violation = page.getByTestId("contract-violation").first();
    await expect(violation).toContainText("Missing required property: name");
    await expect(violation).toContainText("$.name");
  });

  test("4. an undocumented response status is a contract violation", async ({ page, request }) => {
    await setMockRoute(request, {
      path: "/contract/users/:id",
      status: 500,
      body: JSON.stringify({ error: "boom" }),
    });

    await importSpecification(page, SPEC_30);
    await selectSpecificationForTab(page, SPEC_30_LABEL);
    await setUrl(page, "http://localhost:4010/contract/users/1");
    await enableResponseValidation(page);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(contractVerdict(page)).toContainText("Contract FAIL");
    await expect(page.getByTestId("contract-violation").first()).toContainText(
      "Response status 500 is not documented",
    );
  });

  test("5. a wrong response content type is a contract violation", async ({ page, request }) => {
    await setMockRoute(request, {
      path: "/contract/strict",
      contentType: "text/plain",
      body: "not json at all",
    });

    await importSpecification(page, SPEC_30);
    await selectSpecificationForTab(page, SPEC_30_LABEL);
    await setUrl(page, "http://localhost:4010/contract/strict");
    await enableResponseValidation(page);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(contractVerdict(page)).toContainText("Contract FAIL");
    const violation = page.getByTestId("contract-violation").first();
    await expect(violation).toContainText("text/plain");
    await expect(violation).toContainText("application/json");
  });

  test("6. an invalid request is caught before it is ever sent", async ({ page, request }) => {
    await setMockRoute(request, {
      path: "/contract/users/:id",
      body: JSON.stringify({ id: 1, name: "Test User" }),
    });

    await importSpecification(page, SPEC_30);
    await selectSpecificationForTab(page, SPEC_30_LABEL);

    // `abc` is not the integer the contract documents for `id`.
    await setUrl(page, "http://localhost:4010/contract/users/abc");
    await page.getByLabel("Validate request before sending").check();
    await page.getByRole("button", { name: "Send" }).click();

    await expect(contractVerdict(page)).toContainText("Contract FAIL");
    const violation = page.getByTestId("contract-violation").first();
    await expect(violation).toContainText('Path parameter "id"');
    await expect(violation).toContainText("request.path");
    await expect(violation).toContainText("integer");
  });

  test("7. the Collection Runner reports contract results separately from assertions", async ({ page, request }) => {
    await setMockRoute(request, {
      path: "/contract/users/:id",
      body: JSON.stringify({ id: "wrong-type", name: "Test User" }),
    });

    await importSpecification(page, SPEC_30);

    page.once("dialog", (dialog) => dialog.accept("Contract Collection"));
    await page.getByRole("button", { name: "New Collection" }).click();
    await expect(
      page.getByRole("navigation", { name: "Collections" }).getByText("Contract Collection", { exact: true }),
    ).toBeVisible();

    await setUrl(page, "http://localhost:4010/contract/users/1");
    await page.getByLabel("Save request").click();
    const saveDialog = page.getByRole("dialog", { name: "Save request" });
    await saveDialog.getByLabel("Name").fill("Get User");
    await saveDialog.getByLabel("Collection").selectOption({ label: "Contract Collection" });
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();

    // Bind the specification to the collection (spec §26).
    const dialog = await openContractManager(page);
    await dialog.getByLabel("Bound collection").selectOption({ label: "Contract Collection" });
    await dialog.getByRole("button", { name: "Close contract manager" }).click();

    await page.getByRole("button", { name: "Run Contract Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByLabel("Validate contract after response").check();
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();

    await expect(runnerDialog.getByText("Run complete")).toBeVisible();
    // The aggregate contract block is reported separately from the
    // pass/fail assertion summary above it (spec §30).
    await expect(runnerDialog.getByTestId("runner-contract-summary")).toContainText("Failed: 1");
    // And the item carries its own contract-specific status (spec §29).
    await expect(runnerDialog.locator("ul li button").first()).toContainText("Contract Failed");

    await runnerDialog.locator("ul li button").first().click();
    await expect(runnerDialog.getByText("Contract: FAIL")).toBeVisible();
    await expect(runnerDialog.getByTestId("contract-violation").first()).toContainText("$.id");
  });

  test("8. request chaining feeds an extracted value into a contract-validated request", async ({ page, request }) => {
    await setMockRoute(request, {
      method: "POST",
      path: "/contract/users",
      status: 201,
      body: JSON.stringify({ id: 77, name: "Created User" }),
    });
    await setMockRoute(request, {
      path: "/contract/users/:id",
      body: JSON.stringify({ id: 77, name: "Created User" }),
    });

    await importSpecification(page, SPEC_30);

    page.once("dialog", (dialog) => dialog.accept("Chain Collection"));
    await page.getByRole("button", { name: "New Collection" }).click();

    // Request 1 — create a user and extract its id into a runtime variable.
    await page.getByLabel("Request URL").fill("http://localhost:4010/contract/users");
    await page.getByLabel("HTTP method").selectOption("POST");
    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Body" }).click();
    await page.getByRole("radio", { name: "raw" }).check();
    await page.locator(".monaco-editor").first().click();
    await page.keyboard.type('{"name": "Created User"}');

    await page.getByRole("tablist", { name: "Request configuration" }).getByRole("tab", { name: "Tests" }).click();
    await page.getByRole("button", { name: "+ Add Extraction" }).click();
    const extractionRow = page
      .locator("table", { has: page.locator("caption", { hasText: "Extractions" }) })
      .locator("tbody tr")
      .last();
    await extractionRow.locator('input[id^="extraction-path-"]').fill("$.id");
    await extractionRow.locator('input[id^="extraction-variable-"]').fill("newUserId");

    await page.getByLabel("Save request").click();
    let saveDialog = page.getByRole("dialog", { name: "Save request" });
    await saveDialog.getByLabel("Name").fill("Create User");
    await saveDialog.getByLabel("Collection").selectOption({ label: "Chain Collection" });
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();

    // Request 2 — consume the extracted variable in the path.
    await page.getByRole("button", { name: "New request tab" }).click();
    await page.getByLabel("Request URL").fill("http://localhost:4010/contract/users/{{newUserId}}");
    await page.getByLabel("Save request").click();
    saveDialog = page.getByRole("dialog", { name: "Save request" });
    await saveDialog.getByLabel("Name").fill("Get Created User");
    await saveDialog.getByLabel("Collection").selectOption({ label: "Chain Collection" });
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();

    const dialog = await openContractManager(page);
    await dialog.getByLabel("Bound collection").selectOption({ label: "Chain Collection" });
    await dialog.getByRole("button", { name: "Close contract manager" }).click();

    await page.getByRole("button", { name: "Run Chain Collection" }).click();
    const runnerDialog = page.getByRole("dialog", { name: "Collection Runner" });
    await runnerDialog.getByLabel("Validate contract after response").check();
    await runnerDialog.getByRole("button", { name: "Start Run" }).click();
    await expect(runnerDialog.getByText("Run complete")).toBeVisible();

    // Both requests were validated independently, and the chained one
    // resolved `{{newUserId}}` before its path was matched against the
    // contract — never validating the literal placeholder (spec §31, §32).
    await expect(runnerDialog.getByTestId("runner-contract-summary")).toContainText("Passed: 2");
    await expect(runnerDialog.getByTestId("runner-contract-summary")).toContainText("Failed: 0");
  });

  test("9. contract drift is reported between a collection and its specification", async ({ page }) => {
    await importSpecification(page, SPEC_30);

    page.once("dialog", (dialog) => dialog.accept("Drift Collection"));
    await page.getByRole("button", { name: "New Collection" }).click();

    // One documented request, and one the specification knows nothing about.
    await setUrl(page, "http://localhost:4010/contract/users/1");
    await page.getByLabel("Save request").click();
    let saveDialog = page.getByRole("dialog", { name: "Save request" });
    await saveDialog.getByLabel("Name").fill("Get User");
    await saveDialog.getByLabel("Collection").selectOption({ label: "Drift Collection" });
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();

    await page.getByRole("button", { name: "New request tab" }).click();
    await setUrl(page, "http://localhost:4010/contract/ghost");
    await page.getByLabel("Save request").click();
    saveDialog = page.getByRole("dialog", { name: "Save request" });
    await saveDialog.getByLabel("Name").fill("Ghost Request");
    await saveDialog.getByLabel("Collection").selectOption({ label: "Drift Collection" });
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();

    const dialog = await openContractManager(page);
    await dialog.getByLabel("Bound collection").selectOption({ label: "Drift Collection" });
    await dialog.getByRole("tab", { name: "Drift" }).click();

    await expect(dialog.getByTestId("drift-summary")).toContainText("Matched: 1");
    await expect(dialog.getByTestId("drift-summary")).toContainText("Missing from spec: 1");
    // 4 documented operations, 1 matched → 3 with no collection request.
    await expect(dialog.getByTestId("drift-summary")).toContainText("Missing from collection: 3");

    await dialog.getByRole("button", { name: "Missing from spec" }).click();
    await expect(dialog.getByTestId("drift-entry")).toHaveCount(1);
    await expect(dialog.getByTestId("drift-entry").first()).toContainText(
      "Request exists in collection, missing from specification.",
    );

    await dialog.getByRole("button", { name: "Missing from collection" }).click();
    await expect(dialog.getByTestId("drift-entry")).toHaveCount(3);
  });

  test("10. contract coverage separates collection coverage from validated coverage", async ({ page, request }) => {
    await setMockRoute(request, {
      path: "/contract/users/:id",
      body: JSON.stringify({ id: 1, name: "Test User" }),
    });

    await importSpecification(page, SPEC_30);

    page.once("dialog", (dialog) => dialog.accept("Coverage Collection"));
    await page.getByRole("button", { name: "New Collection" }).click();

    await setUrl(page, "http://localhost:4010/contract/users/1");
    await page.getByLabel("Save request").click();
    const saveDialog = page.getByRole("dialog", { name: "Save request" });
    await saveDialog.getByLabel("Name").fill("Get User");
    await saveDialog.getByLabel("Collection").selectOption({ label: "Coverage Collection" });
    await saveDialog.getByRole("button", { name: "Save", exact: true }).click();

    let dialog = await openContractManager(page);
    await dialog.getByLabel("Bound collection").selectOption({ label: "Coverage Collection" });
    await dialog.getByRole("tab", { name: "Coverage" }).click();

    // 1 of 4 documented operations has a request; none has been validated yet.
    await expect(dialog.getByTestId("operation-coverage")).toHaveText("25%");
    await expect(dialog.getByTestId("validation-coverage")).toHaveText("0%");
    await dialog.getByRole("button", { name: "Close contract manager" }).click();

    // Validate one operation, and only the validation figure moves.
    await enableResponseValidation(page);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^200/)).toBeVisible();

    dialog = await openContractManager(page);
    await dialog.getByRole("tab", { name: "Coverage" }).click();
    await expect(dialog.getByTestId("operation-coverage")).toHaveText("25%");
    await expect(dialog.getByTestId("validation-coverage")).toHaveText("25%");
  });

  test("11. an OpenAPI 3.1 specification validates with JSON Schema 2020-12 null semantics", async ({ page, request }) => {
    // `nickname: null` is legal under the 3.1 fixture's ["string","null"]
    // type union. A 3.0 document expresses the same thing with
    // `nullable: true`; both must accept null (spec §11).
    await setMockRoute(request, {
      path: "/contract31/users/:id",
      body: JSON.stringify({ id: 5, name: "Test User", nickname: null }),
    });

    await importSpecification(page, SPEC_31);
    await selectSpecificationForTab(page, SPEC_31_LABEL);
    await setUrl(page, "http://localhost:4010/contract31/users/5");
    await enableResponseValidation(page);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(contractVerdict(page)).toContainText("Contract PASS");

    // And the same 3.1 contract still catches a genuine type error.
    await setMockRoute(request, {
      path: "/contract31/users/:id",
      body: JSON.stringify({ id: 5, name: "Test User", nickname: 42 }),
    });
    await page.getByRole("button", { name: "Send" }).click();
    await expect(contractVerdict(page)).toContainText("Contract FAIL");
  });

  test("12. malformed and oversized specifications are rejected gracefully", async ({ page }) => {
    const dialog = await openContractManager(page);

    // A syntactically broken document.
    await dialog.getByLabel("Import OpenAPI specification").setInputFiles(MALFORMED_SPEC);
    await expect(dialog.getByRole("alert")).toContainText("not valid JSON");

    // A structurally valid document that is not OpenAPI at all.
    await dialog.getByLabel("Import OpenAPI specification").setInputFiles({
      name: "not-openapi.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ hello: "world" })),
    });
    await expect(dialog.getByRole("alert")).toContainText("Not a recognizable OpenAPI document");

    // An unsupported OpenAPI major version, named explicitly.
    await dialog.getByLabel("Import OpenAPI specification").setInputFiles({
      name: "future.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ openapi: "4.0.0", info: { title: "x" }, paths: {} })),
    });
    await expect(dialog.getByRole("alert")).toContainText("3.0.x and 3.1.x");

    // An oversized document is refused on size before it is ever parsed.
    await dialog.getByLabel("Import OpenAPI specification").setInputFiles({
      name: "huge.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(6 * 1024 * 1024, "x"),
    });
    await expect(dialog.getByRole("alert")).toContainText("larger than the 5MB limit");

    // The app is still fully usable after four rejected imports.
    await dialog.getByRole("button", { name: "Close contract manager" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });
});
